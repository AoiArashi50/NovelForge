# NovelForge 迭代路线图 — RAG 飞轮优化专项

> **文档定位**：本文件是给后续 Agent 的**执行蓝图**。阅读本文件后，Agent 应能独立完成其中任何一项任务，无需再询问用户。
>
> **最后更新**：2026-06-01
> **进度**：P0-1 ✅ 已实施 | P0-2 ✅ 已实施 | P0-3 ✅ 已实施 | P1-1 ✅ 已实施 | P1-2 ✅ 已实施 | P1-3 ✅ 已实施 | P2-1 ✅ 已实施
> **核心主线**：生成 → 投喂 → 增强 → 再生成（自我强化的 RAG 飞轮）

---

## 一、项目当前状态快照（已完成）

### 1.1 功能完成度

| 模块 | 状态 | 说明 |
|------|------|------|
| 小说上传/解析/翻译 | ✅ | 支持 txt/docx，DeepSeek 翻译，双语阅读器 |
| 素材池（RAG 投喂）| ✅ | 平行语料、参考小说、知识文档三种类型，自动索引 |
| 设定库（LoreLibrary）| ✅ | 角色卡、世界观圣经（动态 aspects）、正史、桥段库 |
| **设定库智能化** | ✅ | 素材一键提取角色+世界观，同名自动合并，批量提取 |
| 二创工作台（Studio）| ✅ | 4 种创作模式，6 个可调参数，RAG 条数可调（1-10），保存到小说管理 |
| RAG Hybrid Search | ✅ | 向量检索 + 全文检索（`simple` 配置），合并去重 |

### 1.2 技术栈（冻结，不得变更）

- **前端**：React 19 + TypeScript + Vite + Tailwind 3.4 + tRPC React Query
- **后端**：Hono + tRPC 11 + Drizzle ORM + postgres-js
- **AI**：DeepSeek V4 Pro（1M 上下文）via `fetch`
- **Embedding**：DashScope `text-embedding-v4`（1536 维，OpenAI-compatible API）
- **数据库**：PostgreSQL 16 + pgvector
- **部署**：Docker Compose + Alibaba Cloud ECS

### 1.3 关键约束

1. **tRPC v11 不支持 streaming mutations** — 所有流式端点已改为普通 async，前端用 `setInterval` 模拟打字效果
2. **Drizzle ORM `db.execute()` 只接受一个参数** — 必须用 `` sql`...` `` 模板字面量
3. **Dark Theme Only** — 背景 `#111827`，文本 `#FDFBF5`，强调色 `#F59E0B`
4. **单用户无认证** — 所有 API 都是 public
5. **`noUnusedLocals` / `noUnusedParameters` 已开启** — 不能有未使用的 import 或参数
6. **No new dependencies** — 不能用 LangChain、Zustand、Redis 等新库

---

## 二、核心主线：生成-投喂-增强-生成飞轮

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 第一轮生成                                                                 │
│  Brief + 角色卡 + 世界观 + RAG(参考小说/素材池) → DeepSeek → 初稿           │
└────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌────────────────────────────────────────────────────────────────────────────┐
│ 用户投喂（Feed）                                                           │
│  用户选中优质段落 → "保存为风格样本" → 自动语义切分 → 索引到 vector_chunks   │
│  sourceType: "style_sample"，metadata 标记角色标签、场景标签                 │
└────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌────────────────────────────────────────────────────────────────────────────┐
│ 系统增强（Enhance）                                                        │
│  定期分析 style_sample 素材 → AI 提炼角色语言风格特征                       │
│  → 自动更新 characterCards.speechPatterns / 生成 styleProfile              │
└────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌────────────────────────────────────────────────────────────────────────────┐
│ 第二轮生成                                                                 │
│  RAG 检索到 style_sample → Prompt 注入"【用户认可的风格样本】"               │
│  → 生成质量提升，更接近用户预期                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、任务清单与实施计划

所有任务按 **P0（立即做）→ P1（尽快做）→ P2（有余力再做）** 排序。每个任务包含：
- **目的**：为什么要做
- **涉及文件**：改哪些文件
- **具体改动**：代码级指导
- **验收标准**：怎么算做完了

---

### 🔴 P0-1：RAG Chunk 语义切分（基础设施） ✅ 2026-06-01

