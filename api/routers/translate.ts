/**
 * Translation Router
 * Phase 1: Basic translation with fuzzy TM and hybrid RAG
 * Note: Streaming via mutation is not supported in tRPC v11 HTTP.
 * We return progress in a single response after completion.
 */

import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { chapters, novels, translationMemory, characterCards, worldBibles, seriesCanon } from "@db/schema"
import { eq, asc, sql } from "drizzle-orm"
import { streamChat, getEmbedding } from "../services/deepseek"

/**
 * Fuzzy Translation Memory Match
 */
async function fuzzyTranslationMemoryMatch(
  segment: string,
  novelId: number,
  seriesId: number | null,
  topK: number = 3,
  precomputedEmbedding?: number[]
): Promise<Array<{ sourceText: string; translatedText: string; similarity: number }>> {
  const db = getDb()

  try {
    const queryEmbedding = precomputedEmbedding || await getEmbedding(segment)
    const embeddingJson = JSON.stringify(queryEmbedding)

    const results = await db.execute(sql`
      SELECT source_text, translated_text, 1 - (embedding <=> ${embeddingJson}) as similarity
      FROM translation_memory
      WHERE embedding IS NOT NULL
        AND (
          (${seriesId}::int IS NOT NULL AND series_id = ${seriesId})
          OR novel_id = ${novelId}
        )
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
      .where(
        seriesId
          ? sql`series_id = ${seriesId} OR novel_id = ${novelId}`
          : eq(translationMemory.novelId, novelId)
      )
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
  seriesId: number | null,
  limit: number = 3,
  precomputedEmbedding?: number[]
): Promise<Array<{ content: string; sourceType: string; score: number }>> {
  const db = getDb()

  // 向量检索
  let vectorResults: Record<string, unknown>[] = []
  try {
    const embedding = precomputedEmbedding || await getEmbedding(query)
    const embeddingJson = JSON.stringify(embedding)

    const vec = await db.execute(sql`
      SELECT content, source_type, 1 - (embedding <=> ${embeddingJson}) as score
      FROM vector_chunks
      WHERE (
        (${seriesId}::int IS NOT NULL AND series_id = ${seriesId})
        OR novel_id = ${novelId}
      )
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
    WHERE (
      (${seriesId}::int IS NOT NULL AND series_id = ${seriesId})
      OR novel_id = ${novelId}
    )
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

// 构建 Lore 章节（世界观 + 角色 + 术语表）
async function buildLoreSection(seriesId: number): Promise<string> {
  const db = getDb()
  const parts: string[] = []

  // 世界观
  const [worldBible] = await db
    .select()
    .from(worldBibles)
    .where(eq(worldBibles.seriesId, seriesId))

  if (worldBible) {
    parts.push("【世界观设定】")
    const aspects = (worldBible.aspects || []) as Array<{ name: string; content: string }>
    if (aspects.length > 0) {
      for (const aspect of aspects) {
        parts.push(`「${aspect.name}」${aspect.content}`)
      }
    }
    if (worldBible.magicSystem) parts.push(`力量体系: ${worldBible.magicSystem}`)
    if (worldBible.geography) parts.push(`地理政治: ${worldBible.geography}`)
    if (worldBible.technologyLevel) parts.push(`技术水平: ${worldBible.technologyLevel}`)
  }

  // 角色设定
  const chars = await db
    .select()
    .from(characterCards)
    .where(eq(characterCards.seriesId, seriesId))

  if (chars.length > 0) {
    if (parts.length > 0) parts.push("")
    parts.push("【角色设定】")
    for (const char of chars.slice(0, 10)) {
      const traits = (char.personalityTraits as string[] || []).join("、") || "无性格标签"
      parts.push(`- ${char.name}: ${traits}${char.speechPatterns ? ` | 语言风格: ${char.speechPatterns}` : ""}`)
    }
  }

  // 正史事件（不可变）
  const canonEvents = await db
    .select()
    .from(seriesCanon)
    .where(eq(seriesCanon.seriesId, seriesId))
    .orderBy(asc(seriesCanon.eventOrder))

  const immutableEvents = canonEvents.filter(e => e.isImmutable)
  if (immutableEvents.length > 0) {
    if (parts.length > 0) parts.push("")
    parts.push("【不可变正史事件】")
    for (const event of immutableEvents.slice(0, 5)) {
      parts.push(`- ${event.description}`)
    }
  }

  // 术语表（从 translation_memory 提取）
  try {
    const tmTerms = await db.execute(sql`
      SELECT source_text, translated_text, frequency
      FROM translation_memory
      WHERE series_id = ${seriesId}
      ORDER BY frequency DESC
      LIMIT 15
    `)
    const terms = Array.isArray(tmTerms) ? tmTerms : []
    if (terms.length > 0) {
      if (parts.length > 0) parts.push("")
      parts.push("【术语表】以下术语必须按此表翻译，严禁自创译名：")
      for (const t of terms) {
        parts.push(`- ${String(t.source_text)} → ${String(t.translated_text)}`)
      }
    }
  } catch { /* 术语表可选 */ }

  return parts.join("\n")
}

// 翻译用 chunk 分割：800 字符/块，200 字符重叠，优先段落边界
function splitTranslationSegments(text: string): string[] {
  const maxLen = 800
  const overlap = 200

  const paragraphs = text.split("\n").filter(p => p.trim().length > 0)
  const segments: string[] = []
  let current = ""

  for (const para of paragraphs) {
    if (current.length + para.length > maxLen && current.length > 0) {
      segments.push(current)
      current = current.slice(-overlap) + "\n" + para
    } else {
      current += (current ? "\n" : "") + para
    }
  }
  if (current) segments.push(current)
  return segments
}

// 翻译提示词模板
function buildTranslationPrompt(
  sourceText: string,
  style: string,
  fuzzyMatches: Array<{ sourceText: string; translatedText: string; similarity: number }>,
  ragReference: Array<{ content: string; score: number }>,
  loreSection: string,
  userPrompt?: string
): string {
  const fewShotStr = fuzzyMatches.length > 0
    ? "\n【翻译参考（风格/术语一致性参考）】\n" +
      fuzzyMatches.slice(0, 3).map(m =>
        `原文：${m.sourceText}\n译文：${m.translatedText}`
      ).join("\n---\n")
    : ""

  const ragStr = ragReference.length > 0
    ? "\n【上下文参考】\n" + ragReference.map(r => r.content).join("\n---\n").slice(0, 1200)
    : ""

  const loreStr = loreSection ? "\n【世界观与角色设定】\n" + loreSection + "\n" : ""

  const styleInstruction: Record<string, string> = {
    literal: "直译为主，保留原文结构和语序",
    fluent: "意译为主，让译文自然流畅，符合中文表达习惯",
    literary: "文学性翻译，注重文采和意境，适合小说",
  }

  const userStr = userPrompt
    ? `\n【用户自定义要求】(请优先遵守以下要求)\n${userPrompt}\n`
    : ""

  return `请将以下外文小说段落翻译成中文。

要求：${styleInstruction[style] || styleInstruction.fluent}${loreStr}${fewShotStr}${ragStr}${userStr}
原文：
${sourceText}

译文：`
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

      // 获取小说信息（用于 seriesId）
      const [novel] = await db
        .select()
        .from(novels)
        .where(eq(novels.id, input.novelId))

      const seriesId = novel?.seriesId || null

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

      // 预构建 lore 章节（只查一次）
      const loreSection = seriesId ? await buildLoreSection(seriesId) : ""

      for (const chapter of chapterList) {
        if (!chapter.contentOriginal) {
          completed++
          results.push({ chapterId: chapter.id, chapterNumber: chapter.chapterNumber, status: "skipped" })
          continue
        }

        // 使用 800 字符 chunk + 200 字符重叠
        const segments = splitTranslationSegments(chapter.contentOriginal)
        let translatedContent = ""

        // 预计算本章 embedding（每章 1 次，避免 N+1）
        let chapterEmbedding: number[] | undefined
        try {
          chapterEmbedding = await getEmbedding(chapter.contentOriginal.slice(0, 500))
        } catch {
          // embedding 失败不影响主流程
        }

        for (const segment of segments) {
          const fuzzyMatches = await fuzzyTranslationMemoryMatch(
            segment, input.novelId, seriesId, 3, chapterEmbedding
          )
          const ragRef = await hybridSearchForTranslation(
            segment.slice(0, 200), input.novelId, seriesId, 2, chapterEmbedding
          )

          // 记录 RAG 调用
          for (const m of fuzzyMatches) {
            addRagCall({ type: "translation_memory", content: m.sourceText, score: m.similarity })
          }
          for (const r of ragRef) {
            addRagCall({ type: r.sourceType === "parallel_corpus" ? "full_text" : "vector_search", content: r.content, score: r.score, sourceType: r.sourceType })
          }

          const prompt = buildTranslationPrompt(
            segment, input.style, fuzzyMatches, ragRef, loreSection, input.userPrompt
          )

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

  // 单章翻译（用于前端逐章翻译 + 进度展示）
  chapter: publicQuery
    .input(z.object({
      novelId: z.number(),
      chapterId: z.number(),
      style: z.enum(["literal", "fluent", "literary"]).default("fluent"),
      userPrompt: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const [novel] = await db
        .select()
        .from(novels)
        .where(eq(novels.id, input.novelId))

      const seriesId = novel?.seriesId || null

      const [chapter] = await db
        .select()
        .from(chapters)
        .where(eq(chapters.id, input.chapterId))

      if (!chapter || !chapter.contentOriginal) {
        throw new Error("章节不存在或内容为空")
      }

      // 预构建 lore
      const loreSection = seriesId ? await buildLoreSection(seriesId) : ""

      // 使用 800 字符 chunk + 200 字符重叠
      const segments = splitTranslationSegments(chapter.contentOriginal)
      let translatedContent = ""

      // 预计算本章 embedding
      let chapterEmbedding: number[] | undefined
      try {
        chapterEmbedding = await getEmbedding(chapter.contentOriginal.slice(0, 500))
      } catch { /* ignore */ }

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

      for (const segment of segments) {
        const fuzzyMatches = await fuzzyTranslationMemoryMatch(
          segment, input.novelId, seriesId, 3, chapterEmbedding
        )
        const ragRef = await hybridSearchForTranslation(
          segment.slice(0, 200), input.novelId, seriesId, 2, chapterEmbedding
        )

        for (const m of fuzzyMatches) {
          addRagCall({ type: "translation_memory", content: m.sourceText, score: m.similarity })
        }
        for (const r of ragRef) {
          addRagCall({ type: r.sourceType === "parallel_corpus" ? "full_text" : "vector_search", content: r.content, score: r.score, sourceType: r.sourceType })
        }

        const prompt = buildTranslationPrompt(
          segment, input.style, fuzzyMatches, ragRef, loreSection, input.userPrompt
        )

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
        .where(eq(chapters.id, input.chapterId))

      return { chapterId: chapter.id, content: translatedContent.trim(), ragCalls }
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
