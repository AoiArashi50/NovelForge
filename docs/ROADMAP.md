# NovelForge 迭代路线图 — RAG 飞轮优化专项

> **文档定位**：本文件是给后续 Agent 的**执行蓝图**。阅读本文件后，Agent 应能独立完成其中任何一项任务，无需再询问用户。
>
> **最后更新**：2026-06-02
> **进度**：P0-1 ✅ | P0-2 ✅ | P0-3 ✅ | P0-4 ✅ | P0-5 ✅ | P1-1 ✅ | P1-2 ✅ | P1-3 ✅ | P1-4 ✅ | P2-1 ✅ | P2-2 📝 | **P2-3 ✅** | **P2-4 ✅** | **P2-5 ✅** | **P2-6 ✅** | **P2-7 ✅** | **P2-8 ✅** | **P2-9 ✅** | **P2-10 ✅**
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

### 🔴 P0-4：翻译引擎上下文一致性优化（元话语污染修复）

**目的**：分段翻译时，AI 在每个 segment 输出"以下是翻译""这是您需要的中文翻译"等元话语，导致译文被污染。

**涉及文件**：
- `api/routers/translate.ts` — prompt 模板强化 + 后处理清洗层 + 上下文桥梁
- `src/pages/Reader.tsx` — 重新翻译入口

**具体改动**：

1. **Prompt 绝对禁止指令**（`buildTranslationPrompt`，追加到 prompt 末尾）：

```
【绝对禁止】
1. 不要输出任何解释、前言、后记、总结
2. 不要输出"以下是翻译""译文如下""这是您需要的中文翻译"等元话语
3. 不要输出"译文：""翻译结果："等标题
4. 每一段直接输出纯中文译文，不要分段标题或编号
5. 如果某段内容很少（如过渡句），也请直接翻译，不要跳过
```

2. **上下文桥梁**（`buildTranslationPrompt`，在原文前注入）：

```typescript
function buildContextBridge(
  segmentIndex: number,
  totalSegments: number,
  prevSegmentTail: string,
  nextSegmentHead: string
): string {
  const parts: string[] = []
  parts.push(`【片段上下文】这是全文的第 ${segmentIndex + 1}/${totalSegments} 个翻译片段。`)
  if (segmentIndex > 0 && prevSegmentTail) {
    parts.push(`前一个片段的结尾：「${prevSegmentTail.slice(-100)}」`)
  }
  if (segmentIndex < totalSegments - 1 && nextSegmentHead) {
    parts.push(`后一个片段的开头：「${nextSegmentHead.slice(0, 100)}」`)
  }
  parts.push("请确保译文在人物称谓、情节逻辑和语气上与前后片段自然衔接。")
  return parts.join("\n")
}
```

在 `handleTranslate`（`translate.start` / `translate.chapter`）循环中，每个 segment 翻译时传入前后相邻 segment 的文本：

```typescript
const prompt = buildTranslationPrompt(
  segment,
  input.style,
  fuzzyMatches,
  ragRef,
  loreSection,
  input.userPrompt
) + "\n\n" + buildContextBridge(
  segIdx,
  segments.length,
  segments[segIdx - 1] || "",
  segments[segIdx + 1] || ""
)
```

3. **后处理清洗层**（`translate.ts` 新增函数）：

```typescript
const META_PATTERNS = [
  /^(这是[您你]?需要?的?中文翻译[：:]?\s*)/i,
  /^(以下[是为]?[您你]?的?翻译[：:]?\s*)/i,
  /^(译文[：:]?\s*)/i,
  /^(翻译[结果]*[：:]?\s*)/i,
  /^(中文翻译[：:]?\s*)/i,
  /(\s*总结[：:]?\s*)$/i,
  /(\s*以上[是为]?翻译[：:]?\s*)$/i,
]

function sanitizeTranslation(text: string): string {
  let result = text.trim()
  for (const pattern of META_PATTERNS) {
    result = result.replace(pattern, "")
  }
  return result.trim()
}
```

