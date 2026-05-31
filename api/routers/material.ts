import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { materials, translationMemory, vectorChunks } from "@db/schema"
import { eq, desc, sql, and } from "drizzle-orm"
import { getEmbedding, chatCompletion } from "../services/deepseek"
import { parseParallelCorpus } from "../services/parser"
import { extractedLoreSchema } from "@contracts/schemas"

// 文本分段
function splitIntoChunks(text: string, chunkSize: number = 500, overlap: number = 100): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end))
    start += chunkSize - overlap
    if (start >= end) break
  }
  return chunks
}

// 将文本分割为段落数组
function splitTextIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
}

export const materialRouter = createRouter({
  list: publicQuery
    .input(z.object({
      seriesId: z.number().optional(),
      sourceType: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb()
      const conditions = []
      if (input?.seriesId) {
        conditions.push(eq(materials.seriesId, input.seriesId))
      }
      if (input?.sourceType) {
        conditions.push(eq(materials.sourceType, input.sourceType))
      }
      if (conditions.length > 0) {
        return db.select().from(materials).where(and(...conditions)).orderBy(desc(materials.createdAt))
      }
      return db.select().from(materials).orderBy(desc(materials.createdAt))
    }),

  create: publicQuery
    .input(z.object({
      title: z.string().min(1),
      content: z.string().min(1),
      sourceType: z.enum(["parallel_corpus", "reference_novel", "knowledge_doc"]),
      seriesId: z.number().optional(),
      tags: z.array(z.string()).default([]),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [material] = await db.insert(materials).values({
        title: input.title,
        content: input.content,
        sourceType: input.sourceType,
        seriesId: input.seriesId || null,
        tags: input.tags,
        description: input.description,
        status: "pending",
      }).returning()
      return material
    }),

  createFromAlignedPairs: publicQuery
    .input(z.object({
      title: z.string().min(1),
      alignedPairs: z.array(z.object({
        source: z.string(),
        translated: z.string(),
      })),
      seriesId: z.number().optional(),
      tags: z.array(z.string()).default([]),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const serialized = input.alignedPairs
        .map(p => `${p.source}\n===\n${p.translated}`)
        .join("\n===\n")

      const [material] = await db.insert(materials).values({
        title: input.title,
        content: serialized,
        sourceType: "parallel_corpus",
        seriesId: input.seriesId || null,
        tags: input.tags,
        description: input.description || `手动对齐: ${input.alignedPairs.length} 对段落`,
        status: "pending",
      }).returning()

      return material
    }),

  createFromDualFiles: publicQuery
    .input(z.object({
      title: z.string().min(1),
      sourceText: z.string().min(1),
      translatedText: z.string().min(1),
      seriesId: z.number().optional(),
      tags: z.array(z.string()).default([]),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const sourceParagraphs = splitTextIntoParagraphs(input.sourceText)
      const translatedParagraphs = splitTextIntoParagraphs(input.translatedText)

      const pairCount = Math.min(sourceParagraphs.length, translatedParagraphs.length)
      const alignedPairs: Array<{ source: string; translated: string }> = []
      for (let i = 0; i < pairCount; i++) {
        if (sourceParagraphs[i].trim().length > 5 && translatedParagraphs[i].trim().length > 2) {
          alignedPairs.push({
            source: sourceParagraphs[i].trim(),
            translated: translatedParagraphs[i].trim(),
          })
        }
      }

      const serialized = alignedPairs
        .map(p => `${p.source}\n===\n${p.translated}`)
        .join("\n===\n")

      const [material] = await db.insert(materials).values({
        title: input.title,
        content: serialized,
        sourceType: "parallel_corpus",
        seriesId: input.seriesId || null,
        tags: input.tags,
        description: input.description || `自动对齐: ${alignedPairs.length} 对段落 (原文${sourceParagraphs.length}段 / 译文${translatedParagraphs.length}段)`,
        status: "pending",
      }).returning()

      return {
        ...material,
        _meta: {
          sourceParagraphCount: sourceParagraphs.length,
          translatedParagraphCount: translatedParagraphs.length,
          alignedPairCount: alignedPairs.length,
          alignedPairs,
        },
      }
    }),

  index: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const [material] = await db
        .select()
        .from(materials)
        .where(eq(materials.id, input.id))

      if (!material) throw new Error("Material not found")
      if (!material.content) throw new Error("Material has no content")

      await db
        .update(materials)
        .set({ status: "indexing" })
        .where(eq(materials.id, input.id))

      try {
        let indexedCount = 0
        let firstError = ""
        let totalCandidates = 0

        if (material.sourceType === "parallel_corpus") {
          const pairs = parseParallelCorpus(material.content)
          totalCandidates = pairs.length

          for (const { source, translated } of pairs) {
            if (source.trim().length < 10 || translated.trim().length < 5) continue

            try {
              const embedding = await getEmbedding(source)

              await db.insert(translationMemory).values({
                sourceText: source.trim(),
                translatedText: translated.trim(),
                embedding: embedding as unknown as number[],
                seriesId: material.seriesId || null,
                novelId: null,
                frequency: 1,
                metadata: { materialId: material.id },
              })

              await db.insert(vectorChunks).values({
                content: source.trim(),
                embedding: embedding as unknown as number[],
                sourceType: "parallel_corpus",
                seriesId: material.seriesId,
                metadata: {
                  materialId: material.id,
                  materialTitle: material.title,
                  translatedText: translated.trim().slice(0, 200),
                  indexedAt: new Date().toISOString(),
                },
              })

              indexedCount++
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              if (!firstError) firstError = msg
              console.error("Parallel pair embedding failed:", err)
            }
          }
        } else {
          const chunks = splitIntoChunks(material.content, 500, 100)
          totalCandidates = chunks.filter(c => c.trim().length >= 50).length

          for (const chunk of chunks) {
            if (chunk.trim().length < 50) continue

            try {
              const embedding = await getEmbedding(chunk)

              await db.insert(vectorChunks).values({
                content: chunk,
                embedding: embedding as unknown as number[],
                sourceType: material.sourceType,
                novelId: null,
                seriesId: material.seriesId,
                metadata: {
                  materialId: material.id,
                  materialTitle: material.title,
                  indexedAt: new Date().toISOString(),
                },
              })

              indexedCount++
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              if (!firstError) firstError = msg
              console.error("Chunk embedding failed:", err)
            }
          }
        }

        if (indexedCount === 0 && totalCandidates > 0 && firstError) {
          await db
            .update(materials)
            .set({ status: "failed", indexedChunks: 0 })
            .where(eq(materials.id, input.id))
          throw new Error(`索引失败: ${firstError}`)
        }

        await db
          .update(materials)
          .set({ status: "indexed", indexedChunks: indexedCount })
          .where(eq(materials.id, input.id))

        return { success: true, indexedChunks: indexedCount }
      } catch (error) {
        if (error instanceof Error && !error.message.startsWith("索引失败:")) {
          await db
            .update(materials)
            .set({ status: "failed" })
            .where(eq(materials.id, input.id))
        }
        throw error
      }
    }),

  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()

      await db.execute(sql`DELETE FROM vector_chunks WHERE metadata->>'materialId' = ${String(input.id)}`)
      await db.execute(sql`DELETE FROM translation_memory WHERE metadata->>'materialId' = ${String(input.id)}`)

      await db.delete(materials).where(eq(materials.id, input.id))

      return { success: true }
    }),

  parseFile: publicQuery
    .input(z.object({
      fileName: z.string(),
      fileData: z.string(), // base64 encoded
    }))
    .mutation(async ({ input }) => {
      const ext = input.fileName.split(".").pop()?.toLowerCase()
      const buffer = Buffer.from(input.fileData, "base64")

      if (ext === "txt") {
        const text = buffer.toString("utf-8")
        return { text, fileType: "txt" }
      }

      if (ext === "docx") {
        const mammoth = await import("mammoth")
        const result = await mammoth.extractRawText({ buffer })
        return { text: result.value, fileType: "docx" }
      }

      throw new Error(`不支持的文件格式: .${ext}。目前仅支持 .txt 和 .docx`)
    }),

  getChunks: publicQuery
    .input(z.object({ materialId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const rows = await db
        .select({
          id: vectorChunks.id,
          content: vectorChunks.content,
          sourceType: vectorChunks.sourceType,
          metadata: vectorChunks.metadata,
          createdAt: vectorChunks.createdAt,
        })
        .from(vectorChunks)
        .where(sql`${vectorChunks.metadata}->>'materialId' = ${String(input.materialId)}`)
        .orderBy(vectorChunks.createdAt)
      return rows
    }),

  updateScope: publicQuery
    .input(z.object({
      id: z.number(),
      seriesId: z.number().optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const { id, ...data } = input
      const [material] = await db
        .update(materials)
        .set(data)
        .where(eq(materials.id, id))
        .returning()
      return material
    }),

  extractLore: publicQuery
    .input(z.object({ materialId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [material] = await db
        .select()
        .from(materials)
        .where(eq(materials.id, input.materialId))

      if (!material) throw new Error("Material not found")
      if (!material.content) throw new Error("Material has no content")

      const content = material.content.slice(0, 8000)

      const systemPrompt = `你是一个专业的小说设定提取助手。你的任务是从小说或设定素材中提取结构化的角色信息和世界观设定。

提取要求：
1. 只提取素材中**明确提到**的信息，不要编造
2. 如果某类信息在素材中没有出现，返回空值或空数组
3. 人际关系用 {"角色名": "关系描述"} 的格式
4. 派系用 {"name": "名称", "description": "描述"} 的格式
5. 时间线事件按发生顺序排列，order 从 1 开始

必须返回严格的 JSON 格式，不要包含 markdown 代码块标记。`

      const userPrompt = `请从以下素材中提取角色卡和世界观设定，返回 JSON：

{
  "characters": [
    {
      "name": "角色名",
      "aliases": ["别名1", "别名2"],
      "age": "年龄描述",
      "appearanceTags": ["外貌标签1", "外貌标签2"],
      "personalityTraits": ["性格1", "性格2"],
      "coreMotivations": "核心动机/目标",
      "relationships": {"其他角色名": "关系描述"},
      "speechPatterns": "说话方式/口头禅",
      "taboos": ["禁忌1", "禁忌2"],
      "canonicalArcSummary": "角色故事线概要"
    }
  ],
  "worldBible": {
    "geography": "地理环境",
    "magicSystem": "魔法/超自然系统",
    "technologyLevel": "科技水平",
    "factions": [{"name": "派系名", "description": "描述"}],
    "timelineEvents": [{"order": 1, "description": "事件描述"}],
    "culturalCustoms": "文化习俗",
    "linguisticNotes": "语言/命名规则"
  }
}

素材内容：
${content}`

      const response = await chatCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        maxTokens: 4000,
      })

      // 容错解析：提取 JSON 代码块或直接解析
      let jsonText = response.trim()
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim()
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(jsonText)
      } catch {
        // 尝试从文本中找第一个 { 到最后一个 }
        const braceMatch = jsonText.match(/\{[\s\S]*\}/)
        if (braceMatch) {
          parsed = JSON.parse(braceMatch[0])
        } else {
          throw new Error("AI 返回的内容无法解析为 JSON")
        }
      }

      const validated = extractedLoreSchema.parse(parsed)
      return validated
    }),
})
