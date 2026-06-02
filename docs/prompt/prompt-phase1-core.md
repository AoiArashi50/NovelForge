# Phase 1: 核心功能 — NovelForge

**角色**: 核心功能开发 Agent  
**目标**: 实现文档上传与解析、AI 翻译、完整阅读器、设定库 CRUD  
**前置依赖**: Phase 0 完成（项目骨架、数据库、路由就绪）  
**读取优先级**: 先读 `ProjectGoal.md` Section 2（功能模块），再读本 prompt  

---

## 1. 项目上下文

NovelForge 是一款 AI 驱动的小说翻译与二创 Web 应用。本阶段实现 4 个核心功能模块：

1. **文档上传与解析** — 支持 txt/docx/pdf，解析为章节
2. **AI 翻译** — 调用 DeepSeek API 翻译，支持翻译记忆
3. **沉浸式阅读器** — 完整排版、双语切换、章节导航
4. **设定库基础** — 角色卡/世界观/正史的 CRUD

技术栈（已冻结）：React 19 + Fastify + tRPC + Drizzle ORM + PostgreSQL/pgvector + DeepSeek V4

---

## 2. 后端开发任务

### 2.1 环境变量配置

在 `.env` 文件中添加：

```
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

在 `api/lib/env.ts` 中导出（如果不存在则创建）：

```typescript
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  DEEPSEEK_API_KEY: z.string(),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
});

export const env = envSchema.parse(process.env);
```

### 2.2 DeepSeek API 封装

创建 `api/services/deepseek.ts`：

```typescript
/**
 * DeepSeek API 封装服务
 * 提供：聊天完成、流式生成、embedding 生成
 */

import { env } from "../lib/env";

const BASE_URL = env.DEEPSEEK_BASE_URL;
const API_KEY = env.DEEPSEEK_API_KEY;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  model?: string;
}

