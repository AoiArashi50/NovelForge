# NovelForge 增强方案蓝图

> **文档定位**：本文件是给后续 Agent 的**执行蓝图**。阅读本文件后，Agent 应能独立完成其中任何一项任务，无需再询问用户。
>
> **最后更新**：2026-06-01
> **核心主线**：用户体验打磨 + RAG 智能化深度优化

---

## 一、项目当前状态快照

### 1.1 已完成的功能（截至 2026-06-01）

| 模块 | 状态 | 说明 |
|------|------|------|
| 小说上传/解析/翻译 | ✅ | 支持 txt/docx/pdf，DeepSeek 翻译，双语阅读器 |
| 素材池（RAG 投喂）| ✅ | 平行语料、参考小说、知识文档三种类型，自动索引 |
| 设定库（LoreLibrary）| ✅ | 角色卡、世界观圣经（动态 aspects）、正史、桥段库 |
| 设定库智能化 | ✅ | 素材一键提取角色+世界观，同名自动合并（角色三级去重+世界观维度去重），批量提取 |
| 二创工作台（Studio）| ✅ | 4 种创作模式，6 个可调参数，RAG 条数可调（1-10），保存到小说管理 |
| RAG Hybrid Search | ✅ | 向量检索 + 全文检索（`simple` + `pg_trgm`），合并去重，来源可追溯 |
| 翻译记忆反哺 | ✅ | `styleFidelity >= 7` 时自动注入 `translation_memory` 样本 |
| 生成内容回流 | ✅ | 生成结果可保存为 `style_sample`，自动索引反哺后续生成 |
| RAG 反馈闭环 | ✅ | `ragFeedback` 表记录每次生成使用的 chunks，支持 👍/👎 评分 |
| 风格自动提炼 | ✅ | 基于 `style_sample` 自动提炼角色语言风格画像 |
| 桥段热key统计 | ✅ | 遍历历史生成记录统计桥段使用频率，Top-3 自动注入 prompt |
| 语义切分 | ✅ | 场景/段落边界感知切分（600-1500 字符/块），保留上下文 |

### 1.2 技术栈（冻结，不得变更）

- **前端**：React 19 + TypeScript + Vite + Tailwind 3.4 + tRPC React Query
- **后端**：Hono + tRPC 11 + Drizzle ORM + postgres-js
- **AI**：DeepSeek V4 Pro（1M 上下文）via `fetch`
- **Embedding**：DashScope `text-embedding-v4`（1536 维，OpenAI-compatible API）
- **数据库**：PostgreSQL 16 + pgvector + pg_trgm
- **部署**：Docker Compose + Alibaba Cloud ECS

### 1.3 关键约束（必须遵守）

1. **tRPC v11 不支持 streaming mutations** — 所有流式端点已改为普通 async，前端用 `setInterval` 模拟打字效果。若需进度通知，考虑轮询或 SSE。
2. **Drizzle ORM `db.execute()` 只接受一个参数** — 必须用 `` sql`...` `` 模板字面量，禁止 `db.execute("SELECT ...", [params])`。
3. **Dark Theme Only** — 背景 `#111827`，文本 `#FDFBF5`，强调色 `#F59E0B`。
4. **单用户无认证** — 所有 API 都是 public。
5. **`noUnusedLocals` / `noUnusedParameters` 已开启** — 不能有未使用的 import 或参数。
6. **No new dependencies** — 不能引入新 npm 包（如 React Hot Toast、Zustand 等），所有功能用现有技术栈实现。
7. **所有 DB 操作通过 Drizzle ORM** — 禁止手写 SQL（`db.execute(sql\`...\`)` 除外）。

---

## 二、用户体验增强方案

### 2.1 🔔 Toast 通知系统（优先级：P0 / 高）

#### 问题描述

全站大量使用原生 `alert()` 进行成功/失败提示：
- `Studio.tsx`：保存成功、导出成功
- `LoreLibrary.tsx`：合并完成、风格提炼完成、补全完成
- `MaterialPool.tsx`：一键提取完成

