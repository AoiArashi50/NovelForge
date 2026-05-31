/**
 * Translation Router
 * Phase 1: Basic translation with fuzzy TM and hybrid RAG
 * Note: Streaming via mutation is not supported in tRPC v11 HTTP.
 * We return progress in a single response after completion.
 */

import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { chapters, novels, translationMemory } from "@db/schema"
import { eq, asc, sql } from "drizzle-orm"
import { streamChat, getEmbedding } from "../services/deepseek"

/**
 * Fuzzy Translation Memory Match
 */
async function fuzzyTranslationMemoryMatch(
  segment: string,
  novelId: number,
  topK: number = 3
): Promise<Array<{ sourceText: string; translatedText: string; similarity: number }>> {
  const db = getDb()

  try {
    const queryEmbedding = await getEmbedding(segment)
    const embeddingJson = JSON.stringify(queryEmbedding)

    const results = await db.execute(sql`
      SELECT source_text, translated_text, 1 - (embedding <=> ${embeddingJson}) as similarity
      FROM translation_memory
      WHERE (${novelId}::int IS NULL OR novel_id = ${novelId})
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingJson}
      LIMIT ${topK}
    `)

    return (Array.isArray(results) ? results : []).map((row: Record<string, unknown>) => ({
      sourceText: String(row.source_text),
      translatedText: String(row.translated_text),
      similarity: Number(row.similarity),
    }))
  } catch {
    // embedding API 不可用或失败时回退
    const memories = await db
      .select()
      .from(translationMemory)
      .where(eq(translationMemory.novelId, novelId))
      .limit(topK)

    return memories.map(m => ({
      sourceText: m.sourceText,
      translatedText: m.translatedText,
      similarity: 1.0,
    }))
  }
}

/**
 * Hybrid RAG Search for Translation
 */