**目的**：当前 `embedder.ts:11` 用固定 500 字符滑动窗口切分，一个对话场景被切成 3-4 块，AI 检索到的片段缺乏上下文，看不懂人物关系。

**涉及文件**：
- `api/services/embedder.ts` — 替换切分逻辑
- `db/schema.ts` — `vectorChunks.metadata` 增加来源字段
- `api/routers/generate.ts` — RAG 注入时展示来源信息

**具体改动**：

1. **语义切分函数**（替换 `embedder.ts` 中的 `splitIntoChunks`）：

```typescript
interface Chunk {
  content: string        // 嵌入用内容
  contextBefore: string  // 前 200 字（不嵌入，仅展示）
  contextAfter: string   // 后 200 字
  sourceId: number       // novelId 或 materialId
  sourceTitle: string
  chapterNumber?: number
  chunkIndex: number
  totalChunks: number
}

function splitIntoSemanticChunks(
  text: string,
  metadata: { sourceId: number; sourceTitle: string; chapterNumber?: number }
): Chunk[] {
  // 按自然段落/场景分隔符拆分："第X章"、"==="、双空行
  const sceneDelimiters = /\n\s*第[一二三四五六七八九十百千零\d]+章[：:.]?\s*\n|\n\s*={3,}\s*\n|\n\s*\n\s*\n/
  const scenes = text.split(sceneDelimiters).filter(s => s.trim().length > 50)

  const chunks: Chunk[] = []
  let chunkIndex = 0

  for (const scene of scenes) {
    const trimmed = scene.trim()
    // 短场景直接作为一个 chunk（< 1500 字符）
    if (trimmed.length <= 1500) {
      chunks.push(createChunk(trimmed, metadata, chunkIndex++))
      continue
    }
    // 长场景按句子边界切分，保持 600-1200 字符/块
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

function createChunk(content: string, metadata: { sourceId: number; sourceTitle: string; chapterNumber?: number }, index: number): Chunk {
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
```

2. **存储时丰富 metadata**（`embedder.ts:indexNovel`）：

```typescript
metadata: {
  indexedAt: new Date().toISOString(),
  sourceId: novelId,           // ← 新增
  sourceTitle: "来源标题",      // ← 新增
  chapterNumber: 1,            // ← 新增
  chunkIndex,
  totalChunks,
  contextBefore: chunk.contextBefore,  // ← 新增
  contextAfter: chunk.contextAfter,    // ← 新增
}
```

3. **检索返回丰富信息**（`embedder.ts:searchSimilar`）：

```typescript
return {
  content: String(row.content),
  similarity: Number(row.similarity),
  sourceType: String(row.source_type),
  sourceTitle: String(row.source_title || "未知来源"),        // ← 新增
  chapterNumber: row.chapter_number ? Number(row.chapter_number) : undefined,  // ← 新增
  chunkIndex: row.chunk_index ? Number(row.chunk_index) : undefined,           // ← 新增
  contextBefore: String(row.context_before || ""),           // ← 新增
  contextAfter: String(row.context_after || ""),             // ← 新增
}
```

**验收标准**：
- 新索引的素材 chunks 长度在 600-1500 字符之间（不再固定 500）
- `vector_chunks.metadata` 包含 `sourceTitle`、`chunkIndex`、`totalChunks`
- `npm run check` 零错误
- 现有索引数据不需要迁移（可以逐步重建）

**实施备注**（2026-06-01）：
- `embedder.ts` 已重构：引入 `Chunk` 接口、`splitIntoSemanticChunks` 语义切分、`splitIntoFixedChunks` 兼容旧版、`SearchResult` 接口
- `indexNovel` 签名改为接收 `options` 对象（含 `sourceTitle`、`chapterNumber` 等）
- `searchSimilar` 返回 `SearchResult[]`，包含 `sourceTitle`、`chunkIndex`、`contextBefore/After` 等字段
- `rag.ts` 调用 `indexNovel` 时传入 `sourceTitle`（从 `novels` 表查询）
- `material.ts` 删除本地 `splitIntoChunks`，改为从 `embedder.ts` 导入 `splitIntoSemanticChunks`，索引时丰富 metadata
- **注意**：现有 `vector_chunks` 中的旧数据不会自动更新，需要用户重新索引素材/小说才能享受语义切分

---