`alert()` 阻断用户操作流，且样式与暗色主题完全不搭。用户在点击"生成"后若触发 alert，会完全打断创作心流。

#### 方案设计

**组件架构**：
```
ToastProvider (Context)
  └── ToastContainer (固定定位在右上角)
        └── ToastItem[] (堆叠显示，最多 5 个)
```

**API 设计**：
```typescript
// src/hooks/useToast.ts
interface ToastOptions {
  message: string
  type: "success" | "error" | "warning" | "info"
  duration?: number  // 默认 3500ms
}

function useToast() {
  return {
    success: (message: string) => void
    error: (message: string) => void
    warning: (message: string) => void
    info: (message: string) => void
  }
}
```

**视觉设计**（暗色主题适配）：
| 类型 | 背景 | 左边框 | 图标 |
|------|------|--------|------|
| success | `bg-green-500/10` | `border-l-2 border-green-500` | `CheckCircle` |
| error | `bg-red-500/10` | `border-l-2 border-red-500` | `AlertCircle` |
| warning | `bg-amber-500/10` | `border-l-2 border-amber-500` | `AlertTriangle` |
| info | `bg-blue-500/10` | `border-l-2 border-blue-500` | `Info` |

**动画**：进入时从右侧滑入 + 透明度渐变（Framer Motion 或 CSS transition），离开时向上滑出。

**替换清单**（必须全部替换）：
- `Studio.tsx`：`alert()` × 3 处
- `LoreLibrary.tsx`：`alert()` × 6 处
- `MaterialPool.tsx`：`alert()` × 2 处

**涉及文件**：
- 新建 `src/providers/toast.tsx` — ToastProvider + useToast hook
- 新建 `src/components/Toast.tsx` — Toast 组件 + ToastContainer
- 修改 `src/main.tsx` — 包裹 ToastProvider
- 修改 `src/pages/Studio.tsx` — 替换所有 alert
- 修改 `src/pages/LoreLibrary.tsx` — 替换所有 alert
- 修改 `src/pages/MaterialPool.tsx` — 替换所有 alert

**验收标准**：
- 全站零 `alert()` 调用（`grep -r "alert(" src/` 返回空）
- Toast 自动消失（3.5 秒），支持手动关闭（X 按钮）
- 最多同时显示 5 个，超出时最早的自动移除
- 暗色主题样式一致，`npm run check` 零错误

---

### 2.2 💾 Studio 本地草稿自动保存（优先级：P0 / 高）

#### 问题描述

用户在 Studio 编辑 brief、调整参数、生成内容后，若意外刷新页面或浏览器崩溃，所有未保存状态全部丢失。当前没有任何恢复机制。

#### 方案设计

**存储策略**：
- 使用 `localStorage`，key 为 `novelforge_studio_draft`
- 每 10 秒自动保存一次（`useEffect` + `setInterval`）
- 仅在内容有变化时写入（对比序列化后的 JSON hash）

**存储内容**：
```typescript
interface StudioDraft {
  version: 1
  savedAt: string  // ISO timestamp
  selectedSeriesId: number | null
  selectedParentNovelId: number | null
  title: string
  brief: string
  userPrompt: string
  params: GenParams
  selectedCharacterIds: number[]
  selectedTropeIds: number[]
  selectedMaterialIds: number[]
  content: string  // 生成的内容（可能很大，只存最新）
  generatedWorkId: number | null
}
```

**恢复流程**：
1. 页面加载时检测 `localStorage.getItem("novelforge_studio_draft")`
2. 若存在且 `savedAt` 在 7 天内，在 Studio 顶部显示横幅：
   ```
   💾 发现 2 小时前的未保存草稿 [恢复编辑] [丢弃]
   ```
3. 点击"恢复编辑"后填充所有状态
4. 点击"丢弃"后清除 localStorage

**清除时机**：
- 用户点击"保存到小说管理"成功后
- 用户点击"丢弃草稿"后
- 草稿超过 7 天自动过期（加载时检查，过期则清除）

**涉及文件**：
- 修改 `src/pages/Studio.tsx` — 新增 draft 读写逻辑