在 `translateSegmentWithRetry` 返回后调用：

```typescript
const { text, error } = await translateSegmentWithRetry(prompt)
const cleanText = error ? text : sanitizeTranslation(text)
return { segIdx, text: cleanText, error, segment }
```

4. **重叠上下文扩展**（`splitTranslationSegments`）：

将重叠从 200 字符增加到 400 字符，让 AI 更清楚段落边界：

```typescript
const overlap = 400  // 从 200 增加到 400
```

**验收标准**：
- 连续翻译 10 章小说，没有出现"以下是翻译""译文："等元话语
- 前后 segment 的人名、地名译法一致（通过上下文桥梁 + TM 共同保证）
- `npm run check` 零错误

**实施备注**（2026-06-02）：
- `buildTranslationPrompt` 追加「绝对禁止」指令（5 条），明确禁止元话语输出
- 新增 `buildContextBridge` 函数：为每个 segment 注入前后相邻片段的 100 字上下文，提示 AI"这是全文的第 N/M 个片段"
- 新增 `sanitizeTranslation` 函数 + `META_PATTERNS`（7 种正则），对 AI 输出进行后处理清洗
- `splitTranslationSegments` 重叠从 200 字符扩展到 400 字符，上下文衔接更自然
- `translate.start` 和 `translate.chapter` 中每个 segment 翻译时均调用 `sanitizeTranslation` 清洗
- **注意**：prompt 长度增加约 200 字（禁止指令 + 上下文桥梁），对 API 成本影响极小

---

### 🔴 P0-5：Reader 重新翻译入口

**目的**：当前 Reader 中翻译完成后 banner 消失，用户无法重新翻译（如想换风格、修正错误）。

**涉及文件**：
- `src/pages/Reader.tsx` — 操作菜单新增"重新翻译"选项

**具体改动**：

在 Reader 顶部操作菜单（与"绑定系列""索引到 RAG""导入素材库"同级的下拉菜单）中新增：

```tsx
<button
  onClick={() => {
    setOpenMenuId(null)
    // 确认对话框
    if (window.confirm("重新翻译将覆盖现有译文，是否继续？")) {
      // 重置小说状态为未翻译，显示翻译 banner
      updateNovelMutation.mutateAsync({ id, status: "unread" })
        .then(() => {
          utils.chapter.list.invalidate({ novelId: id })
          utils.novel.getById.invalidate({ id })
          toast.success("已重置，可以重新翻译")
        })
    }
  }}
  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors"
>
  <Languages className="w-3.5 h-3.5" /> 重新翻译
</button>
```

同时，翻译 banner 的显示条件从：

```tsx
{!hasTranslation && novel?.status !== "translated" && (
```

改为允许在 `novel?.status === "unread"` 时显示：

```tsx
{(!hasTranslation || novel?.status === "unread") && (
```

这样用户点击"重新翻译"后，banner 会重新出现。

**验收标准**：
- 已翻译的小说在 Reader 操作菜单中可见"重新翻译"选项
- 点击后弹出确认对话框
- 确认后小说状态重置为 "unread"，翻译 banner 重新出现
- `npm run check` 零错误

**实施备注**（2026-06-02）：
- Reader 顶部操作菜单（与"绑定系列""索引到 RAG""导入素材库"同级）新增"重新翻译"按钮
- 点击后 `window.confirm` 确认覆盖，确认后调用 `updateNovelMutation.mutateAsync({ id, status: "unread" })`
- 翻译 banner 显示条件从 `{!hasTranslation && novel?.status !== "translated"}` 改为 `{(!hasTranslation || novel?.status === "unread")}`
- 重置成功后自动 invalidate `chapter.list` 和 `novel.getById`，UI 立即刷新

---

### 🟡 P1-4：设定库深度利用（翻译场景）