### 🔴 P0-2：RAG 来源可追溯（信任层） ✅ 2026-06-01

**目的**：用户不知道 AI 参考了什么，投喂了素材后看不到回报，导致不愿继续投喂。

**涉及文件**：
- `api/routers/generate.ts` — `RagCall` 类型扩展，返回来源信息
- `src/pages/Studio.tsx` — 生成结果旁展示引用来源

**具体改动**：

1. **扩展 RagCall 类型**（`generate.ts:30-34`）：

```typescript
type RagCall = {
  type: "novel_style" | "material" | "keyword"
  content: string
  score?: number
  sourceTitle?: string       // ← 新增
  chapterNumber?: number     // ← 新增
  chunkIndex?: number        // ← 新增
  totalChunks?: number       // ← 新增
}
```

2. **检索时记录来源**（`generate.ts:272-292`，在每次 `ragCalls.push` 时传入来源信息）：

```typescript
ragCalls.push({
  type: "novel_style",
  content: r.content,
  score: r.similarity,
  sourceTitle: r.sourceTitle,        // ← 新增
  chapterNumber: r.chapterNumber,    // ← 新增
  chunkIndex: r.chunkIndex,          // ← 新增
  totalChunks: r.totalChunks,        // ← 新增
})
```

3. **前端展示引用面板**（`src/pages/Studio.tsx`，在生成结果区域下方）：

新增一个折叠面板，展示本次生成参考了哪些素材：
```
📎 本次生成参考了 5 条素材：
  · 《斗破苍穹》第3章 · 片段 2/15（相似度 87%）
  · 《斗破苍穹》第7章 · 片段 5/15（相似度 82%）
  · 素材《萧炎语言风格样本》（相似度 91%）← 用户投喂
```

**验收标准**：
- 每次生成后，Studio 页面显示引用来源列表
- 点击来源可展开对应 chunk 原文（含前后文）
- `npm run check` 零错误

**实施备注**（2026-06-01）：
- `generate.ts` 中 `RagCall` 类型已扩展：`sourceTitle`、`chapterNumber`、`chunkIndex`、`totalChunks`
- 向量检索结果注入时传递来源信息
- `fanfiction` mutation 将 `ragCalls` 存入 `parameters`（jsonb）
- `Studio.tsx` 中 `ragCalls` 状态类型已扩展，RAG 面板展示来源标题、章节号、片段序号
- **注意**：`continue` 和 `regenerate` mutation 也返回 `ragCalls`，前端已处理

---

### 🔴 P0-3：中文全文检索修复 ✅ 2026-06-01

**目的**：`generate.ts:300` 用 `to_tsvector('simple', content)`，对中文按空格分词，全文检索几乎无效。

**涉及文件**：
- `api/routers/generate.ts` — 4c 全文检索部分

**具体改动**：

用 `pg_trgm`（PostgreSQL 内置，无需安装扩展）做模糊匹配补充：

```typescript
// 在现有的 4c 全文检索代码块中，增加 trgm 模糊搜索

// 4c. 全文检索补充（保留现有代码）
try {
  // ... 现有 tsvector 检索代码 ...
} catch { /* 失败不影响主流程 */ }

// ← 新增：trgm 模糊搜索补充
try {
  const briefQuery = brief.slice(0, 100)
  const trgmResults = await db.execute(sql`
    SELECT content,
      similarity(content, ${briefQuery}) as score
    FROM vector_chunks
    WHERE series_id = ${seriesId}
      AND content % ${briefQuery}
    ORDER BY score DESC
    LIMIT ${params.ragLimit}
  `)
  const trgmRows = Array.isArray(trgmResults) ? trgmResults : []
  if (trgmRows.length > 0) {
    const trgmContent = trgmRows.map((r: Record<string, unknown>) => String(r.content)).join("\n---\n")
    if (!ragParts.some(p => p.includes(trgmContent.slice(0, 50)))) {
      ragParts.push(buildRagPrefix(trgmContent) + "【模糊匹配参考】\n" + trgmContent)
    }
  }
} catch { /* trgm 可选，失败不影响 */ }
```

**注意**：`pg_trgm` 是 PostgreSQL 内置扩展，需要确认数据库中已启用：
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

**验收标准**：
- 用中文关键词（如"萧薰儿"）检索时，能匹配到含该关键词的 chunks
- `npm run check` 零错误