async function hybridSearchForTranslation(
  query: string,
  novelId: number,
  limit: number = 3
): Promise<Array<{ content: string; sourceType: string; score: number }>> {
  const db = getDb()

  // 向量检索
  let vectorResults: Record<string, unknown>[] = []
  try {
    const embedding = await getEmbedding(query)
    const embeddingJson = JSON.stringify(embedding)

    const vec = await db.execute(sql`
      SELECT content, source_type, 1 - (embedding <=> ${embeddingJson}) as score
      FROM vector_chunks
      WHERE novel_id = ${novelId}
      ORDER BY embedding <=> ${embeddingJson}
      LIMIT ${limit * 2}
    `)
    vectorResults = Array.isArray(vec) ? vec : []
  } catch { /* ignore */ }

  // 全文检索
  const fullText = await db.execute(sql`
    SELECT content, source_type,
      ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', ${query})) as score
    FROM vector_chunks
    WHERE novel_id = ${novelId}
      AND to_tsvector('simple', content) @@ plainto_tsquery('simple', ${query})
    ORDER BY score DESC
    LIMIT ${limit * 2}
  `)

  // 合并 + 简单重排
  const merged = new Map<string, { content: string; sourceType: string; score: number }>()

  for (const row of vectorResults) {
    const key = String(row.content).slice(0, 100)
    const existing = merged.get(key)
    merged.set(key, {
      content: String(row.content),
      sourceType: String(row.source_type),
      score: (existing?.score || 0) + Number(row.score) * 0.6,
    })
  }

  for (const row of (Array.isArray(fullText) ? fullText : [])) {
    const key = String(row.content).slice(0, 100)
    const existing = merged.get(key)
    merged.set(key, {
      content: String(row.content),
      sourceType: String(row.source_type),
      score: (existing?.score || 0) + Number(row.score) * 0.4,
    })
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// 翻译提示词模板
function buildTranslationPrompt(
  sourceText: string,
  style: string,
  fuzzyMatches: Array<{ sourceText: string; translatedText: string; similarity: number }>,
  ragReference: Array<{ content: string; score: number }>,
  userPrompt?: string
): string {
  const fewShotStr = fuzzyMatches.length > 0
    ? "\n【翻译参考（风格/术语一致性参考）】\n" +
      fuzzyMatches.slice(0, 3).map(m =>
        `原文：${m.sourceText}\n译文：${m.translatedText}`
      ).join("\n---\n")
    : ""

  const ragStr = ragReference.length > 0
    ? "\n【上下文参考】\n" + ragReference.map(r => r.content).join("\n---\n").slice(0, 1500)
    : ""

  const styleInstruction: Record<string, string> = {
    literal: "直译为主，保留原文结构和语序",
    fluent: "意译为主，让译文自然流畅，符合中文表达习惯",
    literary: "文学性翻译，注重文采和意境，适合小说",
  }

  const userStr = userPrompt
    ? `\n【用户自定义要求】(请优先遵守以下要求)\n${userPrompt}\n`
    : ""

  return `请将以下外文小说段落翻译成中文。\n\n要求：${styleInstruction[style] || styleInstruction.fluent}${fewShotStr}${ragStr}${userStr}\n\n原文：\n${sourceText}\n\n译文：`
}

// 文本分段函数（翻译用，按最大长度）
function splitText(text: string, maxLength: number): string[] {
  const segments: string[] = []
  let current = ""

  for (const paragraph of text.split("\n")) {
    if (current.length + paragraph.length > maxLength && current.length > 0) {
      segments.push(current)
      current = paragraph
    } else {
      current += (current ? "\n" : "") + paragraph
    }
  }

  if (current) segments.push(current)
  return segments
}

// 将文本分割为段落数组
function splitTextIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
}

export const translateRouter = createRouter({
  start: publicQuery
    .input(z.object({
      novelId: z.number(),
      style: z.enum(["literal", "fluent", "literary"]).default("fluent"),
      userPrompt: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const chapterList = await db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, input.novelId))
        .orderBy(asc(chapters.chapterNumber))

      let completed = 0
      const total = chapterList.length
      const results: Array<{ chapterId: number; chapterNumber: number; status: string }> = []

      // 收集 RAG 调用信息（去重展示）
      const ragCalls: Array<{
        type: "translation_memory" | "vector_search" | "full_text"
        content: string
        score?: number
        sourceType?: string
      }> = []
      const ragKeys = new Set<string>()

      function addRagCall(item: typeof ragCalls[number]) {
        const key = item.type + "|" + item.content.slice(0, 80)
        if (!ragKeys.has(key)) {
          ragKeys.add(key)
          ragCalls.push(item)
        }
      }

      for (const chapter of chapterList) {
        if (!chapter.contentOriginal) {
          completed++
          results.push({ chapterId: chapter.id, chapterNumber: chapter.chapterNumber, status: "skipped" })
          continue
        }

        const segments = splitText(chapter.contentOriginal, 2000)
        let translatedContent = ""

        for (const segment of segments) {
          const fuzzyMatches = await fuzzyTranslationMemoryMatch(segment, input.novelId, 3)
          const ragRef = await hybridSearchForTranslation(segment.slice(0, 200), input.novelId, 2)

          // 记录 RAG 调用
          for (const m of fuzzyMatches) {
            addRagCall({ type: "translation_memory", content: m.sourceText, score: m.similarity })
          }
          for (const r of ragRef) {
            addRagCall({ type: r.sourceType === "parallel_corpus" ? "full_text" : "vector_search", content: r.content, score: r.score, sourceType: r.sourceType })
          }

          const prompt = buildTranslationPrompt(segment, input.style, fuzzyMatches, ragRef, input.userPrompt)

          const stream = streamChat({
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            maxTokens: 4000,
          })

          for await (const chunk of stream) {
            translatedContent += chunk
          }
        }

        await db
          .update(chapters)
          .set({ contentTranslated: translatedContent.trim() })
          .where(eq(chapters.id, chapter.id))

        completed++
        results.push({ chapterId: chapter.id, chapterNumber: chapter.chapterNumber, status: "done" })
      }

      // 保存翻译风格设置到小说元数据
      const [novel] = await db
        .select()
        .from(novels)
        .where(eq(novels.id, input.novelId))

      const updatedMetadata = {
        ...(novel?.metadata as Record<string, unknown> || {}),
        lastTranslateStyle: input.style,
        lastTranslatePrompt: input.userPrompt || "",
      }

      await db
        .update(novels)
        .set({ status: "translated", metadata: updatedMetadata })
        .where(eq(novels.id, input.novelId))

      return { progress: 100, completed: true, total, results, ragCalls }
    }),

  export: publicQuery
    .input(z.object({
      novelId: z.number(),
      format: z.enum(["pure", "parallel"]).default("pure"),
    }))
    .query(async ({ input }) => {
      const db = getDb()

      const chapterList = await db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, input.novelId))
        .orderBy(asc(chapters.chapterNumber))

      if (input.format === "pure") {
        return {
          format: "pure" as const,
          content: chapterList
            .map(ch => ch.contentTranslated || "")
            .filter(Boolean)
            .join("\n\n"),
        }
      }

      const pairs: string[] = []
      for (const ch of chapterList) {
        const sourceParas = splitTextIntoParagraphs(ch.contentOriginal || "")
        const translatedParas = splitTextIntoParagraphs(ch.contentTranslated || "")
        const pairCount = Math.min(sourceParas.length, translatedParas.length)
        for (let i = 0; i < pairCount; i++) {
          pairs.push(`${sourceParas[i].trim()}\n===\n${translatedParas[i].trim()}`)
        }
      }

      return {
        format: "parallel" as const,
        content: pairs.join("\n===\n"),
      }
    }),
})