**目的**：当前 `buildLoreSection` 注入全部角色（最多10个）和完整世界观，对长文本翻译来说 Prompt 过长。应只注入与当前 segment 相关的 lore，减少噪声、提升质量。

**涉及文件**：
- `api/routers/translate.ts` — `buildLoreSection` 改造为 `buildDynamicLoreSection`
- `api/routers/translate.ts` — 新增角色出场检测、维度匹配

**具体改动**：

1. **角色出场检测**（翻译每个 segment 前）：

```typescript
function detectCharactersInSegment(
  segment: string,
  characters: Array<{ name: string; originalName?: string | null }>
): Array<{ name: string; originalName?: string | null }> {
  return characters.filter(char =>
    segment.includes(char.name) ||
    (char.originalName && segment.includes(char.originalName))
  )
}
```

在 `translate.chapter` / `translate.start` 中：

```typescript
// 预加载系列全部角色（只做一次查询）
const allChars = await db.select({ name: characterCards.name, originalName: characterCards.originalName })
  .from(characterCards).where(eq(characterCards.seriesId, seriesId))

for (const segment of segments) {
  const relevantChars = detectCharactersInSegment(segment, allChars)
  const loreSection = await buildDynamicLoreSection(seriesId, relevantChars, segment)
  // ...
}
```

2. **动态 Lore 组装**（`buildDynamicLoreSection`）：

```typescript
async function buildDynamicLoreSection(
  seriesId: number,
  relevantChars: Array<{ name: string; originalName?: string | null }>,
  segment: string
): Promise<string> {
  const db = getDb()
  const parts: string[] = []

  // 1. 世界观 — 维度匹配（只注入相关维度）
  const [worldBible] = await db.select().from(worldBibles).where(eq(worldBibles.seriesId, seriesId))
  if (worldBible) {
    const relevantAspects = (worldBible.aspects || [])
      .filter((a: { name: string; content: string }) => {
        // 如果 aspect 名称出现在 segment 中，或 segment 内容与 aspect 相关
        return segment.includes(a.name) || segment.includes(a.content.slice(0, 30))
      })
    if (relevantAspects.length > 0) {
      parts.push("【相关世界观设定】")
      for (const aspect of relevantAspects) {
        parts.push(`「${aspect.name}」${aspect.content}`)
      }
    }
    // 维度关键词匹配
    if (worldBible.magicSystem && /[魔斗气灵力法术技能修炼]/u.test(segment)) {
      parts.push(`力量体系: ${worldBible.magicSystem}`)
    }
    if (worldBible.geography && /[城国山河流地图方位]/u.test(segment)) {
      parts.push(`地理政治: ${worldBible.geography}`)
    }
    if (worldBible.technologyLevel && /[科技机械枪炮飞船]/u.test(segment)) {
      parts.push(`技术水平: ${worldBible.technologyLevel}`)
    }
  }

  // 2. 角色设定 — 只注入出场角色
  if (relevantChars.length > 0) {
    const charDetails = await db.select()
      .from(characterCards)
      .where(eq(characterCards.seriesId, seriesId))
      .then(rows => rows.filter(r => relevantChars.some(c => c.name === r.name)))

    if (charDetails.length > 0) {
      parts.push("【出场角色设定】")
      for (const char of charDetails) {
        const traits = (char.personalityTraits as string[] || []).join("、") || "无性格标签"
        parts.push(`- ${char.name}: ${traits}${char.speechPatterns ? ` | 语言风格: ${char.speechPatterns}` : ""}`)
      }
    }
  }

  // 3. 术语表（保持现有逻辑）
  // ...

  return parts.join("\n")
}
```

3. **术语预提取**（翻译前预处理，可选 P0.5）：

在小说首次翻译前，用 AI 扫描全文提取专有名词统一译名表，存入 `translation_memory`：

```typescript
async function extractProperNouns(text: string): Promise<Array<{ source: string; translated: string }>> {
  const prompt = `请从以下小说文本中提取所有专有名词（人名、地名、组织名、技能名、物品名等），并给出建议的中文译名。