export async function* streamChat(options: ChatOptions) {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model || "deepseek-chat",
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4000,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`DeepSeek API error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim() === "" || line.trim() === "data: [DONE]") continue;
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            const content = data.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
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
      model: options.model || "deepseek-chat",
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4000,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

export async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-embed",
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data?.[0]?.embedding || [];
}
```

### 2.3 文档解析服务

创建 `api/services/parser.ts`：

```typescript
/**
 * 文档解析服务
 * 支持 txt, docx, pdf
 * 解析为章节数组
 */

import { promises as fs } from "fs";

interface ParsedChapter {
  chapterNumber: number;
  title: string;
  content: string;
}

// 从文件扩展名判断类型
function getFileType(filePath: string): "txt" | "docx" | "pdf" {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  return "txt";
}

// 通用章节切分（基于常见章节标题模式）
function splitIntoChapters(text: string): ParsedChapter[] {
  // 匹配 "Chapter 1", "第1章", "第一章", "CHAPTER I" 等模式
  const chapterRegex = /(?:^(?:Chapter|CHAPTER|\u7B2C[一二三四五六七八九十\d]+章|\u7B2C\d+章)[\s:：]*(.+)?$)/gm;
  
  const chapters: ParsedChapter[] = [];
  let match;
  let lastIndex = 0;
  let chapterNumber = 0;
  
  const matches: Array<{ index: number; title: string }> = [];
  
  while ((match = chapterRegex.exec(text)) !== null) {
    matches.push({
      index: match.index,
      title: match[1]?.trim() || `Chapter ${matches.length + 1}`,
    });
  }
  
  if (matches.length === 0) {
    // 没有章节标题，整本书作为一个章节
    return [{
      chapterNumber: 1,
      title: "全文",
      content: text.trim(),
    }];
  }
  
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i < matches.length - 1 ? matches[i + 1].index : text.length;
    const content = text.slice(start, end).trim();
    
    // 提取内容（去掉章节标题行）
    const lines = content.split("\n");
    const bodyLines = lines.slice(1); // 去掉标题行
    
    chapters.push({
      chapterNumber: ++chapterNumber,
      title: matches[i].title,
      content: bodyLines.join("\n").trim() || content,
    });
  }
  
  return chapters;
}

// 解析 TXT
async function parseTxt(filePath: string): Promise<ParsedChapter[]> {
  const text = await fs.readFile(filePath, "utf-8");
  return splitIntoChapters(text);
}

// 解析 DOCX
async function parseDocx(filePath: string): Promise<ParsedChapter[]> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  return splitIntoChapters(result.value);
}

// 解析 PDF
async function parsePdf(filePath: string): Promise<ParsedChapter[]> {
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
  const buffer = await fs.readFile(filePath);
  const result = await pdfParse(buffer);
  return splitIntoChapters(result.text);
}

/**
 * 解析平行语料（原文+译文对照格式）
 * 支持分隔符："===" 或 "---" 或 "|||" 或 空行分隔
 * 格式示例：
 *   The sky was clear.
 *   ===
 *   天空晴朗。
 *   ===
 *   He walked alone.
 *   ===
 *   他独自走着。
 */
function parseParallelCorpus(content: string): Array<{ source: string; translated: string }> {
  const DELIMITERS = ["===", "---", "|||"];
  const lines = content.split("\n").map(l => l.trim());
  const pairs: Array<{ source: string; translated: string }> = [];

  // 方法1：用显式分隔符检测
  for (const delim of DELIMITERS) {
    if (content.includes(delim)) {
      const segments = content.split(delim).map(s => s.trim()).filter(s => s.length > 0);
      // 期望偶数个段落：source1, trans1, source2, trans2...
      for (let i = 0; i < segments.length - 1; i += 2) {
        pairs.push({ source: segments[i], translated: segments[i + 1] });
      }
      return pairs;
    }
  }

  // 方法2：空行分隔（原文和译文交替）
  // 假设奇数行是原文，偶数行是译文
  const nonEmptyLines = lines.filter(l => l.length > 0);
  for (let i = 0; i < nonEmptyLines.length - 1; i += 2) {
    const source = nonEmptyLines[i];
    const translated = nonEmptyLines[i + 1];
    // 简单启发式：如果一行含大量中文字符（>50%），视为译文
    const chineseCharCount = (source.match(/[\u4e00-\u9fff]/g) || []).length;
    if (chineseCharCount / source.length > 0.5) {
      // 这行应该是译文，交换
      pairs.push({ source: translated, translated: source });
    } else {
      pairs.push({ source, translated });
    }
  }

  return pairs;
}

// 主解析函数
export async function parseDocument(filePath: string): Promise<{
  chapters: ParsedChapter[];
  fileType: string;
}> {
  const fileType = getFileType(filePath);
  let chapters: ParsedChapter[];
  
  switch (fileType) {
    case "docx":
      chapters = await parseDocx(filePath);
      break;
    case "pdf":
      chapters = await parsePdf(filePath);
      break;
    default:
      chapters = await parseTxt(filePath);
  }
  
  // 过滤空章节
  chapters = chapters.filter(ch => ch.content.length > 50);
  
  // 如果过滤后没有章节，整本书作为一个章节
  if (chapters.length === 0) {
    const text = await fs.readFile(filePath, "utf-8");
    chapters = [{ chapterNumber: 1, title: "全文", content: text.trim() }];
  }
  
  return { chapters, fileType };
}
```

### 2.4 向量化服务

创建 `api/services/embedder.ts`：

```typescript
/**
 * 文本向量化服务
 * 将文本切分为 chunks 并生成向量
 */

import { getEmbedding } from "./deepseek";
import { getDb } from "../queries/connection";
import { vectorChunks } from "@db/schema";

const CHUNK_SIZE = 500; // token 估算（中文字符）
const OVERLAP = 100; // 重叠量

function splitIntoChunks(text: string, chunkSize: number = CHUNK_SIZE, overlap: number = OVERLAP): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
    if (start >= end) break; // 防止无限循环
  }
  
  return chunks;
}

export async function indexNovel(
  novelId: number,
  content: string,
  seriesId?: number,
  sourceType: string = "reference"
): Promise<{ chunkCount: number }> {
  const chunks = splitIntoChunks(content);
  const db = getDb();
  let chunkCount = 0;
  
  for (const chunk of chunks) {
    if (chunk.trim().length < 50) continue; // 跳过太短的片段
    
    try {
      const embedding = await getEmbedding(chunk);
      
      await db.insert(vectorChunks).values({
        content: chunk,
        embedding: embedding as any, // pgvector 需要类型转换
        sourceType,
        novelId,
        seriesId: seriesId || null,
        metadata: { indexedAt: new Date().toISOString() },
      });
      
      chunkCount++;
    } catch (error) {
      console.error("Embedding failed for chunk:", error);
      // 继续处理下一个 chunk
    }
  }
  
  return { chunkCount };
}

export async function searchSimilar(
  query: string,
  options?: {
    novelId?: number;
    seriesId?: number;
    limit?: number;
  }
): Promise<Array<{ content: string; similarity: number; sourceType: string }>> {
  const db = getDb();
  const embedding = await getEmbedding(query);
  const limit = options?.limit || 5;
  
  // 使用 pgvector 的余弦距离
  const results = await db.execute(
    `SELECT content, source_type, 1 - (embedding <=> $1) as similarity
     FROM vector_chunks
     WHERE ($2::int IS NULL OR novel_id = $2)
       AND ($3::int IS NULL OR series_id = $3)
     ORDER BY embedding <=> $1
     LIMIT $4`,
    [JSON.stringify(embedding), options?.novelId || null, options?.seriesId || null, limit]
  );
  
  return (results.rows || []).map((row: any) => ({
    content: row.content,
    similarity: row.similarity,
    sourceType: row.source_type,
  }));
}
```

### 2.5 tRPC Router 实现

#### contracts/schemas.ts（共享 Zod Schema）

```typescript
import { z } from "zod";

// 小说
export const createNovelSchema = z.object({
  title: z.string().min(1),
  author: z.string().optional(),
  originalLanguage: z.string().optional(),
});

export const updateNovelSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  author: z.string().optional(),
  status: z.enum(["unread", "reading", "translated", "completed"]).optional(),
  metadata: z.record(z.any()).optional(),
});

// 章节
export const chapterListSchema = z.object({
  novelId: z.number(),
});

export const updateChapterSchema = z.object({
  id: z.number(),
  contentTranslated: z.string().optional(),
  title: z.string().optional(),
});

// 翻译
export const startTranslationSchema = z.object({
  novelId: z.number(),
  style: z.enum(["literal", "fluent", "literary"]).default("fluent"),
  startChapter: z.number().default(1),
});

// 设定库
export const createSeriesSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  universeName: z.string().optional(),
});

export const createCharacterSchema = z.object({
  seriesId: z.number(),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  age: z.string().optional(),
  personalityTraits: z.array(z.string()).default([]),
  coreMotivations: z.string().optional(),
  relationships: z.record(z.any()).default({}),
  speechPatterns: z.string().optional(),
  taboos: z.array(z.string()).default([]),
  canonicalArcSummary: z.string().optional(),
});

export const updateCharacterSchema = createCharacterSchema.partial().extend({
  id: z.number(),
});

export const createWorldBibleSchema = z.object({
  seriesId: z.number(),
  geography: z.string().optional(),
  magicSystem: z.string().optional(),
  technologyLevel: z.string().optional(),
  factions: z.array(z.any()).default([]),
  timelineEvents: z.array(z.any()).default([]),
  culturalCustoms: z.string().optional(),
  linguisticNotes: z.string().optional(),
});

// 标签
export const createTagSchema = z.object({
  name: z.string().min(1),
  parentId: z.number().optional(),
  color: z.string().optional(),
});

export const assignTagSchema = z.object({
  novelId: z.number(),
  tagId: z.number(),
});
```

#### api/routers/novel.ts

```typescript
import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { novels, chapters, tags, novelTags } from "@db/schema";
import { eq, desc, like } from "drizzle-orm";

export const novelRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    return db.select().from(novels).orderBy(desc(novels.createdAt));
  }),

  getById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [novel] = await db
        .select()
        .from(novels)
        .where(eq(novels.id, input.id));
      return novel || null;
    }),

  create: publicQuery
    .input(z.object({
      title: z.string().min(1),
      author: z.string().optional(),
      originalLanguage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [novel] = await db
        .insert(novels)
        .values(input)
        .returning();
      return novel;
    }),

  update: publicQuery
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      author: z.string().optional(),
      status: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      const [novel] = await db
        .update(novels)
        .set(data)
        .where(eq(novels.id, id))
        .returning();
      return novel;
    }),

  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      // 先删除关联章节
      await db.delete(chapters).where(eq(chapters.novelId, input.id));
      await db.delete(novelTags).where(eq(novelTags.novelId, input.id));
      await db.delete(novels).where(eq(novels.id, input.id));
      return { success: true };
    }),

  search: publicQuery
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(novels)
        .where(like(novels.title, `%${input.query}%`));
    }),
});
```

#### api/routers/chapter.ts

```typescript
import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { chapters } from "@db/schema";
import { eq, asc } from "drizzle-orm";

export const chapterRouter = createRouter({
  list: publicQuery
    .input(z.object({ novelId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, input.novelId))
        .orderBy(asc(chapters.chapterNumber));
    }),

  getById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [chapter] = await db
        .select()
        .from(chapters)
        .where(eq(chapters.id, input.id));
      return chapter || null;
    }),

  update: publicQuery
    .input(z.object({
      id: z.number(),
      contentTranslated: z.string().optional(),
      title: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      const [chapter] = await db
        .update(chapters)
        .set(data)
        .where(eq(chapters.id, id))
        .returning();
      return chapter;
    }),
});
```

#### api/routers/translate.ts

```typescript
import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { chapters, novels, translationMemory, vectorChunks } from "@db/schema";
import { eq, sql } from "drizzle-orm";
import { streamChat, getEmbedding } from "../services/deepseek";

/**
 * Fuzzy Translation Memory Match
 * 
 * 工作原理：
 * 1. translation_memory 表的 embedding 字段在素材入库时已预计算（sourceText 的向量）
 * 2. 翻译时，对待翻译段落做一次性 embedding（query embedding）
 * 3. 用 pgvector 的 <=> 操作符在预计算 embedding 上快速检索最相似的 sourceText
 * 4. 返回对应 translatedText 作为 few-shot 示例
 * 
 * 为什么比精确匹配好：
 * - "The sky burned with amber light" 和 "The sky darkened as the storm approached"
 *   措辞不同但语义相近 → 向量相似度高 → 能召回风格/术语参考
 * - 用户喂了 1000 条语料，不需要 exact match，相似度排序即可找到最佳参考
 */
async function fuzzyTranslationMemoryMatch(
  segment: string,
  novelId: number,
  topK: number = 3
): Promise<Array<{ sourceText: string; translatedText: string; similarity: number }>> {
  const db = getDb();

  try {
    // 对待翻译段落做 embedding（唯一需要实时计算的一步）
    const queryEmbedding = await getEmbedding(segment);

    // 利用预计算 embedding 做 pgvector 检索 — O(1) 索引查询，不是全表扫描
    const results = await db.execute(
      `SELECT source_text, translated_text, 1 - (embedding <=> $1) as similarity
       FROM translation_memory
       WHERE (novel_id = $2 OR $2 IS NULL)
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1
       LIMIT $3`,
      [JSON.stringify(queryEmbedding), novelId, topK]
    );

    return (results.rows || []).map((row: any) => ({
      sourceText: row.source_text,
      translatedText: row.translated_text,
      similarity: row.similarity,
    }));
  } catch {
    // embedding API 不可用或失败时回退：返回该小说的最新翻译记忆
    const memories = await db
      .select()
      .from(translationMemory)
      .where(eq(translationMemory.novelId, novelId))
      .limit(topK);

    return memories.map(m => ({
      sourceText: m.sourceText,
      translatedText: m.translatedText,
      similarity: 1.0,
    }));
  }
}

/**
 * Hybrid RAG Search for Translation
 * 同时执行向量检索 + 全文检索，合并重排
 */
async function hybridSearchForTranslation(
  query: string,
  novelId: number,
  limit: number = 3
): Promise<Array<{ content: string; sourceType: string; score: number }>> {
  const db = getDb();

  // 向量检索
  let vectorResults: any[] = [];
  try {
    const embedding = await getEmbedding(query);
    const vec = await db.execute(
      `SELECT content, source_type, 1 - (embedding <=> $1) as score
       FROM vector_chunks
       WHERE novel_id = $2
       ORDER BY embedding <=> $1
       LIMIT $3`,
      [JSON.stringify(embedding), novelId, limit * 2]
    );
    vectorResults = vec.rows || [];
  } catch { /* ignore */ }

  // 全文检索
  const fullText = await db.execute(
    `SELECT content, source_type,
     ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $1)) as score
     FROM vector_chunks
     WHERE novel_id = $2
       AND to_tsvector('simple', content) @@ plainto_tsquery('simple', $1)
     ORDER BY score DESC
     LIMIT $3`,
    [query, novelId, limit * 2]
  );

  // 合并 + 简单重排
  const merged = new Map<string, { content: string; sourceType: string; score: number }>();

  for (const row of vectorResults) {
    const key = row.content.slice(0, 100);
    merged.set(key, { content: row.content, sourceType: row.source_type, score: (merged.get(key)?.score || 0) + row.score * 0.6 });
  }

  for (const row of fullText.rows || []) {
    const key = row.content.slice(0, 100);
    merged.set(key, { content: row.content, sourceType: row.source_type, score: (merged.get(key)?.score || 0) + row.score * 0.4 });
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// 翻译提示词模板
function buildTranslationPrompt(
  sourceText: string,
  style: string,
  fuzzyMatches: Array<{ sourceText: string; translatedText: string; similarity: number }>,
  ragReference: Array<{ content: string; score: number }>,
  userPrompt?: string
): string {
  // Fuzzy 翻译记忆 few-shot
  const fewShotStr = fuzzyMatches.length > 0
    ? "\n【翻译参考（风格/术语一致性参考）】\n" +
      fuzzyMatches.slice(0, 3).map(m =>
        `原文：${m.sourceText}\n译文：${m.translatedText}`
      ).join("\n---\n")
    : "";

  // RAG 素材参考
  const ragStr = ragReference.length > 0
    ? "\n【上下文参考】\n" + ragReference.map(r => r.content).join("\n---\n").slice(0, 1500)
    : "";

  const styleInstruction = {
    literal: "直译为主，保留原文结构和语序",
    fluent: "意译为主，让译文自然流畅，符合中文表达习惯",
    literary: "文学性翻译，注重文采和意境，适合小说",
  }[style] || "意译为主，让译文自然流畅";

  // 用户自定义提示词（最高优先级）
  const userStr = userPrompt
    ? `\n【用户自定义要求】(请优先遵守以下要求)\n${userPrompt}\n`
    : "";

  return `请将以下外文小说段落翻译成中文。

