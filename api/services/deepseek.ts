/**
 * DeepSeek API 封装服务
 * 提供：聊天完成、流式生成、embedding 生成
 */

import { env } from "../lib/env"

const BASE_URL = env.DEEPSEEK_BASE_URL
const API_KEY = env.DEEPSEEK_API_KEY

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface ChatOptions {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
  model?: string
}

export async function* streamChat(options: ChatOptions) {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model || "deepseek-v4-pro",
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4000,
      stream: true,
    }),
  })

  if (!response.ok || !response.body) {
    throw new Error(`DeepSeek API error: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.trim() === "" || line.trim() === "data: [DONE]") continue
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6))
            const content = data.choices?.[0]?.delta?.content
            if (content) yield content
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function chatCompletion(options: ChatOptions): Promise<string> {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model || "deepseek-v4-pro",
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4000,
      stream: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status}`)
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content || ""
}

export async function getEmbedding(text: string): Promise<number[]> {
  const embedBaseUrl = env.EMBEDDING_BASE_URL
  const embedApiKey = env.EMBEDDING_API_KEY
  const embedModel = env.EMBEDDING_MODEL

  if (!embedApiKey) {
    throw new Error(
      "未配置 Embedding API Key。DeepSeek 不提供 embedding 服务，请在 .env 中设置 EMBEDDING_API_KEY 和 EMBEDDING_BASE_URL（支持任何 OpenAI 兼容的 embedding 提供商，如 OpenAI、SiliconFlow 等）。"
    )
  }

  const response = await fetch(`${embedBaseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${embedApiKey}`,
    },
    body: JSON.stringify({
      model: embedModel,
      input: text,
      dimensions: env.EMBEDDING_DIMENSION,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Embedding API error: ${response.status} ${body}`)
  }

  const data = await response.json() as { data?: Array<{ embedding?: number[] }> }
  return data.data?.[0]?.embedding || []
}