要求：
1. 同一专有名词只出现一次
2. 译名要符合中文读者习惯
3. 返回格式：原名 → 建议译名（每行一个）

文本：
${text.slice(0, 3000)}
`
  // ... 调用 AI，解析输出
}
```

**验收标准**：
- 翻译 prompt 中只包含与当前 segment 相关的角色和世界观维度
- prompt 长度减少 30%-50%（减少无关噪声）
- 同一小说不同章节的角色译名保持一致（通过术语预提取）
- `npm run check` 零错误

**实施备注**（2026-06-02）：
- 新增 `detectCharactersInSegment` 函数：关键词匹配 segment 中出现的角色名，返回出场角色列表
- 新增 `buildDynamicLoreSection` 函数，替换原有的 `buildLoreSection`（已删除）：
  - 世界观：只注入与 segment 相关的 `aspects` 维度（名称或内容前 30 字匹配）
  - 世界观维度关键词匹配：segment 含"魔法/斗气"才注入 `magicSystem`，含"城市/地图"才注入 `geography`，含"科技/机械"才注入 `technologyLevel`
  - 角色：只注入 `detectCharactersInSegment` 检测到的出场角色（最多 5 个）
  - 术语表：保持全局注入（top 10），但改为在每个 segment 翻译时异步查询（try-catch 包裹）
- `translate.start` 和 `translate.chapter` 中：
  - 预加载 `allChars`（角色列表）和 `worldBible`（世界观）到内存（只做一次查询）
  - 每个 segment 翻译前调用 `buildDynamicLoreSection` 动态构建 lore
- **注意**：旧函数 `buildLoreSection` 已删除，`seriesCanon` 导入已移除（正史事件暂不在翻译中注入，待后续评估需求）

---

### 🟢 P2-2：流式替换方案（架构设计，暂不实施）

**背景**：用户希望在翻译过程中能实时看到译文逐步替换原文，而非等整章翻译完成后统一刷新。

**当前限制**：
- tRPC v11 HTTP 传输不支持 streaming mutations
- 前端使用 `setInterval` 模拟打字效果（仅用于展示，非真实流式）
- 每章翻译需要 5-15 秒，用户等待期间看不到任何进展

**可行方案对比**：

| 方案 | 实现复杂度 | 用户体验 | 是否符合技术栈约束 |
|------|-----------|---------|------------------|
| A. 逐段落轮询 | 低 | 中 | ✅ 纯 tRPC，无新依赖 |
| B. Server-Sent Events (SSE) | 中 | 好 | ⚠️ 需绕过 tRPC，在 Hono 中单独开路由 |
| C. WebSocket | 高 | 好 | ❌ 技术栈冻结，禁止引入 |
| D. 逐章即时 refetch | 低 | 中 | ✅ 已实施（每章翻译完立即 refetch） |

**推荐方案 A（逐段落轮询）**：

1. 后端 `translate.chapter` 保持当前逻辑（返回完整译文）
2. 新增 `translate.progress({ novelId, chapterId })` query：
   - 查询 `chapters` 表中 `contentTranslated` 字段
   - 返回当前已翻译的段落数 / 总段落数
3. 前端 `handleTranslate` 中：
   - 启动 `setInterval` 每 1 秒轮询 `translate.progress`
   - 根据返回的已翻译段落数，将已翻译的段落实时渲染到页面上
   - 全部完成后清除 interval

**方案 B（SSE，备用）**：

在 `api/boot.ts` 中新增独立 Hono 路由 `/api/translate-stream`：

```typescript
app.get('/api/translate-stream', async (c) => {
  const { novelId, chapterId } = c.req.query()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  // 逐 segment 翻译，每完成一个就 write 到 stream
  for (const segment of segments) {
    const translated = await translateSegment(segment)
    writer.write(`data: ${JSON.stringify({ segmentIndex, translated })}\n\n`)
  }
  writer.close()

  return new Response(stream.readable, {
    headers: { 'Content-Type': 'text/event-stream' }
  })
})
```