要求：${styleInstruction}${fewShotStr}${ragStr}${userStr}

原文：
${sourceText}

译文：`;
}

export const translateRouter = createRouter({
  start: publicQuery
    .input(z.object({
      novelId: z.number(),
      style: z.enum(["literal", "fluent", "literary"]).default("fluent"),
      userPrompt: z.string().optional(), // 用户自定义翻译指令
    }))
    .mutation(async function* ({ input }) {
      const db = getDb();

      // 获取所有未翻译的章节
      const chapterList = await db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, input.novelId));

      let completed = 0;
      const total = chapterList.length;

      for (const chapter of chapterList) {
        if (!chapter.contentOriginal) continue;

        // 分段翻译（每段不超过 2000 字）
        const segments = splitText(chapter.contentOriginal, 2000);
        let translatedContent = "";

        for (const segment of segments) {
          // 1. Fuzzy translation memory match
          const fuzzyMatches = await fuzzyTranslationMemoryMatch(
            segment,
            input.novelId,
            3
          );

          // 2. Hybrid RAG search
          const ragRef = await hybridSearchForTranslation(
            segment.slice(0, 200),
            input.novelId,
            2
          );

          // 3. Build prompt with all augmentations
          const prompt = buildTranslationPrompt(
            segment,
            input.style,
            fuzzyMatches,
            ragRef,
            input.userPrompt
          );

          const stream = streamChat({
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            maxTokens: 4000,
          });

          for await (const chunk of stream) {
            translatedContent += chunk;
          }
        }

        // 保存翻译结果
        await db
          .update(chapters)
          .set({ contentTranslated: translatedContent.trim() })
          .where(eq(chapters.id, chapter.id));

        completed++;
        yield {
          progress: Math.round((completed / total) * 100),
          currentChapter: chapter.chapterNumber,
          totalChapters: total,
        };
      }

      // 更新小说状态
      await db
        .update(novels)
        .set({ status: "translated" })
        .where(eq(novels.id, input.novelId));

      yield { progress: 100, completed: true };
    }),

  // 导出翻译结果为不同格式
  export: publicQuery
    .input(z.object({
      novelId: z.number(),
      format: z.enum(["pure", "parallel"]).default("pure"),
      // pure = 纯中文（给人阅读）
      // parallel = 原文+译文对照格式（=== 分隔，可直接投喂RAG）
    }))
    .query(async ({ input }) => {
      const db = getDb();

      const chapterList = await db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, input.novelId))
        .orderBy(asc(chapters.chapterNumber));

      if (input.format === "pure") {
        // 纯中文：只拼接译文
        return {
          format: "pure" as const,
          content: chapterList
            .map(ch => ch.contentTranslated || "")
            .filter(Boolean)
            .join("\n\n"),
        };
      }

      // 对照格式：原文 === 译文 === 原文 === 译文 ...
      const pairs: string[] = [];
      for (const ch of chapterList) {
        const sourceParas = splitTextIntoParagraphs(ch.contentOriginal || "");
        const translatedParas = splitTextIntoParagraphs(ch.contentTranslated || "");
        const pairCount = Math.min(sourceParas.length, translatedParas.length);
        for (let i = 0; i < pairCount; i++) {
          pairs.push(`${sourceParas[i].trim()}\n===\n${translatedParas[i].trim()}`);
        }
      }

      return {
        format: "parallel" as const,
        content: pairs.join("\n===\n"),
      };
    }),
});

// 将文本分割为段落数组（用于双文件对齐和导出）
function splitTextIntoParagraphs(text: string): string[] {
  // 按空行分割段落
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

// 文本分段函数（翻译用，按最大长度）
function splitText(text: string, maxLength: number): string[] {
  const segments: string[] = [];
  let current = "";

  for (const paragraph of text.split("\n")) {
    if (current.length + paragraph.length > maxLength && current.length > 0) {
      segments.push(current);
      current = paragraph;
    } else {
      current += (current ? "\n" : "") + paragraph;
    }
  }

  if (current) segments.push(current);
  return segments;
}
```

#### api/routers/lore.ts

```typescript
import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { series, characterCards, worldBibles, seriesCanon } from "@db/schema";
import { eq, asc } from "drizzle-orm";

export const loreRouter = createRouter({
  // Series
  series: createRouter({
    list: publicQuery.query(async () => {
      const db = getDb();
      return db.select().from(series).orderBy(series.createdAt);
    }),

    create: publicQuery
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        universeName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb();
        const [s] = await db.insert(series).values(input).returning();
        return s;
      }),
  }),

  // Characters
  character: createRouter({
    list: publicQuery
      .input(z.object({ seriesId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb();
        return db
          .select()
          .from(characterCards)
          .where(eq(characterCards.seriesId, input.seriesId));
      }),

    create: publicQuery
      .input(z.object({
        seriesId: z.number(),
        name: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        age: z.string().optional(),
        personalityTraits: z.array(z.string()).default([]),
        coreMotivations: z.string().optional(),
        relationships: z.record(z.any()).default({}),
        speechPatterns: z.string().optional(),
        taboos: z.array(z.string()).default([]),
        canonicalArcSummary: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb();
        const [char] = await db.insert(characterCards).values(input).returning();
        return char;
      }),

    update: publicQuery
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        age: z.string().optional(),
        personalityTraits: z.array(z.string()).optional(),
        coreMotivations: z.string().optional(),
        relationships: z.record(z.any()).optional(),
        speechPatterns: z.string().optional(),
        taboos: z.array(z.string()).optional(),
        canonicalArcSummary: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb();
        const { id, ...data } = input;
        const [char] = await db
          .update(characterCards)
          .set(data)
          .where(eq(characterCards.id, id))
          .returning();
        return char;
      }),

    delete: publicQuery
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = getDb();
        await db.delete(characterCards).where(eq(characterCards.id, input.id));
        return { success: true };
      }),
  }),

  // World Bible
  worldBible: createRouter({
    get: publicQuery
      .input(z.object({ seriesId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb();
        const [wb] = await db
          .select()
          .from(worldBibles)
          .where(eq(worldBibles.seriesId, input.seriesId));
        return wb || null;
      }),

    createOrUpdate: publicQuery
      .input(z.object({
        seriesId: z.number(),
        geography: z.string().optional(),
        magicSystem: z.string().optional(),
        technologyLevel: z.string().optional(),
        factions: z.array(z.any()).optional(),
        timelineEvents: z.array(z.any()).optional(),
        culturalCustoms: z.string().optional(),
        linguisticNotes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb();
        const { seriesId, ...data } = input;

        // 先检查是否已存在
        const [existing] = await db
          .select()
          .from(worldBibles)
          .where(eq(worldBibles.seriesId, seriesId));

        if (existing) {
          const [wb] = await db
            .update(worldBibles)
            .set(data)
            .where(eq(worldBibles.id, existing.id))
            .returning();
          return wb;
        } else {
          const [wb] = await db
            .insert(worldBibles)
            .values({ seriesId, ...data })
            .returning();
          return wb;
        }
      }),
  }),

  // Canon
  canon: createRouter({
    list: publicQuery
      .input(z.object({ seriesId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb();
        return db
          .select()
          .from(seriesCanon)
          .where(eq(seriesCanon.seriesId, input.seriesId))
          .orderBy(asc(seriesCanon.eventOrder));
      }),

    create: publicQuery
      .input(z.object({
        seriesId: z.number(),
        eventOrder: z.number(),
        description: z.string().min(1),
        isImmutable: z.boolean().default(false),
      }))
      .mutation(async ({ input }) => {
        const db = getDb();
        const [canon] = await db.insert(seriesCanon).values(input).returning();
        return canon;
      }),

    delete: publicQuery
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = getDb();
        await db.delete(seriesCanon).where(eq(seriesCanon.id, input.id));
        return { success: true };
      }),
  }),
});
```