**验收标准**：
- 编辑 brief 后刷新页面，能恢复上次状态
- 生成内容后刷新页面，能恢复内容和参数
- 保存成功后自动清除草稿
- `npm run check` 零错误

---

### 2.3 🔍 历史作品搜索 + 筛选（优先级：P1 / 中）

#### 问题描述

Studio 的"历史作品"Tab 只有简单列表，按时间倒序排列。作品超过 20 条后翻找困难，用户无法快速定位之前生成的某篇二创。

#### 方案设计

**前端交互**：
- 在"历史作品"区域顶部增加搜索栏：
  ```
  [🔍 搜索作品标题或简介...] [筛选 ▼] [排序 ▼]
  ```
- 筛选条件（下拉）：
  - 系列（从 seriesList 动态加载）
  - 创作模式（正史续写/角色外传/同世界观原创/AU）
  - 时间范围（最近 7 天 / 30 天 / 全部）
- 排序选项（下拉）：
  - 最近生成（默认）
  - 最近修改
  - 标题字母序

**后端 API**：
```typescript
// api/routers/generate.ts
generate.search: publicQuery
  .input(z.object({
    query: z.string().optional(),        // 标题/brief 模糊搜索
    seriesId: z.number().optional(),
    writingMode: z.string().optional(),
    days: z.number().optional(),         // 最近 N 天
    sortBy: z.enum(["createdAt", "updatedAt", "title"]).default("createdAt"),
    limit: z.number().min(1).max(50).default(20),
  }))
  .query(async ({ input }) => {
    // 使用 Drizzle 动态构建 where 条件
    // 模糊搜索用 pg_trgm：sql`${fanFictionWorks.title} % ${input.query}`
    // 或直接用 Drizzle 的 like 操作符（标题匹配即可，不必全文）
  })
```

**涉及文件**：
- 修改 `api/routers/generate.ts` — 新增 `search` query
- 修改 `src/pages/Studio.tsx` — 历史作品区域增加搜索/筛选/排序 UI

**验收标准**：
- 输入关键词可搜索作品标题和 brief
- 筛选系列后只显示该系列作品
- 排序切换生效
- `npm run check` 零错误

---

### 2.4 ⚡ 生成过程可视化（优先级：P1 / 中）

#### 问题描述

点击"开始创作"后只有一个旋转 Loading（`Loader2`），用户不知道 AI 在做什么、卡在哪一步。若 RAG 检索耗时较长（如素材很多时），用户会觉得"系统卡死了"。

#### 方案设计

**由于 tRPC v11 不支持 streaming mutations**，采用**轮询进度**方案：

**后端**：
1. `fanfiction` mutation 接收请求后，在内存中维护一个进度状态（简单对象即可，单用户场景不需要 Redis）：
   ```typescript
   const generationProgress = new Map<number, { step: number; message: string; detail?: string }>()
   ```
   key 为临时任务 ID（UUID 或时间戳）。
2. 各阶段更新进度：
   - step 1: "正在检索参考素材..."（RAG 阶段）
   - step 2: "正在组装创作指令..."（System Prompt 阶段）
   - step 3: "AI 正在创作中..."（DeepSeek 调用阶段）
   - step 4: "正在保存作品..."（数据库写入阶段）
3. 新增 query `generate.progress({ taskId })` 供前端轮询。

**前端**：
- 点击"开始创作"时生成临时 `taskId`，传入 mutation
- 前端每 1.5 秒轮询 `generate.progress`
- 用步骤条（Stepper）展示当前进度：
  ```
  [✓] 检索素材  →  [✓] 组装指令  →  [⟳] AI 创作中...  →  [○] 保存作品
  ```
- 第三步展示已生成字数（从 DeepSeek 流式响应中统计，但 mutation 不流式传输，只能展示"进行中"）

**简化方案**（推荐）：
由于实现完整的进度轮询较复杂，可先做一个**简化版**：
- 在生成按钮下方显示当前阶段文字（"正在检索 RAG 素材..." → "正在调用 AI 生成..."）
- 用 `setTimeout` 预估各阶段时间，给用户提供心理预期
- RAG 检索完成后、调用 DeepSeek 前更新阶段文字