**实施备注**（2026-06-01）：
- `generate.ts` 中在现有 4c 全文检索之后新增 4d `pg_trgm` 模糊搜索
- 使用 `content % ${briefQuery}`（trgm 相似度操作符）和 `similarity()` 函数
- 保留原有 `tsvector` 全文检索（对英文内容仍有价值）
- **注意**：首次部署时需要在 PostgreSQL 中执行 `CREATE EXTENSION IF NOT EXISTS pg_trgm;`，已在 `docker-compose.yml` 的初始化脚本中考虑

---

### 🟡 P1-1：生成内容回流（飞轮启动器）

**目的**：用户生成满意的二创后，优质内容应该能一键保存为风格样本，进入 RAG 库反哺后续生成。

**涉及文件**：
- `api/routers/material.ts` — 新增 `saveAsStyleSample` mutation
- `api/services/embedder.ts` — 确保能索引 `sourceType: "style_sample"`
- `src/pages/Studio.tsx` — 生成结果区域增加"保存为风格样本"按钮
- `db/schema.ts` — 无需改表，`materials.sourceType` 已支持自定义

**具体改动**：

1. **后端 API**（`api/routers/material.ts`，在 `materialRouter` 中新增）：

```typescript
saveAsStyleSample: publicQuery
  .input(z.object({
    content: z.string().min(10),
    seriesId: z.number(),
    characterTag: z.string().optional(),   // 如 "萧炎"
    sceneTag: z.string().optional(),       // 如 "战斗描写"
    sourceWorkId: z.number().optional(),   // fanFictionWorks.id
  }))
  .mutation(async ({ input }) => {
    const db = getDb()

    // 1. 存入 materials
    const [material] = await db.insert(materials).values({
      title: `风格样本 · ${input.characterTag || '通用'} · ${input.sceneTag || '通用'}`,
      content: input.content,
      sourceType: "style_sample",
      seriesId: input.seriesId,
      tags: [input.characterTag, input.sceneTag].filter(Boolean),
    }).returning()

    // 2. 自动索引到 vector_chunks（复用 indexNovel 逻辑）
    await indexNovel(material.id, input.content, input.seriesId, "style_sample")

    return material
  })
```

2. **前端交互**（`src/pages/Studio.tsx`，在生成结果下方）：

- **方案 A（全文保存）**：生成结果下方增加"💾 保存为风格样本"按钮，点击后弹出对话框：
  - "这段文字主要体现了谁的风格？"（下拉选择该系列的角色）
  - "适用于什么场景？"（战斗描写 / 对话 / 心理活动 / 环境描写）
  - 确认后调用 `saveAsStyleSample`

- **方案 B（精选保存）**：用户选中一段文字后，右键菜单或浮动按钮"保存选中的风格样本"

**验收标准**：
- 用户能将生成内容保存为 `style_sample` 类型素材
- 保存后自动出现在 `vector_chunks` 中，sourceType 为 `"style_sample"`
- 下一次生成时，该素材能被 RAG 检索到
- `npm run check` 零错误

**实施备注**（2026-06-01）：
- `material.ts` 已新增 `saveAsStyleSample` mutation，自动插入 `materials` 表并调用 `indexNovel` 索引到 `vector_chunks`
- `Studio.tsx` 已新增"✨ 保存为风格样本"按钮 + Modal 对话框，支持选择角色（下拉从 `characters` 查询）和场景标签（战斗描写/对话/心理活动/环境描写）
- `indexNovel` 支持 `sourceType: "style_sample"`，metadata 中记录角色标签和场景标签
- 保存成功后自动刷新素材列表和 RAG 索引

---

### 🟡 P1-2：翻译记忆反哺二创

**目的**：`translation_memory` 存储了大量平行语料（原文+译文），只在翻译时用。二创要求"模仿原作文风"时，翻译记忆是最精准的风格样本。

**涉及文件**：
- `api/routers/generate.ts` — RAG 流程增加 4d 翻译记忆检索
- `db/schema.ts` — 无需改表

**具体改动**：

在 `generate.ts` 现有 4a/4b/4c 之后，增加 4d：