#### api/routers/material.ts（素材池 Router — RAG 投喂入口）

```typescript
import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { materials, vectorChunks } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { getEmbedding } from "../services/deepseek";

// 文本分段
function splitIntoChunks(text: string, chunkSize: number = 500, overlap: number = 100): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
    if (start >= end) break;
  }
  return chunks;
}

export const materialRouter = createRouter({
  // 素材列表
  list: publicQuery
    .input(z.object({
      seriesId: z.number().optional(),
      sourceType: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      let query = db.select().from(materials).orderBy(desc(materials.createdAt));
      // Note: 实际过滤使用 Drizzle 条件查询
      return query;
    }),

  // 创建素材（单文件粘贴/上传）
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
      const db = getDb();
      const [material] = await db.insert(materials).values({
        title: input.title,
        content: input.content,
        sourceType: input.sourceType,
        seriesId: input.seriesId || null,
        tags: input.tags,
        description: input.description,
        status: "pending",
      }).returning();
      return material;
    }),

  // 双文件上传（原文 + 译文分别上传，自动对齐）
  createFromDualFiles: publicQuery
    .input(z.object({
      title: z.string().min(1),
      sourceText: z.string().min(1),      // 原文全文
      translatedText: z.string().min(1),  // 译文全文
      seriesId: z.number().optional(),
      tags: z.array(z.string()).default([]),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      // 1. 分别解析原文和译文为段落数组
      const sourceParagraphs = splitTextIntoParagraphs(input.sourceText);
      const translatedParagraphs = splitTextIntoParagraphs(input.translatedText);

      // 2. 自动对齐：按顺序 1:1 配对
      const pairCount = Math.min(sourceParagraphs.length, translatedParagraphs.length);
      const alignedPairs: Array<{ source: string; translated: string }> = [];
      for (let i = 0; i < pairCount; i++) {
        if (sourceParagraphs[i].trim().length > 5 && translatedParagraphs[i].trim().length > 2) {
          alignedPairs.push({
            source: sourceParagraphs[i].trim(),
            translated: translatedParagraphs[i].trim(),
          });
        }
      }

      // 3. 将对齐结果序列化为 === 分隔格式存入 materials
      const serialized = alignedPairs
        .map(p => `${p.source}\n===\n${p.translated}`)
        .join("\n===\n");

      const [material] = await db.insert(materials).values({
        title: input.title,
        content: serialized,
        sourceType: "parallel_corpus",
        seriesId: input.seriesId || null,
        tags: input.tags,
        description: input.description || `自动对齐: ${alignedPairs.length} 对段落 (原文${sourceParagraphs.length}段 / 译文${translatedParagraphs.length}段)`,
        status: "pending",
      }).returning();

      return {
        ...material,
        _meta: {
          sourceParagraphCount: sourceParagraphs.length,
          translatedParagraphCount: translatedParagraphs.length,
          alignedPairCount: alignedPairs.length,
          alignedPairs, // 返回给前端预览
        },
      };
    }),

  // 向量化索引（将素材内容切分并嵌入 pgvector）
  index: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();

      // 获取素材
      const [material] = await db
        .select()
        .from(materials)
        .where(eq(materials.id, input.id));

      if (!material) throw new Error("Material not found");
      if (!material.content) throw new Error("Material has no content");

      // 更新状态为 indexing
      await db
        .update(materials)
        .set({ status: "indexing" })
        .where(eq(materials.id, input.id));

      try {
        let indexedCount = 0;

        // ============================================================
        // 平行语料特殊处理：段落对齐 + 双写（translation_memory + vector_chunks）
        // ============================================================
        if (material.sourceType === "parallel_corpus") {
          // 解析对齐：原文和译文用分隔线 "===" 或空行分隔
          // 格式：原文段落\n===\n译文段落\n===\n原文段落\n===\n译文段落
          const pairs = parseParallelCorpus(material.content);

          for (const { source, translated } of pairs) {
            if (source.trim().length < 10 || translated.trim().length < 5) continue;

            try {
              // 预计算原文 embedding
              const embedding = await getEmbedding(source);

              // 1. 写入 translation_memory（核心：预计算 embedding 用于 fuzzy match）
              await db.insert(translationMemory).values({
                sourceText: source.trim(),
                translatedText: translated.trim(),
                embedding: embedding as any, // 预计算 embedding
                seriesId: material.seriesId || null,
                novelId: null,
                frequency: 1,
              });

              // 2. 同时写入 vector_chunks（用于语义检索）
              await db.insert(vectorChunks).values({
                content: source.trim(),
                embedding: embedding as any,
                sourceType: "parallel_corpus",
                seriesId: material.seriesId,
                metadata: {
                  materialId: material.id,
                  materialTitle: material.title,
                  translatedText: translated.trim().slice(0, 200), // 元数据中存译文摘要
                  indexedAt: new Date().toISOString(),
                },
              });

              indexedCount++;
            } catch (err) {
              console.error("Parallel pair embedding failed:", err);
            }
          }
        } else {
          // ============================================================
          // 参考小说 / 知识文档：普通 chunk + 向量化
          // ============================================================
          const chunks = splitIntoChunks(material.content, 500, 100);

          for (const chunk of chunks) {
            if (chunk.trim().length < 50) continue;

            try {
              const embedding = await getEmbedding(chunk);

              await db.insert(vectorChunks).values({
                content: chunk,
                embedding: embedding as any,
                sourceType: material.sourceType,
                novelId: null,
                seriesId: material.seriesId,
                metadata: {
                  materialId: material.id,
                  materialTitle: material.title,
                  indexedAt: new Date().toISOString(),
                },
              });

              indexedCount++;
            } catch (err) {
              console.error("Chunk embedding failed:", err);
            }
          }
        }

        // 更新状态为 indexed
        await db
          .update(materials)
          .set({ status: "indexed", indexedChunks: indexedCount })
          .where(eq(materials.id, input.id));

        return { success: true, indexedChunks: indexedCount };
      } catch (error) {
        await db
          .update(materials)
          .set({ status: "failed" })
          .where(eq(materials.id, input.id));
        throw error;
      }
    }),

  // 删除素材（同时删除向量库中对应 chunks）
  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();

      // 删除关联的 vector_chunks（通过 metadata->materialId 匹配）
      // 注意：Drizzle 不支持直接 JSON 字段查询，这里使用原始 SQL
      await db.execute(
        `DELETE FROM vector_chunks WHERE metadata->>'materialId' = $1`,
        [String(input.id)]
      );

      // 删除素材记录
      await db.delete(materials).where(eq(materials.id, input.id));

      return { success: true };
    }),

  // 更新素材作用域（绑定系列/标签）
  updateScope: publicQuery
    .input(z.object({
      id: z.number(),
      seriesId: z.number().optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      const [material] = await db
        .update(materials)
        .set(data)
        .where(eq(materials.id, id))
        .returning();
      return material;
    }),
});
```