**涉及文件**：
- 修改 `api/routers/generate.ts` — `fanfiction` mutation 增加阶段状态更新
- 修改 `src/pages/Studio.tsx` — 生成按钮区域增加阶段提示

**验收标准**：
- 生成过程中用户能看到当前处于哪个阶段
- 生成完成后阶段提示自动消失
- `npm run check` 零错误

---

### 2.5 🎹 键盘快捷键（优先级：P2 / 低）

#### 方案

| 快捷键 | 功能 | 作用域 |
|--------|------|--------|
| `Ctrl/Cmd + S` | 保存作品 | Studio 全局 |
| `Ctrl/Cmd + Enter` | 开始生成 | Studio 全局 |
| `Ctrl/Cmd + Shift + Enter` | 续写 | Studio 全局 |
| `Esc` | 关闭弹窗 | 全局 |

**实现**：在 `Studio.tsx` 中添加 `useEffect` 监听 `keydown`，判断 `e.ctrlKey || e.metaKey`。

**注意**：`Ctrl+S` 需要 `e.preventDefault()` 阻止浏览器默认保存页面行为。

**涉及文件**：`src/pages/Studio.tsx`

---

## 三、RAG 增强方案

### 3.1 🧠 检索结果 AI 摘要（优先级：P0 / 高）

#### 问题描述

当前 `buildSystemPrompt` 将 RAG 检索到的 5-10 条 chunks 直接拼接到 prompt 中：
```
【参考素材 1】xxx
【参考素材 2】xxx
【参考素材 3】xxx
```

各 chunk 之间可能：
- **重复**：同一段内容被向量检索和全文检索同时命中
- **矛盾**：不同素材对同一设定的描述不一致
- **碎片化**：一个对话场景被切成 3 块，AI 无法还原完整语境

这导致 AI 生成时出现"信息过载"或"上下文断裂"。

#### 方案设计

**核心思路**：在 RAG 检索完成后、System Prompt 组装前，增加一个**AI 摘要步骤**。

**流程**：
```
brief → embedding → 向量检索 + 全文检索 + trgm 检索 → 合并去重
  → [NEW] AI 摘要：将 5-10 条 chunks 提炼成 500-800 字连贯上下文
  → 注入 System Prompt（替代原始 chunks 拼接）
```

**摘要 Prompt**：
```typescript
const summaryPrompt = `请根据以下从素材库检索到的参考片段，提炼一段连贯、去重、按主题组织的参考上下文。
要求：
1. 去除重复或高度相似的内容
2. 如果不同片段对同一设定有矛盾描述，优先保留最详细/最权威的那条
3. 按「世界观设定」「角色特征」「情节参考」「语言风格」分组组织
4. 总长度控制在 500-800 字
5. 保持原文的关键细节和用词风格

参考片段：
${chunks.map((c, i) => `【片段 ${i + 1}】${c.content}`).join("\n\n")}`
```

**API 调用**：
```typescript
const summary = await chatCompletion({
  messages: [{ role: "user", content: summaryPrompt }],
  temperature: 0.3,
  maxTokens: 1200,
})
```

**fallback**：若摘要调用失败（timeout 或 API 错误），回退到原始 chunks 拼接逻辑，确保生成不中断。

**涉及文件**：
- 修改 `api/routers/generate.ts` — `buildSystemPrompt` 函数中，在 RAG 组装后增加摘要步骤

**验收标准**：
- 相同 brief 下，生成结果的上下文连贯性明显提升
- 摘要失败时不影响生成（fallback 生效）
- prompt 总长度减少 20-40%（chunks 拼接 → 摘要）
- `npm run check` 零错误

---

### 3.2 🗂️ 语义缓存层（优先级：P1 / 中）

#### 问题描述

每次生成时，相同的 brief 都要重新调用 DashScope 做 embedding：
- 耗时：200-500ms（网络往返）
- 费用：每次调用消耗 token
- 用户在同一个 series 下多次微调 brief 生成时，大量重复调用