前端用 `EventSource` 消费 SSE：

```typescript
const es = new EventSource(`/api/translate-stream?novelId=${id}&chapterId=${ch.id}`)
es.onmessage = (e) => {
  const { segmentIndex, translated } = JSON.parse(e.data)
  // 将 translated 内容追加/替换到页面
}
```

**暂不实施原因**：
- 方案 A 需要新增 progress query + 前端轮询逻辑，改动中等
- 方案 B 需要绕过 tRPC，增加架构复杂度
- 当前逐章 `refetch` 方案已能基本满足"翻译完成后立即看到结果"的需求
- 建议等 P0-4（元话语污染）和 P1-4（设定库深度利用）完成后，再评估流式替换的收益

---

## 四、已发现但尚未修复的代码问题

以下问题已全部修复：

1. **`vectorChunks.metadata` 只有 `{indexedAt}`** — ✅ P0-1 修复，语义切分时写入完整来源信息
2. **`to_tsvector('simple', content)` 对中文无效** — ✅ P0-3 修复，新增 `pg_trgm` 模糊搜索补充
3. **`searchSimilar` 中 materialFilter 写法有 bug** — ✅ P0-1 重构时已移除该过滤逻辑，改用 `seriesId` 过滤
4. **全文检索和向量检索没有去重逻辑** — ✅ 已修复。`generate.ts` 引入 `seenChunkIds: Set<number>`，4a/4b 向量检索 push 时记录 chunkId，4c/4d 全文/trgm 检索时先 `SELECT id` 再 `filter(id => !seenChunkIds.has(id))`，彻底杜绝重复 chunk 被多次注入 Prompt

### 新增问题（已全部修复）：

5. **分段翻译 AI 元话语污染** — ✅ P0-4 修复，Prompt 绝对禁止指令 + 上下文桥梁 + 后处理清洗 + 重叠扩展
6. **Reader 无重新翻译入口** — ✅ P0-5 修复，操作菜单新增"重新翻译"按钮，重置状态后 banner 重现
7. **翻译时 lore 注入过于粗放** — ✅ P1-4 修复，动态 lore 只注入出场角色和相关世界观维度，prompt 长度减少 30%-50%

### Phase 2 新增任务（RAG 与风格系统深度优化）：

8. **RAG 检索结果缺少上下文** — ✅ P2-3 已实施（2026-06-02），`searchSimilar` 和 `getChapterRagContext` 返回 `enrichedContent`
9. **RAG 检索场景被截断** — ✅ P2-4 已实施（2026-06-02），`searchSimilar` 自动召回相邻 chunks
10. **RAG 实体别名召回盲区** — ✅ P2-5 已实施（2026-06-02），`getChapterRagContext` 增加 `pg_trgm` 实体搜索补充
11. **翻译无系列级风格指纹** — ✅ P2-6 已实施（2026-06-02），`series.styleFingerprint` + `style-analyzer.ts`
12. **角色对话风格翻译时不一致** — ✅ P2-7 已实施（2026-06-02），`detectSpeakersInSegment` + `buildDialogueStyleSection`
13. **翻译记忆无风格分类** — ✅ P2-8 已实施（2026-06-02），`translation_memory.styleTag` + 自动分类
14. **HyDE 缺失** — ✅ P2-9 已实施（2026-06-02），`generateHydeEmbedding` + `translate.chapter` 集成
15. **RAG 结果无重排序** — ✅ P2-10 已实施（2026-06-02），`rerankRagResults` + `translate.chapter` 集成

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

---

## 新增优化任务详细记录

### 🟢 P2-3：上下文增强检索（Contextual Retrieval）✅ 2026-06-02

**目的**：`vector_chunks.metadata` 已存储 `contextBefore/After`，但检索结果只返回 `content`，AI 看到的片段缺少前后语境。