#### api/routers/tag.ts

```typescript
import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { tags, novelTags } from "@db/schema";
import { eq } from "drizzle-orm";

export const tagRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    return db.select().from(tags);
  }),

  create: publicQuery
    .input(z.object({
      name: z.string().min(1),
      parentId: z.number().optional(),
      color: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [tag] = await db.insert(tags).values(input).returning();
      return tag;
    }),

  assign: publicQuery
    .input(z.object({
      novelId: z.number(),
      tagId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [nt] = await db.insert(novelTags).values(input).returning();
      return nt;
    }),

  remove: publicQuery
    .input(z.object({
      novelId: z.number(),
      tagId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .delete(novelTags)
        .where(eq(novelTags.novelId, input.novelId) && eq(novelTags.tagId, input.tagId));
      return { success: true };
    }),
});
```

#### api/routers/generate.ts（Phase 1 基础骨架）

```typescript
import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";

export const generateRouter = createRouter({
  // 在 Phase 2 中完整实现
  // Phase 1 只提供骨架 ping
  ping: publicQuery.query(() => ({ ok: true, message: "generate router ready for phase 2" })),
});
```

### 2.6 注册所有 Router（含 material）

更新 `api/router.ts`：

```typescript
import { createRouter, publicQuery } from "./middleware";
import { novelRouter } from "./routers/novel";
import { chapterRouter } from "./routers/chapter";
import { translateRouter } from "./routers/translate";
import { loreRouter } from "./routers/lore";
import { tagRouter } from "./routers/tag";
import { materialRouter } from "./routers/material";
import { generateRouter } from "./routers/generate";
import { ragRouter } from "./routers/rag";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  novel: novelRouter,
  chapter: chapterRouter,
  translate: translateRouter,
  lore: loreRouter,
  tag: tagRouter,
  material: materialRouter,
  generate: generateRouter,
  rag: ragRouter,
});

export type AppRouter = typeof appRouter;
```

#### api/routers/rag.ts（Phase 1 基础骨架）

```typescript
import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";

export const ragRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, message: "rag router ready for phase 2" })),
});
```

### 2.6 注册所有 Router

更新 `api/router.ts`：

```typescript
import { createRouter, publicQuery } from "./middleware";
import { novelRouter } from "./routers/novel";
import { chapterRouter } from "./routers/chapter";
import { translateRouter } from "./routers/translate";
import { loreRouter } from "./routers/lore";
import { tagRouter } from "./routers/tag";
import { generateRouter } from "./routers/generate";
import { ragRouter } from "./routers/rag";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  novel: novelRouter,
  chapter: chapterRouter,
  translate: translateRouter,
  lore: loreRouter,
  tag: tagRouter,
  generate: generateRouter,
  rag: ragRouter,
});

export type AppRouter = typeof appRouter;
```

---

## 3. 前端开发任务

### 3.1 tRPC 连接

确认 `src/providers/trpc.tsx` 已正确配置。如果不完整，替换为：

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useState } from "react";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";

export const trpc = createTRPCReact<AppRouter>();

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
        }),
      ],
      transformer: superjson,
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
```

### 3.2 阅读器页面（Reader.tsx）

阅读器是核心页面，要求：

**布局**: 
- 居中布局，最大宽度 800px
- 背景色 #111827，正文 #FDFBF5
- 顶部导航栏显示章节标题和进度
- 左侧/右侧可滑出的章节列表面板

**排版要求**:
- 正文字体: Noto Serif SC
- 行高: 1.8
- 段落首行缩进 2 字符
- 章节间用 `* * *` 分隔符
- 标题使用 Playfair Display

**功能**:
- 章节列表（侧边栏）
- 上一章/下一章按钮
- 双语模式切换（原文/译文/双语）
- 字体大小调整
- 深色/羊皮纸主题切换

```tsx
// src/pages/Reader.tsx
// 阅读器主页面
// - 从路由参数获取 novelId
// - 查询章节列表
// - 渲染当前章节内容
// - 支持章节切换、双语模式

import { useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useState } from "react";
import { ChevronLeft, ChevronRight, List, Languages, Type, Moon } from "lucide-react";