```typescript
// 4d. 翻译记忆风格检索（当风格忠实度 >= 7 且有关联小说时）
if (params.styleFidelity >= 7 && parentNovelId) {
  try {
    const tmResults = await db.execute(sql`
      SELECT source_text, translated_text,
        1 - (embedding <=> ${JSON.stringify(embedding)}) as similarity
      FROM translation_memory
      WHERE novel_id = ${parentNovelId}
      ORDER BY embedding <=> ${JSON.stringify(embedding)}
      LIMIT 3
    `)
    const tmRows = Array.isArray(tmResults) ? tmResults : []
    if (tmRows.length > 0) {
      const tmContent = tmRows.map((r: Record<string, unknown>) =>
        `原文: ${String(r.source_text).slice(0, 100)}\n译文: ${String(r.translated_text).slice(0, 150)}`
      ).join("\n---\n")

      ragParts.push(
        "【文风对照样本】以下是原作原文与译文的对应片段，" +
        "请严格模仿其译文的句式节奏、用词风格和叙事口吻：\n" + tmContent
      )
    }
  } catch { /* 翻译记忆检索可选，失败不影响 */ }
}
```

**验收标准**：
- 当 `styleFidelity >= 7` 且有关联小说时，System Prompt 中注入翻译记忆样本
- 生成结果的风格更贴近原作
- `npm run check` 零错误

**实施备注**（2026-06-01）：
- `embedder.ts` 中 `searchSimilar` 新增可选参数 `embedding?: number[]`，允许外部传入预计算的 embedding，避免同一 brief 被多次 embedding
- `generate.ts` 中 `buildSystemPrompt` 在 4. Hybrid RAG 检索前预计算 `briefEmbedding`，供 4a（小说向量检索）、4b（素材池向量检索）和 4e（翻译记忆检索）复用
- 4e 代码块实现在 4d（pg_trgm）之后：当 `styleFidelity >= 7 && parentNovelId && briefEmbedding` 时，查询 `translation_memory` 表取 top-3 相似片段，注入 System Prompt 作为【文风对照样本】
- 翻译记忆检索失败不影响主流程（try-catch 包裹）

---

### 🟡 P1-3：RAG 效果反馈闭环

**目的**：记录每次生成用了哪些 chunks，结合用户评分淘汰劣质素材。

**涉及文件**：
- `db/schema.ts` — 新增 `ragFeedback` 表
- `api/routers/generate.ts` — 生成时记录 ragFeedback
- `src/pages/Studio.tsx` — 生成后显示 👍/👎 评分按钮
- `api/routers/rag.ts` — 新增 `feedback` mutation

**具体改动**：

1. **新增表**（`db/schema.ts`，加到文件末尾）：

```typescript
export const ragFeedback = pgTable("rag_feedback", {
  id: serial("id").primaryKey(),
  generationId: integer("generation_id").notNull(),  // fanFictionWorks.id
  chunkId: integer("chunk_id").notNull(),            // vectorChunks.id（需先查出来）
  wasHelpful: boolean("was_helpful"),                // 用户评分后回填
  similarityScore: real("similarity_score"),         // 检索时的相似度
  createdAt: timestamp("created_at").notNull().defaultNow(),
})
```

2. **记录检索日志**（`generate.ts`，在 `buildSystemPrompt` 返回前）：

```typescript
// 返回前，将 ragCalls 记录到 ragFeedback（异步，不阻塞）
// 注意：这里需要 vectorChunks.id，但当前 ragCalls 中没有
// 所以需要在检索时就记录 chunkId
```

**注意**：当前 `searchSimilar` 返回的结果中没有 `vectorChunks.id`。需要扩展返回类型，或者改用 `vectorChunks.content + seriesId` 联合查询来反向查找 id。

**简化方案**：在 `searchSimilar` 中同时返回 `id`：

```typescript
// embedder.ts:searchSimilar
return {
  id: Number(row.id),   // ← 新增
  content: String(row.content),
  // ... 其他字段
}
```

然后 `ragCalls` 增加 `chunkId` 字段。

3. **前端评分按钮**（`src/pages/Studio.tsx`，生成结果下方）：

```
本次生成满意吗？ [👍 满意] [👎 不满意]
```

点击 👎 后弹出简短追问："哪方面不对？"
- [ ] 角色性格不对（OOC）
- [ ] 风格不像原作
- [ ] 世界观矛盾
- [ ] 其他

4. **后端反馈 API**（`api/routers/rag.ts`）：

