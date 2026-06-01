/**
 * 文本向量化服务
 * 将文本切分为语义 chunks 并生成向量
 */
import { splitIntoSemanticChunks } from "../lib/chunk-utils"

import { getEmbedding } from "./deepseek"
import { getDb } from "../queries/connection"
import { vectorChunks } from "@db/schema"
import { sql } from "drizzle-orm"

// ========== 索引 ==========

export async function indexNovel(
  novelId: number,
  content: string,
  options: {
    seriesId?: number
    sourceType?: string
    sourceTitle?: string
    chapterNumber?: number
  } = {}
): Promise<{ chunkCount: number }> {
  const {
    seriesId,
    sourceType = "reference",
    sourceTitle = "",
    chapterNumber,
  } = options

  const chunks = splitIntoSemanticChunks(content, {
    sourceId: novelId,
    sourceTitle: sourceTitle || `novel_${novelId}`,
    chapterNumber,
  })

  const db = getDb()
  let chunkCount = 0

  for (const chunk of chunks) {
    if (chunk.content.trim().length < 50) continue

    try {
      const embedding = await getEmbedding(chunk.content)

      await db.insert(vectorChunks).values({
        content: chunk.content,
        embedding: embedding as unknown as number[],
        sourceType,
        novelId,
        seriesId: seriesId || null,
        metadata: {
          indexedAt: new Date().toISOString(),
          sourceId: chunk.sourceId,
          sourceTitle: chunk.sourceTitle,
          chapterNumber: chunk.chapterNumber,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
          contextBefore: chunk.contextBefore,
          contextAfter: chunk.contextAfter,
        },
      })

      chunkCount++
    } catch (error) {
      console.error("Embedding failed for chunk:", error)
      // 继续处理下一个 chunk
    }
  }

  return { chunkCount }
}

// ========== 检索 ==========

export interface SearchResult {
  id?: number
  content: string
  similarity: number
  sourceType: string
  sourceTitle?: string
  chapterNumber?: number
  chunkIndex?: number
  totalChunks?: number
  contextBefore?: string
  contextAfter?: string
}

export async function searchSimilar(
  query: string,
  options?: {
    novelId?: number
    seriesId?: number
    limit?: number
    materialIds?: number[]
    embedding?: number[] // ← 新增：允许外部传入预计算的 embedding，避免重复调用
  }
): Promise<SearchResult[]> {
  const db = getDb()
  const embedding = options?.embedding || await getEmbedding(query)
  const limit = options?.limit || 5
  const embeddingJson = JSON.stringify(embedding)

  const results = await db.execute(sql`
    SELECT id, content, source_type, 1 - (embedding <=> ${embeddingJson}) as similarity,
      metadata
    FROM vector_chunks
    WHERE (${options?.novelId ?? null}::int IS NULL OR novel_id = ${options?.novelId ?? null})
      AND (${options?.seriesId ?? null}::int IS NULL OR series_id = ${options?.seriesId ?? null})
    ORDER BY embedding <=> ${embeddingJson}
    LIMIT ${limit}
  `)

  const rows = Array.isArray(results) ? results : []

  return rows.map((row: Record<string, unknown>) => {
    const metadata = (row.metadata as Record<string, unknown>) || {}
    return {
      id: row.id ? Number(row.id) : undefined,
      content: String(row.content),
      similarity: Number(row.similarity),
      sourceType: String(row.source_type),
      sourceTitle: metadata.sourceTitle ? String(metadata.sourceTitle) : undefined,
      chapterNumber: metadata.chapterNumber ? Number(metadata.chapterNumber) : undefined,
      chunkIndex: metadata.chunkIndex ? Number(metadata.chunkIndex) : undefined,
      totalChunks: metadata.totalChunks ? Number(metadata.totalChunks) : undefined,
      contextBefore: metadata.contextBefore ? String(metadata.contextBefore) : undefined,
      contextAfter: metadata.contextAfter ? String(metadata.contextAfter) : undefined,
    }
  })
}