export default function Reader() {
  const { novelId } = useParams<{ novelId: string }>();
  const id = parseInt(novelId || "0");
  const [currentChapterId, setCurrentChapterId] = useState<number | null>(null);
  const [bilingualMode, setBilingualMode] = useState<"original" | "translated" | "bilingual">("translated");
  const [showSidebar, setShowSidebar] = useState(false);
  const [fontSize, setFontSize] = useState(18);

  const { data: chapterList } = trpc.chapter.list.useQuery({ novelId: id });
  const { data: currentChapter } = trpc.chapter.getById.useQuery(
    { id: currentChapterId || 0 },
    { enabled: !!currentChapterId }
  );

  // 自动选择第一章
  if (chapterList && chapterList.length > 0 && !currentChapterId) {
    setCurrentChapterId(chapterList[0].id);
  }

  const currentIndex = chapterList?.findIndex(ch => ch.id === currentChapterId) ?? -1;

  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 bg-[#111827]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-[800px] mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => setShowSidebar(!showSidebar)} className="p-2 hover:bg-white/10 rounded-lg">
            <List className="w-5 h-5" />
          </button>
          <span className="font-mono text-sm text-white/60">
            {currentChapter?.title || "选择章节"}
          </span>
          <div className="flex gap-2">
            <button onClick={() => setBilingualMode(
              bilingualMode === "original" ? "translated" : bilingualMode === "translated" ? "bilingual" : "original"
            )} className="p-2 hover:bg-white/10 rounded-lg" title="切换双语">
              <Languages className="w-5 h-5" />
            </button>
            <button onClick={() => setFontSize(s => Math.min(s + 2, 28))} className="p-2 hover:bg-white/10 rounded-lg">
              <Type className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex relative">
        {/* 章节列表侧边栏 */}
        {showSidebar && (
          <aside className="fixed left-0 top-14 bottom-0 w-72 bg-[#1F2937] border-r border-white/10 overflow-y-auto z-40">
            <div className="p-4">
              <h3 className="font-mono text-xs uppercase tracking-wider text-white/50 mb-4">章节列表</h3>
              {chapterList?.map((ch, idx) => (
                <button
                  key={ch.id}
                  onClick={() => { setCurrentChapterId(ch.id); setShowSidebar(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    ch.id === currentChapterId
                      ? "bg-amber-500/20 text-amber-400"
                      : "hover:bg-white/5 text-white/70"
                  }`}
                >
                  <span className="font-mono text-xs text-white/40 mr-2">{idx + 1}</span>
                  {ch.title || `第${idx + 1}章`}
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* 正文区域 */}
        <main className="flex-1 max-w-[800px] mx-auto px-6 py-12">
          {currentChapter ? (
            <article style={{ fontSize: `${fontSize}px` }} className="font-serif leading-[1.8]">
              {/* 原文 */}
              {(bilingualMode === "original" || bilingualMode === "bilingual") && (
                <div className={bilingualMode === "bilingual" ? "mb-8 pb-8 border-b border-white/10" : ""}>
                  <p className="font-mono text-xs text-amber-500/60 mb-4 uppercase tracking-wider">原文</p>
                  <div className="whitespace-pre-wrap text-white/80">
                    {currentChapter.contentOriginal}
                  </div>
                </div>
              )}
              {/* 译文 */}
              {(bilingualMode === "translated" || bilingualMode === "bilingual") && (
                <div>
                  {bilingualMode === "bilingual" && (
                    <p className="font-mono text-xs text-amber-500/60 mb-4 uppercase tracking-wider">译文</p>
                  )}
                  <div className="whitespace-pre-wrap">
                    {currentChapter.contentTranslated || "暂无翻译"}
                  </div>
                </div>
              )}
            </article>
          ) : (
            <div className="text-center text-white/40 mt-20">请选择章节开始阅读</div>
          )}

          {/* 翻页按钮 */}
          <div className="flex justify-between mt-16">
            <button
              onClick={() => {
                if (currentIndex > 0 && chapterList) {
                  setCurrentChapterId(chapterList[currentIndex - 1].id);
                }
              }}
              disabled={currentIndex <= 0}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="font-mono text-sm">上一章</span>
            </button>
            <button
              onClick={() => {
                if (chapterList && currentIndex < chapterList.length - 1) {
                  setCurrentChapterId(chapterList[currentIndex + 1].id);
                }
              }}
              disabled={!chapterList || currentIndex >= chapterList.length - 1}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-400 text-[#111827] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <span className="font-mono text-sm font-medium">下一章</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
```

### 3.3 小说管理页面（NovelManager.tsx）

实现小说上传、列表展示、删除功能：

```tsx
// src/pages/NovelManager.tsx
// - 显示所有小说列表
// - 支持"模拟上传"（由于没有真实文件上传，可以手动输入标题和内容）
// - 删除小说
// - 跳转到阅读器

import { trpc } from "@/providers/trpc";
import { useNavigate } from "react-router";
import { useState } from "react";
import { BookOpen, Trash2, Plus, Upload } from "lucide-react";

export default function NovelManager() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: novels, isLoading } = trpc.novel.list.useQuery();
  const createMutation = trpc.novel.create.useMutation({
    onSuccess: () => utils.novel.list.invalidate(),
  });
  const deleteMutation = trpc.novel.delete.useMutation({
    onSuccess: () => utils.novel.list.invalidate(),
  });

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");

  const handleCreate = () => {
    if (!title.trim()) return;
    createMutation.mutate({ title, author: author || undefined });
    setTitle("");
    setAuthor("");
    setShowForm(false);
  };

  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      <div className="max-w-[1400px] mx-auto px-8 py-12">
        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-3xl font-serif font-bold">我的小说文库</h1>
            <p className="text-white/50 mt-2 font-mono text-sm">管理你的翻译与阅读项目</p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加小说
          </button>
        </div>

        {showForm && (
          <div className="mb-8 p-6 rounded-xl bg-white/5 border border-white/10">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block font-mono text-xs text-white/50 mb-2">标题</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]"
                  placeholder="小说标题"
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/50 mb-2">作者</label>
                <input
                  value={author}
                  onChange={e => setAuthor(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]"
                  placeholder="作者名"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleCreate} className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium">
                创建
              </button>
              <button onClick={() => setShowForm(false)} className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-full">
                取消
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center text-white/40 py-20">加载中...</div>
        ) : novels?.length === 0 ? (
          <div className="text-center text-white/40 py-20">
            <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>还没有小说，点击上方按钮添加</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {novels?.map(novel => (
              <div
                key={novel.id}
                className="group p-6 rounded-xl bg-white/[0.03] border border-white/10 hover:border-amber-500/30 hover:bg-white/[0.05] transition-all cursor-pointer hover:-translate-y-1"
                onClick={() => navigate(`/reader/${novel.id}`)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-amber-500" />
                  </div>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (confirm("确认删除？")) deleteMutation.mutate({ id: novel.id });
                    }}
                    className="p-2 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <h3 className="font-serif text-lg font-semibold mb-2 line-clamp-2">{novel.title}</h3>
                <p className="text-white/50 text-sm mb-4">{novel.author || "未知作者"}</p>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${
                    novel.status === "translated"
                      ? "bg-green-500/20 text-green-400"
                      : novel.status === "reading"
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-white/10 text-white/50"
                  }`}>
                    {novel.status === "translated" ? "已翻译" : novel.status === "reading" ? "阅读中" : "未读"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

### 3.4 设定库页面（LoreLibrary.tsx）

实现系列管理、角色卡 CRUD：

```tsx
// src/pages/LoreLibrary.tsx
// - 系列（Series）列表与创建
// - 角色卡（Character Cards）CRUD
// - 世界观圣经（World Bible）编辑
// - 正史记事（Canon）时间线

import { trpc } from "@/providers/trpc";
import { useState } from "react";
import { Plus, Users, Globe, BookMarked, ChevronRight, Trash2, Edit2 } from "lucide-react";

export default function LoreLibrary() {
  const utils = trpc.useUtils();
  const { data: seriesList } = trpc.lore.series.list.useQuery();
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null);
  const [showSeriesForm, setShowSeriesForm] = useState(false);
  const [showCharForm, setShowCharForm] = useState(false);

  // 表单状态
  const [seriesName, setSeriesName] = useState("");
  const [charName, setCharName] = useState("");
  const [charPersonality, setCharPersonality] = useState("");

  const createSeries = trpc.lore.series.create.useMutation({
    onSuccess: () => {
      utils.lore.series.list.invalidate();
      setSeriesName("");
      setShowSeriesForm(false);
    },
  });

  const createCharacter = trpc.lore.character.create.useMutation({
    onSuccess: () => {
      utils.lore.character.list.invalidate();
      setCharName("");
      setCharPersonality("");
      setShowCharForm(false);
    },
  });

  const deleteCharacter = trpc.lore.character.delete.useMutation({
    onSuccess: () => utils.lore.character.list.invalidate(),
  });

  const { data: characters } = trpc.lore.character.list.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  );

  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      <div className="max-w-[1400px] mx-auto px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-serif font-bold">设定库</h1>
            <p className="text-white/50 mt-2 font-mono text-sm">管理系列世界观、角色卡与正史记事</p>
          </div>
          <button
            onClick={() => setShowSeriesForm(!showSeriesForm)}
            className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            创建系列
          </button>
        </div>

        {/* 创建系列表单 */}
        {showSeriesForm && (
          <div className="mb-8 p-6 rounded-xl bg-white/5 border border-white/10">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block font-mono text-xs text-white/50 mb-2">系列名称</label>
                <input
                  value={seriesName}
                  onChange={e => setSeriesName(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]"
                  placeholder="如：玄幻修仙系列"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => createSeries.mutate({ name: seriesName })}
                className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium"
              >
                创建
              </button>
              <button onClick={() => setShowSeriesForm(false)} className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-full">
                取消
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-8">
          {/* 系列列表 */}
          <aside className="w-72 shrink-0">
            <h2 className="font-mono text-xs uppercase tracking-wider text-white/50 mb-4">系列列表</h2>
            <div className="space-y-2">
              {seriesList?.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSeriesId(s.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-colors flex items-center gap-3 ${
                    s.id === selectedSeriesId
                      ? "bg-amber-500/20 border border-amber-500/30"
                      : "bg-white/[0.03] border border-transparent hover:bg-white/[0.05]"
                  }`}
                >
                  <BookMarked className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="truncate">{s.name}</span>
                </button>
              ))}
            </div>
          </aside>

          {/* 角色卡列表 */}
          <main className="flex-1">
            {selectedSeriesId ? (
              <>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-mono text-xs uppercase tracking-wider text-white/50 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    角色卡
                  </h2>
                  <button
                    onClick={() => setShowCharForm(!showCharForm)}
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    添加角色
                  </button>
                </div>

                {showCharForm && (
                  <div className="mb-6 p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block font-mono text-xs text-white/50 mb-2">角色名</label>
                        <input
                          value={charName}
                          onChange={e => setCharName(e.target.value)}
                          className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]"
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-xs text-white/50 mb-2">性格特征（逗号分隔）</label>
                        <input
                          value={charPersonality}
                          onChange={e => setCharPersonality(e.target.value)}
                          className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]"
                          placeholder="如：冷静, 坚毅, 重情义"
                        />
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() =>
                          createCharacter.mutate({
                            seriesId: selectedSeriesId,
                            name: charName,
                            personalityTraits: charPersonality.split(",").map(s => s.trim()).filter(Boolean),
                          })
                        }
                        className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium text-sm"
                      >
                        创建
                      </button>
                      <button onClick={() => setShowCharForm(false)} className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm">
                        取消
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {characters?.map(char => (
                    <div key={char.id} className="p-5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-amber-500/20 transition-all group">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-serif text-lg font-semibold">{char.name}</h3>
                        <button
                          onClick={() => {
                            if (confirm("确认删除角色？")) deleteCharacter.mutate({ id: char.id });
                          }}
                          className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {(char.personalityTraits as string[] || []).map((trait: string) => (
                          <span key={trait} className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-xs font-mono">
                            {trait}
                          </span>
                        ))}
                      </div>
                      {char.coreMotivations && (
                        <p className="text-white/50 text-sm line-clamp-2">{char.coreMotivations}</p>
                      )}
                      {char.speechPatterns && (
                        <p className="text-white/30 text-xs mt-2 font-mono">语言风格: {char.speechPatterns}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center text-white/30 py-20">
                <Globe className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>选择一个系列以查看角色卡</p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
```

### 3.5 工作台主页（Home.tsx）基础骨架

Phase 1 只实现基础版本，Phase 3 加入 Three.js 特效：

```tsx
// src/pages/Home.tsx
// Phase 1: 基础版本
// Phase 3: 加入 Neon Silk 背景 + Agent 卡片 + 书库网格

import { useNavigate } from "react-router";
import { BookOpen, PenTool, Settings, Sparkles } from "lucide-react";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#000000] text-[#FDFBF5] relative">
      {/* 背景装饰（Phase 1 简单版本，Phase 3 替换为 Three.js） */}
      <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 via-transparent to-transparent pointer-events-none" />

      <div className="relative max-w-[1400px] mx-auto px-8 py-16">
        {/* 顶部状态区 */}
        <header className="mb-16">
          <div className="flex items-center justify-between p-4 rounded-full bg-white/[0.03] backdrop-blur-md border border-white/10 max-w-2xl mx-auto">
            <span className="font-mono text-xs text-white/50 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              System • Translation Memory Active
            </span>
            <div className="flex gap-2">
              {["翻译", "二创", "设定库"].map(label => (
                <button
                  key={label}
                  onClick={() => {
                    if (label === "翻译") navigate("/library");
                    if (label === "二创") navigate("/studio");
                    if (label === "设定库") navigate("/lore");
                  }}
                  className="px-4 py-1.5 rounded-full text-sm bg-white/5 hover:bg-amber-500 hover:text-[#111827] transition-colors font-mono"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* 欢迎区域 */}
        <div className="text-center mb-20">
          <h1 className="text-5xl font-serif font-bold mb-4 tracking-tight">
            幻境小说工作台
          </h1>
          <p className="text-white/50 font-mono text-sm mb-8">
            AI 驱动的小说翻译与二创平台
          </p>
          <button
            onClick={() => navigate("/studio")}
            className="px-8 py-3 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium transition-colors"
          >
            开始创作
          </button>
        </div>

        {/* 功能入口 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {[
            { icon: BookOpen, title: "小说管理", desc: "上传、管理与翻译外文小说", path: "/library" },
            { icon: PenTool, title: "二创工作台", desc: "基于 AI 的小说续写与改写", path: "/studio" },
            { icon: Settings, title: "设定库", desc: "管理角色卡、世界观与正史", path: "/lore" },
          ].map(({ icon: Icon, title, desc, path }) => (
            <button
              key={title}
              onClick={() => navigate(path)}
              className="group p-6 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-amber-500/30 hover:bg-white/[0.05] transition-all text-left"
            >
              <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center mb-4 group-hover:bg-amber-500/30 transition-colors">
                <Icon className="w-6 h-6 text-amber-500" />
              </div>
              <h3 className="font-serif text-lg font-semibold mb-2">{title}</h3>
              <p className="text-white/50 text-sm">{desc}</p>
            </button>
          ))}
        </div>

        {/* 页脚 */}
        <footer className="text-center mt-20 text-white/30 font-mono text-xs">
          <p>连接 DeepSeek API • 记忆库就绪 • 等待创作指令</p>
        </footer>
      </div>
    </div>
  );
}
```

### 3.6 素材池页面（MaterialPool.tsx）

素材池是用户向 RAG 投喂素材的专用入口，支持上传原文+译文对、参考小说、知识文档：

```tsx
// src/pages/MaterialPool.tsx
// RAG 素材池 — 用户主动投喂素材的入口

import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  Database, Upload, FileText, BookOpen, Lightbulb,
  Trash2, Tag, Sparkles, AlertCircle, CheckCircle, Loader2
} from "lucide-react";

const SOURCE_TYPES = [
  { value: "parallel_corpus", label: "平行语料", desc: "原文+译文对照，用于翻译风格学习", icon: BookOpen },
  { value: "reference_novel", label: "参考小说", desc: "同系列/同题材的参考作品，用于风格模仿", icon: FileText },
  { value: "knowledge_doc", label: "知识文档", desc: "设定集、世界观笔记、角色设定等", icon: Lightbulb },
];

type UploadMode = "single" | "dual"; // single = 单文件/粘贴 | dual = 双文件（原文+译文分别上传）

const STATUS_CONFIG = {
  pending: { label: "待索引", color: "text-white/40", icon: AlertCircle },
  indexing: { label: "索引中", color: "text-amber-400", icon: Loader2 },
  indexed: { label: "已索引", color: "text-green-400", icon: CheckCircle },
  failed: { label: "失败", color: "text-red-400", icon: AlertCircle },
};

export default function MaterialPool() {
  const utils = trpc.useUtils();
  const { data: materialList, isLoading } = trpc.material.list.useQuery();
  const { data: seriesList } = trpc.lore.series.list.useQuery();

  const createMutation = trpc.material.create.useMutation({
    onSuccess: () => {
      utils.material.list.invalidate();
      setShowForm(false);
      resetForm();
    },
  });

  const indexMutation = trpc.material.index.useMutation({
    onSuccess: () => utils.material.list.invalidate(),
  });

  const deleteMutation = trpc.material.delete.useMutation({
    onSuccess: () => utils.material.list.invalidate(),
  });

  const [showForm, setShowForm] = useState(false);
  const [uploadMode, setUploadMode] = useState<UploadMode>("dual"); // dual = 双文件上传（默认）
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");         // 单文件内容
  const [sourceText, setSourceText] = useState("");   // 双文件：原文
  const [translatedText, setTranslatedText] = useState(""); // 双文件：译文
  const [alignedPairs, setAlignedPairs] = useState<Array<{ source: string; translated: string }> | null>(null);
  const [sourceType, setSourceType] = useState<"parallel_corpus" | "reference_novel" | "knowledge_doc">("parallel_corpus");
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [description, setDescription] = useState("");

  const dualFileMutation = trpc.material.createFromDualFiles.useMutation({
    onSuccess: (data) => {
      if (data._meta) {
        setAlignedPairs(data._meta.alignedPairs);
      }
      utils.material.list.invalidate();
    },
  });

  const resetForm = () => {
    setTitle(""); setContent(""); setSourceText(""); setTranslatedText("");
    setAlignedPairs(null); setSourceType("parallel_corpus");
    setSelectedSeriesId(null); setTagInput(""); setDescription("");
  };

  const handleCreate = () => {
    if (!title.trim()) return;
    if (sourceType === "parallel_corpus" && uploadMode === "dual" && sourceText.trim() && translatedText.trim()) {
      // 双文件模式
      dualFileMutation.mutate({
        title: title.trim(),
        sourceText: sourceText.trim(),
        translatedText: translatedText.trim(),
        seriesId: selectedSeriesId || undefined,
        tags: tagInput.split(",").map(t => t.trim()).filter(Boolean),
        description: description || undefined,
      });
    } else if (content.trim()) {
      // 单文件模式
      createMutation.mutate({
        title: title.trim(), content: content.trim(), sourceType,
        seriesId: selectedSeriesId || undefined,
        tags: tagInput.split(",").map(t => t.trim()).filter(Boolean),
        description: description || undefined,
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      <div className="max-w-[1200px] mx-auto px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Database className="w-6 h-6 text-amber-500" />
              <h1 className="text-3xl font-serif font-bold">素材池</h1>
            </div>
            <p className="text-white/50 font-mono text-sm">
              向 RAG 记忆库投喂素材，增强 AI 翻译与二创的风格一致性
            </p>
          </div>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium transition-colors">
            <Upload className="w-4 h-4" /> 投喂素材
          </button>
        </div>

        {showForm && (
          <div className="mb-8 p-6 rounded-2xl bg-white/5 border border-white/10 space-y-5">
            {/* 素材类型选择 */}
            <div>
              <label className="block font-mono text-xs uppercase tracking-wider text-white/50 mb-3">素材类型</label>
              <div className="grid grid-cols-3 gap-3">
                {SOURCE_TYPES.map(({ value, label, desc, icon: Icon }) => (
                  <button key={value} onClick={() => setSourceType(value as any)}
                    className={`p-4 rounded-xl border text-left transition-colors ${
                      sourceType === value ? "bg-amber-500/10 border-amber-500/30" : "bg-white/[0.02] border-white/10 hover:bg-white/[0.05]"
                    }`}>
                    <Icon className={`w-5 h-5 mb-2 ${sourceType === value ? "text-amber-500" : "text-white/40"}`} />
                    <div className={`text-sm font-medium ${sourceType === value ? "text-amber-400" : "text-white/70"}`}>{label}</div>
                    <div className="text-xs text-white/40 mt-1">{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 平行语料：上传模式切换 */}
            {sourceType === "parallel_corpus" && (
              <div>
                <label className="block font-mono text-xs text-white/50 mb-2">上传方式</label>
                <div className="flex gap-2">
                  <button onClick={() => setUploadMode("dual")}
                    className={`flex-1 px-4 py-2 rounded-xl text-sm transition-colors ${
                      uploadMode === "dual" ? "bg-amber-500/20 border border-amber-500/30 text-amber-400" : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                    }`}>双文件上传（推荐）</button>
                  <button onClick={() => setUploadMode("single")}
                    className={`flex-1 px-4 py-2 rounded-xl text-sm transition-colors ${
                      uploadMode === "single" ? "bg-amber-500/20 border border-amber-500/30 text-amber-400" : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                    }`}>单文件/粘贴</button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-xs text-white/50 mb-2">标题</label>
                <input value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="如：斗破苍穹 前三章原文"
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm" />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/50 mb-2">归属系列</label>
                <select value={selectedSeriesId || ""} onChange={e => setSelectedSeriesId(Number(e.target.value) || null)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm">
                  <option value="">不绑定系列</option>
                  {seriesList?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            {/* 双文件模式：原文 + 译文 */}
            {sourceType === "parallel_corpus" && uploadMode === "dual" ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono text-xs text-white/50 mb-2 flex items-center gap-1">
                    <FileText className="w-3 h-3" /> 原文（外文）
                  </label>
                  <textarea value={sourceText} onChange={e => setSourceText(e.target.value)}
                    placeholder="粘贴或上传原文..."
                    className="w-full h-48 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/20" />
                </div>
                <div>
                  <label className="block font-mono text-xs text-white/50 mb-2 flex items-center gap-1">
                    <BookOpen className="w-3 h-3" /> 译文（中文）
                  </label>
                  <textarea value={translatedText} onChange={e => setTranslatedText(e.target.value)}
                    placeholder="粘贴或上传译文..."
                    className="w-full h-48 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/20" />
                </div>
              </div>
            ) : (
              /* 单文件模式 */
              <div>
                <label className="block font-mono text-xs text-white/50 mb-2">内容</label>
                <textarea value={content} onChange={e => setContent(e.target.value)}
                  placeholder={sourceType === "parallel_corpus"
                    ? "粘贴对照内容，用 === 分隔原文和译文...\n\nHello.\n===\n你好。"
                    : "粘贴素材内容..."
                  }
                  className="w-full h-48 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/20" />
              </div>
            )}

            {/* 对齐预览 */}
            {alignedPairs && alignedPairs.length > 0 && (
              <div className="p-4 rounded-xl bg-white/5 border border-amber-500/20">
                <label className="block font-mono text-xs text-amber-400 mb-3 flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5" />
                  自动对齐预览（{alignedPairs.length} 对段落）
                </label>
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {alignedPairs.slice(0, 5).map((pair, i) => (
                    <div key={i} className="text-xs">
                      <div className="text-white/40 font-mono">原文: {pair.source.slice(0, 80)}...</div>
                      <div className="text-amber-400/60 font-mono">译文: {pair.translated.slice(0, 80)}...</div>
                    </div>
                  ))}
                  {alignedPairs.length > 5 && <div className="text-white/30 text-xs">...还有 {alignedPairs.length - 5} 对</div>}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={handleCreate}
                disabled={dualFileMutation.isPending || createMutation.isPending || !title.trim() || (uploadMode === "dual" ? (!sourceText.trim() || !translatedText.trim()) : !content.trim())}
                className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium text-sm flex items-center gap-2">
                {(dualFileMutation.isPending || createMutation.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                上传素材
              </button>
              <button onClick={() => { setShowForm(false); resetForm(); }} className="px-6 py-2.5 bg-white/5 hover:bg-white/10 rounded-full text-sm">取消</button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center text-white/40 py-20"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />加载中...</div>
        ) : materialList?.length === 0 ? (
          <div className="text-center text-white/40 py-20">
            <Database className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>素材池为空</p>
            <p className="text-sm">点击上方"投喂素材"添加</p>
          </div>
        ) : (
          <div className="space-y-3">
            {materialList?.map(m => {
              const st = STATUS_CONFIG[m.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending;
              const SIcon = st.icon;
              const stLabel = SOURCE_TYPES.find(s => s.value === m.sourceType)?.label || m.sourceType;
              return (
                <div key={m.id} className="p-5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all group">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-serif text-lg font-semibold truncate">{m.title}</h3>
                        <span className={`flex items-center gap-1 text-xs font-mono ${st.color}`}>
                          <SIcon className={`w-3.5 h-3.5 ${m.status === "indexing" ? "animate-spin" : ""}`} />{st.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-white/40 font-mono mb-2">
                        <span className="px-2 py-0.5 rounded-full bg-white/5">{stLabel}</span>
                        {(m.tags as string[]).length > 0 && <span className="flex items-center gap-1"><Tag className="w-3 h-3" />{(m.tags as string[]).join(", ")}</span>}
                        {m.indexedChunks ? <span>{m.indexedChunks} chunks</span> : null}
                      </div>
                      <p className="text-white/30 text-xs line-clamp-2">{m.content.slice(0, 200)}...</p>
                    </div>
                    <div className="flex items-center gap-2 ml-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {m.status === "pending" && (
                        <button onClick={() => indexMutation.mutate({ id: m.id })} disabled={indexMutation.isPending}
                          className="p-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400" title="开始索引">
                          <Sparkles className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => { if (confirm("确认删除？")) deleteMutation.mutate({ id: m.id }); }}
                        className="p-2 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400" title="删除">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

### 3.7 二创工作台骨架（Studio.tsx）

Phase 1 只提供占位 UI，Phase 2 实现完整功能：

```tsx
// src/pages/Studio.tsx
// Phase 1: 基础骨架
// Phase 2: 完整二创编辑器

import { PenTool } from "lucide-react";

export default function Studio() {
  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      <div className="flex h-screen">
        {/* 编辑区 */}
        <div className="flex-1 p-8">
          <header className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <PenTool className="w-5 h-5 text-amber-500" />
              <h1 className="font-mono text-sm">二创工作台</h1>
            </div>
            <span className="font-mono text-xs text-white/30">Phase 2 完整实现</span>
          </header>
          <div className="h-[calc(100vh-120px)] rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
            <p className="text-white/30 font-mono text-sm">AI 创作编辑器将在 Phase 2 完成</p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## 4. 交付物清单

- [ ] `npm run check` 零类型错误
- [ ] `npm run build` 构建成功
- [ ] 5 个路由页面均可访问且内容正确
- [ ] 小说管理：创建、列表、删除、跳转阅读器
- [ ] 阅读器：章节导航、双语切换、字体调整
- [ ] 设定库：系列 CRUD、角色卡 CRUD
- [ ] 后端 Router：novel, chapter, translate, lore, tag, **material** 全部可用
- [ ] DeepSeek API 封装可用（streamChat, chatCompletion, getEmbedding）
- [ ] 文档解析服务（txt, docx, pdf）
- [ ] 向量化服务（indexNovel, searchSimilar）骨架就绪
- [ ] **素材池 UI**：创建、列表、索引、删除素材
- [ ] **素材池 API**：material.list/create/index/delete/updateScope

---

## 5. 技术约束（不可违反）

1. 所有数据库操作必须通过 Drizzle ORM，禁止手写 SQL
2. 所有 API 调用通过 tRPC，禁止 fetch 直接调用后端
3. 翻译 API 必须使用流式返回（async generator）
4. 阅读器正文必须使用 Noto Serif SC 字体
5. 所有页面背景必须是 #111827（主页除外，用 #000000）
6. 标签/代码区域使用 Geist Mono 字体