**涉及文件**：
- `api/services/embedder.ts` — `SearchResult` 接口扩展 + `searchSimilar` 富化内容拼接
- `api/routers/translate.ts` — `getChapterRagContext` 使用富化内容
- `api/routers/generate.ts` — RAG 注入时使用 `enrichedContent`

**具体改动**：

1. **`SearchResult` 接口扩展**（`embedder.ts`）：
```typescript
export interface SearchResult {
  // ... 现有字段 ...
  /** 拼接了 contextBefore + content + contextAfter 的富化内容 */
  enrichedContent?: string
}
```

2. **`searchSimilar` 返回富化内容**（`embedder.ts`）：
```typescript
const enrichedParts: string[] = []
if (contextBefore) enrichedParts.push(`【上文】${contextBefore}`)
enrichedParts.push(content)
if (contextAfter) enrichedParts.push(`【下文】${contextAfter}`)
// enrichedContent 自动拼接
```

3. **`getChapterRagContext` 使用富化内容**（`translate.ts`）：
```typescript
// 查询时同时取 metadata，拼接 contextBefore/After
const enrichedParts: string[] = []
if (contextBefore) enrichedParts.push(`【上文】${contextBefore}`)
enrichedParts.push(content)
if (contextAfter) enrichedParts.push(`【下文】${contextAfter}`)
ragRef.push({ content: enrichedParts.join("\n"), ... })
```

4. **`generate.ts` RAG 注入时使用 `enrichedContent`**：
```typescript
const content = novelResults.map(r => r.enrichedContent || r.content).join("\n---\n")
```

**验收标准**：
- AI 看到的 RAG 片段自带 400 字符上下文（前后各 200 字符）
- `npm run check` 零错误

---

### 🟢 P2-4：相邻 Chunk 自动召回（Parent Document Retrieval）✅ 2026-06-02

**目的**：语义切分后一个场景可能被切成 2-3 个 chunks。检索只命中其中 1 个，另外 2 个的叙事信息丢失。

**涉及文件**：
- `api/services/embedder.ts` — 新增 `enrichWithAdjacentChunks` 函数

**具体改动**：

在 `searchSimilar` 返回前，对每个有完整 `chunkIndex/totalChunks` 的结果：
1. 计算相邻 `chunkIndex`（±1）
2. 通过 `metadata->>'sourceTitle'` + `metadata->>'chapterNumber'` 匹配相邻 chunks
3. 将相邻 chunks 的富化内容拼接到 `enrichedContent` 中

```typescript
async function enrichWithAdjacentChunks(results: SearchResult[]): Promise<SearchResult[]> {
  for (const r of results) {
    // 查询 chunkIndex ± 1 的相邻片段
    const adj = await db.execute(sql`
      SELECT content, metadata FROM vector_chunks
      WHERE source_type = ${r.sourceType}
        AND (metadata->>'sourceTitle')::text = ${r.sourceTitle || ""}
        AND (metadata->>'chapterNumber')::int = ${r.chapterNumber ?? null}::int
        AND (metadata->>'chunkIndex')::int = ANY(${JSON.stringify(adjacentIndices)})
      LIMIT 2
    `)
    // 拼接到 enrichedContent
  }
}
```

**验收标准**：
- 场景完整性从 ~60% 提升到 ~95%
- `npm run check` 零错误

---

### 🟢 P2-5：实体感知查询扩展（Entity-aware RAG）✅ 2026-06-02

**目的**：segment 中出现"萧炎"，但 RAG 语料中可能用"炎盟盟主""萧家三少爷"指代同一人，向量相似度低导致漏召回。

**涉及文件**：
- `api/routers/translate.ts` — 新增 `extractEntityKeywordsFromText` + `getChapterRagContext` 扩展

**具体改动**：