#### 方案设计

**新增表**：
```typescript
// db/schema.ts
export const embeddingCache = pgTable("embedding_cache", {
  id: serial("id").primaryKey(),
  textHash: varchar("text_hash", { length: 64 }).notNull().unique(),  // SHA-256 前 100 字
  textPreview: varchar("text_preview", { length: 200 }).notNull(),    // 前 200 字，用于调试
  embedding: jsonb("embedding").notNull(),                            // number[]
  createdAt: timestamp("created_at").notNull().defaultNow(),
})
```

**缓存逻辑**（`api/services/embedder.ts`）：
```typescript
export async function getEmbeddingWithCache(text: string): Promise<number[]> {
  const preview = text.slice(0, 100)
  const hash = await sha256(preview)  // 用 Web Crypto API 或简单字符串 hash

  // 1. 查缓存
  const db = getDb()
  const cached = await db
    .select()
    .from(embeddingCache)
    .where(eq(embeddingCache.textHash, hash))
    .limit(1)

  if (cached.length > 0) {
    return cached[0].embedding as number[]
  }

  // 2. 未命中：调用 API
  const embedding = await getEmbedding(text)

  // 3. 写入缓存（异步，不阻塞返回）
  db.insert(embeddingCache).values({
    textHash: hash,
    textPreview: text.slice(0, 200),
    embedding: embedding as unknown as Record<string, unknown>,
  }).catch(() => { /* 缓存写入失败不影响主流程 */ })

  return embedding
}
```

**注意**：
- 不引入新依赖，`sha256` 可用 Node.js 内置 `crypto` 模块：`crypto.createHash('sha256').update(text).digest('hex')`
- 缓存 TTL 用 PostgreSQL 定时任务或定期清理脚本处理（简单的 `DELETE FROM embedding_cache WHERE created_at < NOW() - INTERVAL '7 days'`）

**涉及文件**：
- 修改 `db/schema.ts` — 新增 `embeddingCache` 表
- 修改 `api/services/embedder.ts` — 新增 `getEmbeddingWithCache`
- 修改 `api/routers/generate.ts` — `buildSystemPrompt` 中 brief embedding 改用缓存版本
- 运行 `npm run db:push` 推送新表

**验收标准**：
- 相同 brief 第二次生成时，embedding 调用减少（可通过 console.log 或网络面板验证）
- 缓存表定期清理（7 天 TTL）
- `npm run check` 零错误，`npm run db:push` 成功

---

### 3.3 🔄 多轮上下文感知检索（优先级：P1 / 中）

#### 问题描述

`continue`（续写）时，RAG 检索只基于**原始 brief**，没有考虑**已经生成的内容**：
```typescript
// generate.ts continue mutation
const messages = [
  { role: "system", content: systemPrompt },  // ← systemPrompt 基于原始 brief 的 RAG
  { role: "user", content: `请续写以下内容...\n\n${work.generatedContent}` },
]
```

续写越往后，当前剧情可能已大幅偏离原始 brief，RAG 检索到的素材与当前上下文的关联度越低。

#### 方案设计

**方案 A（简单）**：用已生成内容的**最后 500 字**叠加 brief 做检索 query。
```typescript
const contextQuery = `${input.brief || ""}\n\n前文摘要：${work.generatedContent?.slice(-500) || ""}`
const { prompt: systemPrompt, ragCalls } = await buildSystemPrompt(
  work.seriesId!,
  contextQuery,  // ← 替换原始 brief
  // ...
)
```

**方案 B（推荐）**：用 AI 对前文做"语义摘要"（200 字），再用摘要 + brief 检索。
```typescript
// 1. 对前文做摘要（仅在已生成内容 > 1000 字时）
let storySummary = ""
if ((work.generatedContent || "").length > 1000) {
  const summary = await chatCompletion({
    messages: [{
      role: "user",
      content: `请用 150 字以内总结以下故事目前的发展阶段、核心冲突和最新情节转折，不需要详细复述：\n\n${work.generatedContent!.slice(-2000)}`,
    }],
    temperature: 0.3,
    maxTokens: 300,
  })
  storySummary = summary.trim()
}

// 2. 用摘要 + brief 做检索
const contextQuery = storySummary
  ? `${input.brief || "续写"}\n\n当前剧情阶段：${storySummary}`
  : input.brief || "续写"
```

