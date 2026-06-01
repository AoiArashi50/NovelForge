/**
 * 文本切分工具 — 纯函数，无外部依赖
 */

export interface Chunk {
  content: string        // 嵌入用内容
  contextBefore: string  // 前 200 字（不嵌入，仅展示）
  contextAfter: string   // 后 200 字
  sourceId: number       // novelId 或 materialId
  sourceTitle: string
  chapterNumber?: number
  chunkIndex: number
  totalChunks: number
}

function createChunk(
  content: string,
  metadata: { sourceId: number; sourceTitle: string; chapterNumber?: number },
  index: number
): Chunk {
  return {
    content,
    contextBefore: "",
    contextAfter: "",
    sourceId: metadata.sourceId,
    sourceTitle: metadata.sourceTitle,
    chapterNumber: metadata.chapterNumber,
    chunkIndex: index,
    totalChunks: 0,
  }
}

/**
 * 语义切分：按自然段落/场景边界拆分，保持上下文连贯
 * - 短场景（<=1500字符）直接作为一个 chunk
 * - 长场景按句子边界切分，保持 600-1200 字符/块
 */
export function splitIntoSemanticChunks(
  text: string,
  metadata: { sourceId: number; sourceTitle: string; chapterNumber?: number }
): Chunk[] {
  // 按自然段落/场景分隔符拆分
  const sceneDelimiters = /\n\s*第[一二三四五六七八九十百千零\d]+章[：:.]?\s*\n|\n\s*={3,}\s*\n|\n\s*\n\s*\n/
  const scenes = text.split(sceneDelimiters).filter(s => s.trim().length > 50)

  const chunks: Chunk[] = []
  let chunkIndex = 0

  for (const scene of scenes) {
    const trimmed = scene.trim()

    // 短场景直接作为一个 chunk
    if (trimmed.length <= 1500) {
      chunks.push(createChunk(trimmed, metadata, chunkIndex++))
      continue
    }

    // 长场景按句子边界切分
    const sentences = trimmed.split(/(?<=[。！？.?!])\s*/)
    let current = ""

    for (const sentence of sentences) {
      if (current.length + sentence.length > 1200 && current.length >= 600) {
        chunks.push(createChunk(current, metadata, chunkIndex++))
        current = sentence
      } else {
        current += sentence
      }
    }

    if (current.length >= 50) {
      chunks.push(createChunk(current, metadata, chunkIndex++))
    }
  }

  // 回填上下文
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].contextBefore = i > 0 ? chunks[i - 1].content.slice(-200) : ""
    chunks[i].contextAfter = i < chunks.length - 1 ? chunks[i + 1].content.slice(0, 200) : ""
    chunks[i].totalChunks = chunks.length
  }

  return chunks
}

// 兼容旧版：固定长度切分（仅用于不需要语义切分的场景）
export function splitIntoFixedChunks(
  text: string,
  chunkSize: number = 500,
  overlap: number = 100
): string[] {
  if (overlap >= chunkSize) {
    // 防止无限循环：overlap 必须小于 chunkSize
    return [text]
  }

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