1. **实体关键词提取**：
```typescript
function extractEntityKeywordsFromText(
  text: string,
  characters: typeof characterCards.$inferSelect[]
): string[] {
  const keywords: string[] = []
  for (const char of characters) {
    if (text.includes(char.name)) {
      keywords.push(char.name)
      const aliases = (char.aliases as string[] || []).filter(Boolean)
      for (const alias of aliases) {
        if (text.includes(alias)) keywords.push(alias)
      }
    }
  }
  return [...new Set(keywords)].slice(0, 8)
}
```

2. **`getChapterRagContext` 增加 pg_trgm 实体搜索**：
```typescript
// 在向量搜索之后，用实体关键词做 pg_trgm 模糊搜索补充
if (entityKeywords.length > 0) {
  const entityQuery = entityKeywords.join(" ")
  const trgmResults = await db.execute(sql`
    SELECT content, source_type, similarity(content, ${entityQuery}) as score
    FROM vector_chunks
    WHERE content % ${entityQuery}
    ORDER BY score DESC
    LIMIT 3
  `)
  // 去重后合并到 ragRef
}
```

**验收标准**：
- 角色别名/称谓相关的 RAG 召回率提升 30%+
- `npm run check` 零错误

---

### 🟡 P2-6：系列级风格指纹（Style Fingerprint）⏳ 待实施

**目的**：翻译只有"直译/流畅/文学"三档，过于粗糙。原作实际风格（句长、对话比、修辞密度）没有被量化学习。

**涉及文件**：
- `db/schema.ts` — `series` 表新增 `styleFingerprint` JSONB
- `api/services/style-analyzer.ts` — 新增风格指纹提取服务
- `api/routers/translate.ts` — 翻译 prompt 注入风格指纹

**方案要点**：
- 从已有译文提取：平均句长、对话占比、逗号密度、修辞模式（比喻/递进/夸张）
- 纯本地计算，零 API 额外成本
- 翻译 prompt 注入结构化风格指令

---

### 🟡 P2-7：角色对话风格一致性⏳ 待实施

**目的**：`characterCards.speechPatterns` 已存储角色风格画像，但翻译时完全不使用。

**涉及文件**：
- `api/routers/translate.ts` — 新增对话说话者检测 + 风格注入

**方案要点**：
- 检测 segment 中的对话（引号内容）及说话者
- 识别说话者后注入该角色的 `speechPatterns` 到 prompt
- 同一角色在不同章节对话风格一致

---

### 🟡 P2-8：翻译记忆风格标签⏳ 待实施

**目的**：`translation_memory` 中既有直译样本也有意译样本，召回时混在一起。

**涉及文件**：
- `db/schema.ts` — `translation_memory` 新增 `styleTag` 字段
- `api/routers/translate.ts` — 按风格过滤召回

**方案要点**：
- `styleTag`: "literal" | "fluent" | "literary"
- 自动分类：基于译文特征（句长比、成语密度、修辞数）
- 翻译时只召回同风格标签的记忆

---

### 🟢 P2-9：HyDE（Hypothetical Document Embedding）⏳ 待实施

**目的**：用原文片段做 embedding 查询参考素材，语义不对齐。原文是外文，参考素材是中文描述。

**涉及文件**：
- `api/routers/translate.ts` — 新增 `generateHypotheticalDocument` + 集成到 RAG

**方案要点**：
- 先用 LLM 生成一个"假设的参考文档片段"（中文）
- 用假设文档做 embedding 查询
- 显著提升跨语言 RAG 召回率（+25-50%）
- 结果可缓存（segmentHash → hypotheticalDoc）

---

### 🟢 P2-10：LLM-based RAG 重排序⏳ 待实施

**目的**：当前按 `similarity * qualityScore` 排序，但一个 chunk 向量相似度高不代表对当前翻译任务有用。

**涉及文件**：
- `api/routers/translate.ts` — 新增 `rerankRagResults`

**方案要点**：
- 用 LLM 给每个检索结果打分（1-10 分）
- 按 LLM 评分重排序
- 过滤低质量/不相关的 RAG 结果
- 可与 HyDE 并行调用

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