**fallback**：若摘要调用失败，回退到方案 A（直接用原文最后 500 字）。

**涉及文件**：
- 修改 `api/routers/generate.ts` — `continue` mutation 中修改检索 query 的构造逻辑

**验收标准**：
- 续写第 3+ 次时，RAG 检索到的素材与当前剧情更相关
- 用户主观评价续写连贯性提升
- 摘要失败时不影响续写（fallback 生效）
- `npm run check` 零错误

---

### 3.4 📊 素材质量自动评级（优先级：P1 / 中）

#### 问题描述

RAG 检索时所有 chunks 的权重一视同仁，但：
- 某些 chunks 内容过短（< 100 字），参考价值低
- 用户保存为 `style_sample` 的素材明显更优质
- 收到用户 👍 的 chunk 应该提升权重，👎 的应该降低

#### 方案设计

**新增字段**：
```typescript
// db/schema.ts — vector_chunks 表
// 注意：vector_chunks 在 schema.ts 中的定义需要确认当前字段
// 当前 vector_chunks 表已有：id, content, embedding, metadata, sourceType, seriesId
// 需要新增 qualityScore 字段
```

**评分规则**（在 `api/services/embedder.ts` 的 `indexNovel` 或 `api/routers/rag.ts` 中实现）：

| 条件 | 分数调整 | 触发时机 |
|------|----------|----------|
| 初始值 | 1.0 | 索引时 |
| 内容长度 < 100 字 | -0.2 | 索引时 |
| 内容长度 > 800 字 | +0.1 | 索引时 |
| 被保存为 `style_sample` | +0.5 | 保存风格样本时 |
| 收到用户 👍 反馈 | +0.3 | 评分时 |
| 收到用户 👎 反馈 | -0.3 | 评分时 |
| 分数上限 | 2.0 | — |
| 分数下限 | 0.1 | — |

**检索时应用**：
```typescript
// embedder.ts searchSimilar 中
// 当前排序：ORDER BY embedding <=> query_embedding
// 新排序：ORDER BY (embedding <=> query_embedding) / quality_score
// 或更简单地：先按相似度检索，再在代码层用 qualityScore 重排序 top-N
```

**简化实现**（推荐）：
由于 `vector_chunks` 表可能已有数据，新增字段需要 migration。简化为**不新增字段**，在检索后的代码层做权重调整：
```typescript
// searchSimilar 返回后
const weightedResults = results.map(r => ({
  ...r,
  effectiveScore: (r.similarity || 0) * (r.qualityScore || 1.0),
}))
weightedResults.sort((a, b) => b.effectiveScore - a.effectiveScore)
```

但这需要 `qualityScore` 有地方存储。所以还是需要新增字段，或者放在 `metadata` JSONB 中：
```typescript
// metadata: { indexedAt, sourceId, qualityScore: 1.2, ... }
```

放在 `metadata` 中更简单，不需要改表结构。

**涉及文件**：
- 修改 `api/services/embedder.ts` — `indexNovel` 中计算并存储 `qualityScore`
- 修改 `api/routers/rag.ts` — `feedback` mutation 中更新 `qualityScore`
- 修改 `api/services/embedder.ts` — `searchSimilar` 中按质量分数重排序

**验收标准**：
- 风格样本类型的素材在检索结果中排名更靠前
- 收到 👎 的 chunk 在后续检索中排名下降
- `npm run check` 零错误

---

### 3.5 🎯 动态 RAG 权重调优（优先级：P2 / 低）

#### 问题描述

所有创作模式使用相同的 RAG 检索策略，但不同模式对检索来源的需求差异很大：
- `canon_continuation` 最需要**原作风格**和**正史素材**
- `original_in_universe` 最需要**世界观设定**素材
- `character_spinoff` 最需要**角色风格样本**