```typescript
feedback: publicQuery
  .input(z.object({
    generationId: z.number(),
    wasHelpful: z.boolean(),
    reason: z.string().optional(),
  }))
  .mutation(async ({ input }) => {
    const db = getDb()
    // 找到该 generation 对应的所有 ragFeedback 记录，更新 wasHelpful
    await db.update(ragFeedback)
      .set({ wasHelpful: input.wasHelpful })
      .where(eq(ragFeedback.generationId, input.generationId))
    return { success: true }
  })
```

**验收标准**：
- 每次生成记录使用了哪些 chunks
- 用户可以评分 👍/👎
- `npm run check` 零错误

**实施备注**（2026-06-01）：
- `db/schema.ts` 新增 `ragFeedback` 表：`generationId`、`chunkId`（可选，因为 4c/4d/4e 没有 chunkId）、`content`（截取前 500 字）、`wasHelpful`、`similarityScore`
- `generate.ts` 中 `RagCall` 扩展 `chunkId?: number`；4a/4b 向量检索结果注入时传入 `chunkId: r.id`（`SearchResult.id` 在 P0-1 已支持）
- `generate.ts` 中 `fanfiction` mutation 保存 work 后，异步遍历 `ragCalls` 中有 `chunkId` 的记录批量写入 `ragFeedback`（try-catch 包裹，失败不影响主流程）
- `rag.ts` 新增 `feedback` mutation：根据 `generationId` 更新对应的所有 `ragFeedback` 记录的 `wasHelpful`
- `Studio.tsx` 新增 `feedbackState` 和 `feedbackMutation`；生成结果下方显示"本次生成满意吗？👍/👎"；点击 👎 展开原因选择（OOC/风格不像/世界观矛盾/其他）；生成/续写/重写开始时重置反馈状态

---

### 🟢 P2-1：风格自动提炼（增强环节）

**目的**：用户投喂了大量风格样本后，系统自动提炼出角色语言风格画像，反哺角色卡。

**涉及文件**：
- `api/routers/lore.ts` — 新增 `character.extractStyleProfile` mutation
- `db/schema.ts` — 无需改表（复用 `characterCards.speechPatterns`）
- `src/pages/LoreLibrary.tsx` — 角色卡页面增加"分析风格样本"按钮

**具体改动**：

1. **后端风格提炼**（`api/routers/lore.ts`，在 `character` router 下新增）：

```typescript
extractStyleProfile: publicQuery
  .input(z.object({
    seriesId: z.number(),
    characterName: z.string(),
  }))
  .mutation(async ({ input }) => {
    const db = getDb()

    // 1. 获取该角色的所有风格样本
    const styleSamples = await db
      .select()
      .from(materials)
      .where(
        and(
          eq(materials.seriesId, input.seriesId),
          eq(materials.sourceType, "style_sample"),
          sql`tags @> ${JSON.stringify([input.characterName])}`
        )
      )

    if (styleSamples.length < 3) {
      throw new Error(`风格样本不足（当前 ${styleSamples.length} 条，需要至少 3 条）`)
    }

    // 2. 用 AI 提炼风格特征
    const combined = styleSamples.map(s => s.content.slice(0, 300)).join("\n---\n")
    const prompt = `分析以下 "${input.characterName}" 的风格样本，提炼其语言风格特征：

${combined}

请返回以下 JSON 格式：
{
  "vocabulary": ["高频用词1", "高频用词2"],
  "sentencePatterns": ["句式特点1"],
  "emotionalTone": "情感基调描述",
  "dialogueStyle": "对话风格描述",
  "narrativeHabits": "叙事习惯描述"
}`

    const response = await chatCompletion({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxTokens: 2000,
    })

    // 3. 解析并更新角色卡
    let profile: Record<string, unknown>
    try {
      profile = JSON.parse(response)
    } catch {
      throw new Error("AI 返回的风格分析无法解析")
    }

    // 找到该角色
    const chars = await db
      .select()
      .from(characterCards)
      .where(and(eq(characterCards.seriesId, input.seriesId), eq(characterCards.name, input.characterName)))

    if (chars.length === 0) throw new Error("角色不存在")

    await db.update(characterCards)
      .set({ speechPatterns: JSON.stringify(profile) })
      .where(eq(characterCards.id, chars[0].id))

    return profile
  })
```

