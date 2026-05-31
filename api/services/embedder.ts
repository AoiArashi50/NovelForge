/**
 * 文本向量化服务
 * 将文本切分为 chunks 并生成向量
 */

import { getEmbedding } from "./deepseek"
import { getDb } from "../queries/connection"
import { vectorChunks } from "@db/schema"
import { sql } from "drizzle-orm"

const CHUNK_SIZE = 500 // token 估算（中文字符）
const OVERLAP = 100 // 重叠量

function splitIntoChunks(text: string, chunkSize: number = CHUNK_SIZE, overlap: number = OVERLAP): string[] {
  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end))
    start += chunkSize - overlap
    if (start >= end) break // 防止无限循环
  }

  return chunks
}

export async function indexNovel(
  novelId: number,
  content: string,
  seriesId?: number,
  sourceType: string = "reference"
): Promise<{ chunkCount: number }> {
  const chunks = splitIntoChunks(content)
  const db = getDb()
  let chunkCount = 0

  for (const chunk of chunks) {
    if (chunk.trim().length < 50) continue // 跳过太短的片段

    try {
      const embedding = await getEmbedding(chunk)

      await db.insert(vectorChunks).values({
        content: chunk,
        embedding: embedding as unknown as number[],
        sourceType,
        novelId,
        seriesId: seriesId || null,
        metadata: { indexedAt: new Date().toISOString() },
      })

      chunkCount++
    } catch (error) {
      console.error("Embedding failed for chunk:", error)
      // 继续处理下一个 chunk
    }
  }

  return { chunkCount }
}

export async function searchSimilar(
  query: string,
  options?: {
    novelId?: number
    seriesId?: number
    limit?: number
    materialIds?: number[]
  }
): Promise<Array<{ content: string; similarity: number; sourceType: string }>> {
  const db = getDb()
  const embedding = await getEmbedding(query)
  const limit = options?.limit || 5
  const embeddingJson = JSON.stringify(embedding)

  // Build material filter if specified
  let materialFilter = sql`TRUE`
  if (options?.materialIds && options.materialIds.length > 0) {
    const ids = options.materialIds.join(",")
    materialFilter = sql`metadata->>'materialId' IN (${ids})`
  }

  const results = await db.execute(sql`
    SELECT content, source_type, 1 - (embedding <=> ${embeddingJson}) as similarity
    FROM vector_chunks
    WHERE (${options?.novelId ?? null}::int IS NULL OR novel_id = ${options?.novelId ?? null})
      AND (${options?.seriesId ?? null}::int IS NULL OR series_id = ${options?.seriesId ?? null})
      AND ${materialFilter}
    ORDER BY embedding <=> ${embeddingJson}
    LIMIT ${limit}
  `)

  return (Array.isArray(results) ? results : []).map((row: Record<string, unknown>) => ({
    content: String(row.content),
    similarity: Number(row.similarity),
    sourceType: String(row.source_type),
  }))
}