#### 方案设计

在 `buildSystemPrompt` 中根据 `writingMode` 调整各检索源的 limit 和注入优先级：

```typescript
const MODE_RAG_CONFIG: Record<WritingMode, {
  novelStyleLimit: number      // 原作风格检索条数
  materialLimit: number        // 素材池检索条数
  keywordLimit: number         // 关键词检索条数
  styleSampleBoost: boolean    // 是否提升 style_sample 权重
}> = {
  canon_continuation:   { novelStyleLimit: 3, materialLimit: 3, keywordLimit: 2, styleSampleBoost: false },
  character_spinoff:    { novelStyleLimit: 2, materialLimit: 4, keywordLimit: 2, styleSampleBoost: true },
  original_in_universe: { novelStyleLimit: 1, materialLimit: 5, keywordLimit: 2, styleSampleBoost: false },
  alternate_universe:   { novelStyleLimit: 2, materialLimit: 4, keywordLimit: 2, styleSampleBoost: true },
}
```

**实现**：在 `buildSystemPrompt` 的 4a/4b/4c 各阶段，根据当前模式读取对应的 limit，而非统一使用 `params.ragLimit`。

**涉及文件**：
- 修改 `api/routers/generate.ts` — `buildSystemPrompt` 中根据 `writingMode` 调整各检索阶段的 limit

**验收标准**：
- 不同模式下检索结果的来源分布符合预期
- 用户主观评价"正史续写更像原作"、"角色外传更注重角色风格"
- `npm run check` 零错误

---

## 四、实施优先级建议

| 优先级 | 方案 | 预期收益 | 工作量 |
|--------|------|----------|--------|
| **P0** | 2.1 Toast 通知系统 | 用户体验提升最直观，消除 alert 打断 | 中 |
| **P0** | 2.2 Studio 草稿自动保存 | 防止数据丢失，用户留存率提升 | 小 |
| **P0** | 3.1 检索结果 AI 摘要 | RAG 质量提升最直接，生成效果更好 | 中 |
| **P1** | 2.3 历史作品搜索筛选 | 作品多了之后必备功能 | 中 |
| **P1** | 2.4 生成过程可视化 | 减少用户焦虑，提升信任感 | 中 |
| **P1** | 3.2 语义缓存层 | 降低 API 费用，提升生成速度 | 小 |
| **P1** | 3.3 多轮上下文感知检索 | 续写质量长期提升 | 中 |
| **P1** | 3.4 素材质量自动评级 | RAG 长期自我优化 | 中 |
| **P2** | 2.5 键盘快捷键 | 效率型用户友好 | 小 |
| **P2** | 3.5 动态 RAG 权重调优 | 精细化调优 | 小 |

**推荐实施顺序**：
1. **第 1 周**：2.1 Toast 系统 + 2.2 草稿自动保存（用户-facing，见效快）
2. **第 2 周**：3.1 AI 摘要 + 3.2 语义缓存（RAG 核心能力提升）
3. **第 3 周**：2.3 搜索筛选 + 2.4 生成可视化（补齐体验短板）
4. **第 4 周**：3.3 上下文感知 + 3.4 质量评级（RAG 深度优化）

---

## 五、Agent 执行检查清单

开始任何任务前，Agent 必须：

- [ ] 读取 `CLAUDE.md` 了解技术栈和约束
- [ ] 读取 `docs/ROADMAP.md` 了解 RAG 飞轮现状
- [ ] 读取本文件了解增强方案全貌
- [ ] 修改前先运行 `npm run check` 确认基线零错误
- [ ] 修改后再次运行 `npm run check` 确保仍为零错误
- [ ] 不要引入新 npm 依赖
- [ ] 保持 Dark Theme 样式一致性（背景 `#111827`，文本 `#FDFBF5`，强调色 `#F59E0B`）
- [ ] 所有 DB 操作通过 Drizzle ORM，不要手写 SQL（除了 `db.execute(sql\`...\`)`）
- [ ] 提交时使用标准格式：`feat(toast): 新增全局 Toast 通知系统`