2. **前端触发按钮**（`src/pages/LoreLibrary.tsx`，角色卡详情区域）：

在角色卡底部增加按钮："🔬 分析风格样本（需 ≥3 条）"
- 当该角色有 ≥3 条 style_sample 时可用
- 点击后调用 `extractStyleProfile`
- 结果显示提炼出的风格特征，自动写入 `speechPatterns`

**验收标准**：
- 角色有 ≥3 条 style_sample 时，可以一键提炼风格画像
- 提炼结果更新到 `characterCards.speechPatterns`
- 下一次生成时，该角色的 speechPatterns 更精准
- `npm run check` 零错误

**实施备注**（2026-06-01）：
- `lore.ts` 中 `character` router 新增 `extractStyleProfile` mutation：
  - 查询 `materials` 表中 `sourceType = "style_sample"` 且 `tags` JSONB 数组包含角色名的记录
  - 使用 `sql\`${materials.tags}::jsonb @> ${JSON.stringify([input.characterName])}::jsonb\`` 做 JSONB 包含查询
  - 样本不足 3 条时报错提示用户先去 Studio 保存风格样本
  - 用 AI 提炼风格特征（vocabulary、sentencePatterns、emotionalTone、dialogueStyle、narrativeHabits）
  - 解析 JSON 后更新 `characterCards.speechPatterns`
- `LoreLibrary.tsx` 中每个角色卡底部新增"分析风格样本"按钮（带 `Sparkles` 图标），点击调用 `extractStyleProfile`
- 提炼成功后在 alert 中展示提炼结果摘要，并自动刷新角色列表
- 注意：JSONB 查询的 `::jsonb` 类型转换是必须的，否则 PostgreSQL 可能将参数推断为 text 导致 `@>` 操作符失败

---

## 四、已发现但尚未修复的代码问题

以下问题已全部修复：

1. **`vectorChunks.metadata` 只有 `{indexedAt}`** — ✅ P0-1 修复，语义切分时写入完整来源信息
2. **`to_tsvector('simple', content)` 对中文无效** — ✅ P0-3 修复，新增 `pg_trgm` 模糊搜索补充
3. **`searchSimilar` 中 materialFilter 写法有 bug** — ✅ P0-1 重构时已移除该过滤逻辑，改用 `seriesId` 过滤
4. **全文检索和向量检索没有去重逻辑** — ✅ 已修复。`generate.ts` 引入 `seenChunkIds: Set<number>`，4a/4b 向量检索 push 时记录 chunkId，4c/4d 全文/trgm 检索时先 `SELECT id` 再 `filter(id => !seenChunkIds.has(id))`，彻底杜绝重复 chunk 被多次注入 Prompt

---

## 五、Agent 执行检查清单

开始任何任务前，Agent 必须：

- [ ] 读取 `CLAUDE.md` 了解技术栈和约束
- [ ] 读取本文件（`docs/ROADMAP.md`）了解当前进度
- [ ] 读取 `ProjectGoal.md` 了解产品目标（最高权威）
- [ ] 修改前先运行 `npm run check` 确认基线零错误
- [ ] 修改后再次运行 `npm run check` 确保仍为零错误
- [ ] 不要引入新依赖
- [ ] 保持 Dark Theme 样式一致性
- [ ] 所有 DB 操作通过 Drizzle ORM，不要手写 SQL（除了 `db.execute(sql\`...\`)`）
- [ ] 提交时使用标准格式：`feat(rag): 语义切分 chunks`

---

## 六、附录：当前 RAG 数据流图

```
用户上传素材 ──→ materials 表 ──→ 语义切分 ──→ vector_chunks（pgvector）
                      │                                    │
                      │    ┌───────────────────────────────┘
                      │    │
                      ▼    ▼
              二创 Studio 生成时：
                1. brief → embedding
                2. 向量检索（embedding <=> query）
                3. 全文检索（tsvector / pg_trgm）
                4. 合并去重 → ragParts
                5. 组装 System Prompt（角色卡 + 世界观 + ragParts + brief）
                6. DeepSeek 生成
                      │
                      ▼
              生成结果 ──→ fanFictionWorks
                      │
                      └──→ [保存为风格样本] ──→ materials（style_sample）
                                              ──→ 重新索引 ──→ vector_chunks
                                              ──→ 反哺下一轮生成
```
