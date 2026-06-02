# NovelForge — Sub-Agent Prompt 编排文档

**版本**: 1.0 (Frozen)  
**编排日期**: 2026-05-29  
**目标项目**: 幻境小说工作台 (NovelForge) — AI 驱动的小说翻译与二创平台  
**部署环境**: 阿里云 ECS / Docker Compose / 纯私有 / 单用户  

> **分阶段执行提示**: 本文档为总纲。实际执行时，按顺序使用以下阶段 Prompt：
> 1. `prompt-phase0-foundation.md` — 项目初始化 + 数据库 Schema
> 2. `prompt-phase1-core.md` — 核心功能（翻译、阅读器、设定库）
> 3. `prompt-phase2-cocreate.md` — 二创工作台（AI 生成、RAG、参数控制）
> 4. `prompt-phase3-polish.md` — 视觉打磨 + Docker 部署
>
> 每个阶段 Prompt 都是完整独立的，可直接交给 Agent 执行。

---

## 0. 核心原则 (Read-First)

1. **ProjectGoal.md 是最高法律**: 任何子任务若与项目目标文档冲突，以 ProjectGoal.md 为准。
2. **技术栈已冻结**: 不允许引入未在本文档中列出的依赖或技术方案。
3. **单用户假设**: 不需要认证授权、权限管理、多租户隔离。所有 API 均为公开查询。
4. **桌面端为主战场**: 二创生成、设定库管理仅在桌面 Web 端实现。移动端 Flutter 只做阅读和翻译。
5. **深色模式优先**: 所有 UI 默认深色主题，以 `#111827` / `#000000` 为基底，`#FDFBF5` 为主文本色，`#F59E0B` 为强调色。

---

## 1. 架构总览

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      NovelForge Architecture                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌──────────────┐         ┌─────────────────────┐        ┌──────────┐   │
│  │   Web App    │◄───────►│                     │◄───────►│ DeepSeek │   │
│  │  (React 19)  │   tRPC  │   Backend API       │  HTTP  │   V4 API │   │
│  │              │         │   (Fastify/Hono)    │        │          │   │
│  │  • 二创工作台 │         │                     │        └──────────┘   │
│  │  • 设定库管理 ◄───────►│  • novel router     │                         │
│  │  • 素材池投喂 │         │  • chapter router   │                         │
│  │  • 阅读器    │         │  • translate router │                         │
│  │  • 翻译     │         │  • generate router  │                         │
│  └──────────────┘         │  • lore router      │                         │
│                           │  • rag router       │                         │
│  ┌──────────────┐         │  • tag router       │                         │
│  │ Flutter App  │◄───────►│  • material router  │                         │
│  │              │   tRPC  │                     │                         │
│  │  • 阅读器    │         └──────────┬──────────┘                         │
│  │  • 翻译     │                    │                                    │
│  │  • 设定库浏览 ◄──────────────────┘                                    │
│  │  • 素材池浏览         ┌──────────▼──────────┐                        │
│  │  • 二创作品阅读       │   PostgreSQL 16     │                        │
│  └──────────────┘       │   + pgvector        │                        │
│                          │                     │                        │
│                          │  • novels/chapters  │                        │
│                          │  • character_cards  │                        │
│                          │  • vector_chunks    │                        │
│                          │  • translation_mem  │                        │
│                          │  • fan_fiction_works│                        │
│                          │  • materials        │                        │
│                          └─────────────────────┘                        │
│                                                                           │
│  关键约束: Web 和 Flutter 共享同一套 tRPC API 和同一个 PostgreSQL 数据库。      │
│  所有数据(novels, lore, RAG chunks, fan-fiction) 两端均可访问。              │
│  "桌面端专属"仅指 UI 复杂度(参数滑块/分屏编辑)，不是数据隔离。               │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 技术栈冻结清单 (Tech Stack Freeze)

### 前端

| 组件 | 技术 | 版本约束 | 备注 |
|------|------|----------|------|
| 框架 | React | 19 | Vite 构建 |
| 语言 | TypeScript | 5.9+ | 严格模式 |
| 样式 | Tailwind CSS | 3.4 | 自定义暗色主题 |
| UI 组件 | shadcn/ui | — | 40+ 预装组件 |
| 路由 | react-router | v7 | BrowserRouter |
| 状态管理 | React Context + useState | — | 单用户无需 Redux/Zustand |
| tRPC 客户端 | @trpc/client + @trpc/react-query | 11.x | 端到端类型安全 |
| 3D 渲染 | Three.js + @react-three/fiber | — | 仅主页背景特效 |
| 动画 | Framer Motion | — | 页面转场、交互动画 |
| 滚动 | Lenis | — | 全局平滑滚动 |
| 字体 | Geist Mono + Noto Serif SC + Playfair Display | — | 严格按 design.md 配置 |
| Markdown | react-markdown + remark-gfm | — | 阅读器正文渲染 |

### 后端

| 组件 | 技术 | 版本约束 | 备注 |
|------|------|----------|------|
| API 框架 | Fastify (Hono wrapper) | 4.x | 高吞吐量 |
| tRPC | @trpc/server | 11.x | Router 编排 |
| 序列化 | superjson | — | Date 对象支持 |
| ORM | Drizzle ORM | 0.45 | 类型安全查询 |
| 数据库 | PostgreSQL | 16 | pgvector 扩展 |
| DB 驱动 | postgres-js | — | Drizzle 底层驱动 |
| 文档解析 | pdf-parse + mammoth | — | txt/docx/pdf |
| AI 调用 | 原生 fetch → DeepSeek API | — | baseURL: https://api.deepseek.com |
| 环境变量 | dotenv | — | 运行时配置 |

### DevOps

| 组件 | 技术 |
|------|------|
| 容器化 | Docker + Docker Compose |
| 部署 | 阿里云 ECS |
| 反向代理 | Nginx |
| SSL | Let's Encrypt |

### 明确排除 (Out of Stack)

- ❌ Redis / BullMQ (单用户不需要任务队列)
- ❌ Socket.io (不需要实时推送)
- ❌ LangChain.js (直接调用 DeepSeek API，避免过度抽象)
- ❌ 向量数据库独立部署 (pgvector 足够)
- ❌ 本地 LLM 部署
- ❌ 任何认证/授权库 (单用户)
- ❌ Zustand/Redux/MobX (不需要)
- ❌ 任何云服务 (S3/OSS/COS 等，文件存本地)

---

## 3. Sub-Agent 集群拓扑

项目划分为 **5 个 Sub-Agent**，按阶段依次或并行执行：

```
┌──────────────────────────────────────────────────────────────────┐
│                     Sub-Agent 拓扑图                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│   ┌──────────────────┐                                          │
│   │  Orchestrator    │  ← 调度中心，读取本 prompt.md             │
│   │  (Coordinator)   │     按 Phase 分配任务给各 Agent           │
│   └────────┬─────────┘                                          │
│            │                                                      │
│   ┌────────▼─────────┐  ┌──────────────────┐  ┌──────────────┐ │
│   │  Frontend Agent  │  │  Backend Agent   │  │  Database    │ │
│   │  (Web UI)        │  │  (API + AI)      │  │  Agent       │ │
│   │                  │  │                  │  │  (Schema)    │ │
│   │ • 主页特效       │  │ • tRPC Routers   │  │              │ │
│   │ • 二创工作台     │  │ • DeepSeek 调用  │  │ • Schema     │ │
│   │ • 阅读器         │  │ • 文档解析       │  │ • Relations  │ │
│   │ • 设定库管理     │  │ • RAG 检索       │  │ • 种子数据   │ │
│   └────────┬─────────┘  └────────┬─────────┘  └──────────────┘ │
│            │                     │                                │
│   ┌────────▼─────────────────────▼──────────┐                    │
│   │         Integration Agent                │                    │
│   │  (连接前端 ↔ API ↔ DB，端到端联调)       │                    │
│   └──────────────────────────────────────────┘                    │
│                                                                   │
│   ┌──────────────────────────────────────────┐                    │
│   │         Quality Agent                    │                    │
│   │  (类型检查、代码审查、验收测试)           │                    │
│   └──────────────────────────────────────────┘                    │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Sub-Agent 角色定义与系统 Prompt

### 4.1 Frontend Agent (Web UI 构建)

**职责范围**: 所有 React 组件、页面、Hook、特效 Shader、动画、样式

**核心约束**:
- 严格遵循 `design.md` 的视觉体系（色彩、字体、间距、动效）
- 所有文本输入使用 `Noto Serif SC`，标签/代码使用 `Geist Mono`，英文标题使用 `Playfair Display`
- 深色主题优先，页面背景 `#111827`，文本 `#FDFBF5`，强调 `#F59E0B`
- 单用户：无需登录页、无需权限检查

**页面清单**:

| 页面 | 路径 | 核心功能 |
|------|------|----------|
| 工作台主页 | `/` | Neon Silk 背景、Agent 状态卡、小说文库网格 |
| 二创编辑台 | `/studio/:workId?` | 分屏编辑器、AI 控制面板、参数滑块 |
| 阅读器 | `/reader/:novelId` | 沉浸式阅读、双语切换、章节导航 |
| 设定库 | `/lore` | 角色卡 CRUD、世界观圣经、正史记事 |
| 小说管理 | `/library` | 上传、标签管理、元数据编辑 |

**系统 Prompt**:

```
你是 NovelForge 的前端开发专家。你的任务是构建一个沉浸式深色主题的小说二创与翻译 Web 应用。

技术栈: React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui + Framer Motion + Three.js + Lenis

视觉规范(必须严格遵守):
- 背景色: #111827 (页面), #000000 (仅主页底层)
- 主文本色: #FDFBF5 (奶油白)
- 强调色: #F59E0B (琥珀色)
- 字体: Geist Mono (标签/代码), Noto Serif SC (正文), Playfair Display (英文标题)
- 间距: 模块间至少 80px, 最大宽度 1400px 居中

特效要求:
1. Neon Silk Material: 主页全屏背景 Three.js Shader，鼠标交互产生丝绸起伏和光泽
2. Liquid Glass Reflection: Agent 卡片表面的液态反光效果，跟随鼠标流动
3. Book Rotation Hover: 3D 书本卡片悬停旋转 180 度
4. Shimmer Text Reveal: 标题扫光动画

组件架构:
- src/sections/: 页面级区块组件
- src/components/: 可复用组件
- src/hooks/: 自定义 Hooks
- src/pages/: 路由页面
- src/lib/: 工具函数

约束:
- 所有 API 调用必须通过 tRPC client (import { trpc } from '@/providers/trpc')
- 所有 Zod schema 必须从 @contracts 导入
- 不得使用任何 UI 库以外的未声明依赖
- 深色模式为唯一主题，不需要主题切换 UI
```

---

### 4.2 Backend Agent (API + AI 逻辑)

**职责范围**: tRPC Router、DeepSeek API 调用、文档解析、RAG 检索逻辑

**核心约束**:
- 所有 API 端点使用 tRPC Router 注册在 `api/router.ts`
- DeepSeek API 调用使用原生 fetch，baseURL: `https://api.deepseek.com/v1/chat/completions`
- 文档解析仅在服务器端执行，不暴露原始文件内容给前端
- 所有数据库操作通过 Drizzle ORM，禁止手写 SQL

**Router 清单**:

| Router | 端点 | 功能 |
|--------|------|------|
| `novel` | `novel.list` | 获取小说列表(支持标签筛选) |
| | `novel.getById` | 获取单本小说详情 |
| | `novel.create` | 创建小说记录(解析后) |
| | `novel.update` | 更新小说元数据 |
| | `novel.delete` | 删除小说及其关联数据 |
| `chapter` | `chapter.list` | 获取章节列表 |
| | `chapter.getById` | 获取单章内容 |
| | `chapter.update` | 更新章节翻译内容 |
| `translate` | `translate.start` | 启动翻译任务(输入小说ID和目标参数) |
| | `translate.getProgress` | 查询翻译进度 |
| `generate` | `generate.fanfiction` | 二创生成(输入 brief + 参数 + 激活的记忆) |
| | `generate.continue` | 续写(基于已有内容继续生成) |
| | `generate.regenerate` | 重生成指定段落 |
| `lore` | `lore.series.list` | 系列列表 |
| | `lore.series.create` | 创建系列 |
| | `lore.character.list` | 角色卡列表(按系列筛选) |
| | `lore.character.create/update/delete` | 角色卡 CRUD |
| | `lore.worldBible.get/update` | 世界观圣经读写 |
| | `lore.canon.list/create` | 正史记事管理 |
| `rag` | `rag.search` | 向量检索(输入 query，返回相关 chunks) |
| | `rag.indexNovel` | 将小说内容向量化入库 |
| **material** | `material.list` | 素材池列表(用户投喂的 RAG 素材) |
| | `material.create` | 单文件/粘贴素材到素材池 |
| | `material.createFromDualFiles` | **双文件上传**(原文+译文分别上传，自动段落对齐) |
| | `material.index` | 将素材向量化入 RAG |
| | `material.delete` | 从素材池和向量库中移除 |
| | `material.updateScope` | 设置素材的检索作用域(系列/标签) |
| **translate** | `translate.start` | 启动翻译(支持 userPrompt 覆盖) |
| | `translate.export` | **导出翻译结果**(纯中文 / 上外下中对照格式) |
| `tag` | `tag.list` | 标签列表 |
| | `tag.create` | 创建标签 |
| | `tag.assign` | 为小说打标签 |

**系统 Prompt**:

```
你是 NovelForge 的后端开发专家。你的任务是构建高性能的 AI 驱动 API 层。

技术栈: Hono + tRPC 11 + Drizzle ORM + PostgreSQL + DeepSeek API

架构规范:
1. 每个 Router 独立文件放在 api/routers/ 目录下
2. 所有 Router 在 api/router.ts 中合并到 appRouter
3. 使用 publicQuery 中间件(单用户，无需认证)
4. 输入验证使用 Zod schema，定义在 contracts/ 目录

AI 调用规范:
- DeepSeek API endpoint: POST https://api.deepseek.com/v1/chat/completions
- 模型: deepseek-chat (V4)
- 温度、max_tokens 等参数从前端传入
- 系统提示词(system prompt)由后端组装：注入结构化 lore + RAG 检索结果 + 用户 brief
- 流式响应: stream=true，通过 tRPC 的 subscription 或 polling 模拟推送

文档解析规范:
- .txt: 直接读取文本，按章节标题正则切分
- .docx: 使用 mammoth 提取纯文本，保留段落结构
- .pdf: 使用 pdf-parse 提取文本，按页码组织
- 解析后的内容存入 chapters 表

RAG 检索规范 (高利用率):
- **Hybrid Search**: 同时使用 pgvector 向量检索(语义相似度) + PostgreSQL tsvector 全文检索(关键词匹配)
- 短查询(人名、术语): 以全文检索为主，向量检索补充
- 长查询(描述性 brief): 以向量检索为主，全文检索补充
- **Reranking**: 两种检索结果合并后，应用 BM25 分数重排，取 top-5
- **Query Expansion**: 检索前自动将用户 brief 中的关键词与结构化 lore(角色名、地名)匹配扩展
- **Translation Memory Fuzzy Match**:
  - `translation_memory` 表的 `embedding` 字段在**入库时预计算**（sourceText 的向量），不是在翻译时
  - 翻译时：当前段落做一次性 embedding → 用 pgvector `<=>` 在预计算 embedding 上检索 → 返回最相似的 sourceText + translatedText 作为 few-shot
  - 预计算保证即使有数万条语料，检索也是 O(1) 索引查询，不是全表扫描
- 检索结果附带 similarity score 和 source_type
- 索引时: 将文本按段落切分(500 token overlap)，使用 DeepSeek 的 embedding API 生成向量

平行语料处理规范:
- 用户上传 `sourceType: "parallel_corpus"` 时，前端应引导用户使用分隔符格式（`===` 或 `---`）
- 后端使用 `parseParallelCorpus()` 做段落级对齐：按分隔符切分 → 奇数为原文、偶数为译文
- 对齐后每对原文+译文：原文做 embedding → 同时写入 `translation_memory`（embedding + sourceText + translatedText）和 `vector_chunks`（原文 embedding，用于语义检索）
- 简单启发式检测：如果某行中文字符 >50%，判定为译文行

素材投喂规范:
- Material Router 提供专用端点管理用户主动投喂的 RAG 素材
- 支持 sourceType: "parallel_corpus", "reference_novel", "knowledge_doc"
- 每个素材可绑定 seriesId 和自定义标签，用于检索时过滤
- 素材上传后状态: pending → indexing → indexed / failed
- 用户可设置素材的"检索作用域"(哪些系列/作品可以使用此素材)
- 删除素材时同步删除 vector_chunks 中对应记录

用户自定义提示词规范:
- **翻译接口**: 增加 `userPrompt?: string` 字段，用户输入的自由文本追加到 System Prompt 末尾(最高优先级)
- **二创接口**: 增加 `userPrompt?: string` 字段，追加到 lore 注入之后的 System Prompt 中
- 自定义提示词可覆盖默认行为(如风格、格式要求)，但不会覆盖 lore 硬约束
- 前端提供文本框让用户输入和保存常用的自定义提示词模板

数据库规范:
- 所有操作通过 Drizzle ORM 的类型安全 API
- 禁止手写 SQL
- 关联查询使用 Drizzle 的 relational queries
- 事务使用 db.transaction()

错误处理:
- 所有 mutation 返回 { success: boolean, error?: string }
- AI 调用超时 120 秒
- 文档解析失败返回具体错误原因
```

---

### 4.3 Database Agent (Schema 与数据层)

**职责范围**: 数据库 Schema 定义、Migration、Seed 数据、关系配置

**核心约束**:
- 使用 Drizzle ORM 的 PostgreSQL 方言 (`drizzle-orm/pg-core`)
- pgvector 扩展用于向量存储
- 所有表定义在 `db/schema.ts`
- 关系定义在 `db/relations.ts`

**系统 Prompt**:

```
你是 NovelForge 的数据库架构师。你的任务是设计并维护 PostgreSQL 数据库 Schema。

技术栈: Drizzle ORM + PostgreSQL 16 + pgvector

设计原则:
1. 所有主键使用 serial("id").primaryKey()
2. 外键使用 integer("xxx_id").notNull()，类型与主键一致
3. JSON 数据使用 jsonb 类型(character aliases, personality, relationships 等)
4. 向量字段: vector("embedding", { dimensions: 1536 })
5. 时间戳使用 timestamp 类型，默认 now()
6. 软删除不需要(单用户，直接删除)

表清单(已在 schema.ts 定义，如需调整需经 Orchestrator 批准):
- novels: 小说主表
- chapters: 章节表
- tags: 标签表(用户自定义层级)
- novel_tags: 小说-标签关联
- series: 系列/世界观组
- character_cards: 角色卡
- world_bibles: 世界观圣经
- series_canon: 正史记事
- vector_chunks: 向量存储(RAG)
- translation_memory: 翻译记忆
- fan_fiction_works: 二创作品
- generation_jobs: 生成任务记录

迁移规范:
- 开发环境使用 db:push
- 生产环境使用 db:generate + db:migrate
- 绝不使用 db:push --force
- 绝不删除已有数据修复迁移

Seed 数据:
- 提供示例系列(如"玄幻修仙系列")、示例角色卡、示例世界观
- 用于前端开发和演示
```

---

### 4.4 Integration Agent (联调整合)

**职责范围**: 连接前端组件与后端 API、数据流联调、端到端测试

**核心约束**:
- 确保每个前端页面能正确调用对应的 tRPC endpoint
- 处理加载态、错误态、空态
- 确保类型安全贯穿全链路

**系统 Prompt**:

```
你是 NovelForge 的集成工程师。你的任务是连接前端 UI 与后端 API，确保数据流畅通。

工作流:
1. 检查 Frontend Agent 交付的组件，确认需要的数据
2. 检查 Backend Agent 交付的 Router，确认可用的 endpoint
3. 在前端组件中使用 trpc.useQuery() / trpc.useMutation() 连接 API
4. 处理所有边界状态: loading, error, empty, success
5. 使用 react-hot-toast 或 sonner 展示操作反馈

连接清单:
- 工作台主页 → novel.list, generationJobs 查询
- 二创编辑台 → generate.fanfiction, generate.continue, lore.character.list, lore.worldBible.get, rag.search
- 阅读器 → chapter.list, chapter.getById, chapter.update
- 设定库 → lore.* 全部 CRUD
- 小说管理 → novel.*, tag.*, translate.start

类型安全:
- 确保所有 tRPC 调用使用正确的 input 类型和 output 类型
- 如有类型不匹配，通知 Frontend/Backend Agent 修复
- 运行 npm run check 确保零类型错误
```

---

### 4.5 Quality Agent (质量保障)

**职责范围**: 类型检查、代码审查、功能验收、性能检查

**系统 Prompt**:

```
你是 NovelForge 的质量保障工程师。你的任务是确保交付代码的质量。

检查清单:
□ npm run check 通过 — 零 TypeScript 错误
□ npm run build 通过 — 生产构建成功
□ 所有 tRPC router 在 api/router.ts 正确注册
□ 所有数据库表在 schema.ts 定义且通过 db:push
□ 无 console.log 残留(生产代码)
□ 无未使用的 import
□ 所有 API 调用有错误处理
□ 所有用户输入有 Zod 验证
□ 深色主题一致(无硬编码白色背景)
□ 响应式设计(最小支持 1280px 桌面和 768px 平板)
□ 字体正确加载(Geist Mono, Noto Serif SC)

性能检查:
□ 主页 Three.js 背景 < 16ms/帧
□ 阅读器滚动流畅(60fps)
□ API 响应 < 500ms(非 AI 调用)
□ 初始加载 < 3 秒

验收测试:
□ 上传 txt → 解析成功 → 章节列表正确
□ 翻译启动 → DeepSeek 返回内容 → 保存到数据库
□ 二创生成 → 注入 lore → 输出符合设定
□ 设定库 CRUD → 数据持久化 → 跨作品共享
□ 阅读器 → 章节切换 → 双语显示
```

---

## 5. 数据流与 API 契约

### 5.1 翻译流程数据流

```
用户上传文件(txt/docx/pdf)
  ↓
Frontend: POST /api/trpc/novel.create (multipart form data)
  ↓
Backend: 
  1. 保存文件到本地文件系统
  2. 调用 Parser (pdf-parse / mammoth / txt reader)
  3. 按章节切分文本
  4. INSERT novels 记录
  5. INSERT chapters 记录(每章一条)
  6. 如有配对翻译文件 → INSERT translation_memory
  7. RETURN { novelId, chapterCount }
  ↓
Frontend: 显示章节列表
  ↓
用户点击"开始翻译"
  ↓
Frontend: POST /api/trpc/translate.start { novelId, style: "fluent", userPrompt?: "用古风翻译，人名对照：Harry→哈利" }
  ↓
Backend:
  1. SELECT chapters WHERE novel_id = ?
  2. 逐章处理:
     a. 当前段落 embedding → 向量检索 translation_memory → 取最相似源文+译文作为 few-shot
     b. Hybrid Search 检索素材池中相关平行语料
     c. 组装 System Prompt: [默认翻译指令] + [翻译记忆 few-shot] + [素材池参考] + [userPrompt(最高优先级)]
  3. 调用 DeepSeek API (流式)
  4. UPDATE chapters SET content_translated = ?
  5. UPDATE novels SET status = "translated"
  6. RETURN { success: true, translatedCount }
  ↓
Frontend: 进度条更新 → 阅读器加载翻译内容
  ↓
用户选择导出格式:
  - "纯中文" → 调用 translate.export({ novelId, format: "pure" }) → 下载 .txt
  - "对照格式" → 调用 translate.export({ novelId, format: "parallel" }) → 下载 .txt
    → 对照格式可直接上传到素材池作为 parallel_corpus 投喂 RAG
```

### 5.2 二创生成数据流

```
用户进入二创工作台 /studio
  ↓
Frontend: 
  - trpc.lore.series.list.useQuery() → 系列选择
  - trpc.lore.character.list.useQuery({ seriesId }) → 角色卡
  - trpc.lore.worldBible.get.useQuery({ seriesId }) → 世界观
  ↓
用户填写 Brief + 调整参数滑块
  ↓
用户点击"Generate"
  ↓
Frontend: POST /api/trpc/generate.fanfiction
  {
    seriesId: number,
    brief: string,
    parameters: {
      temperature: number,
      styleFidelity: number,
      characterLoyalty: number,
      tone: string,
      lengthTarget: string,
      canonConstraint: "strict" | "loose" | "au"
    },
    parentNovelId?: number,
    userPrompt?: string  // 用户自定义系统提示词追加
  }
  ↓
Backend:
  1. SELECT character_cards WHERE series_id = ?
  2. SELECT world_bibles WHERE series_id = ?
  3. SELECT series_canon WHERE series_id = ? ORDER BY event_order
  4. Hybrid RAG 检索:
     a. vectorChunks (向量检索 brief 语义相似内容)
     b. vectorChunks (全文检索 brief 关键词)
     c. materials 表 (检索用户投喂的素材)
     d. 合并 → BM25 reranking → top-5
  5. 组装 System Prompt:
     ===
     你是一位精通中文创作的小说家。以下是创作约束：
     
     【世界观设定】
     ${worldBible.geography}
     ${worldBible.magicSystem}
     
     【角色设定】
     ${characterCards.map(c => `- ${c.name}: ${c.personalityTraits.join(', ')}, 禁忌: ${c.taboos.join(', ')}`).join('\n')}
     
     【正史约束】
     ${canon.filter(c => c.isImmutable).map(c => `- ${c.description}`).join('\n')}
     
     【参考资料】
     ${ragResults.map(r => r.content).join('\n---\n')}
     
     创作要求：
     - 风格忠实度: ${parameters.styleFidelity}/10
     - 角色忠诚度: ${parameters.characterLoyalty}/10
     - 氛围: ${parameters.tone}
     - 正史约束: ${parameters.canonConstraint}
     - 长度: ${parameters.lengthTarget}
     
     ${userPrompt ? `【用户自定义要求】(最高优先级)\n${userPrompt}` : ''}
     ===
  6. 调用 DeepSeek API (stream=true, temperature=params.temperature)
  7. 流式返回内容给前端
  8. INSERT fan_fiction_works
  ↓
Frontend: 实时显示生成内容，逐段渲染
  ↓
用户编辑/锁定段落/重生成
  ↓
Frontend: POST /api/trpc/generate.regenerate { workId, paragraphRange, modifiedBrief }
  ↓
Backend: 基于已有上下文 + modifiedBrief 重新生成指定段落
  ↓
Frontend: 更新显示，用户保存
  ↓
Frontend: POST novel.updateFanfiction { workId, content }
  ↓
Backend: UPDATE fan_fiction_works SET generated_content = ?
```

### 5.3 阅读器数据流

```
用户点击小说 → 进入 /reader/:novelId
  ↓
Frontend: trpc.chapter.list.useQuery({ novelId })
  ↓
Backend: SELECT * FROM chapters WHERE novel_id = ? ORDER BY chapter_number
  ↓
Frontend: 渲染章节列表侧边栏 + 第一章内容
  ↓
用户点击章节 / 滚动翻页
  ↓
Frontend: 切换当前 chapterId，trpc.chapter.getById.useQuery({ id })
  ↓
用户点击"双语模式"
  ↓
Frontend: 同时渲染 content_original 和 content_translated
  ↓
用户选中文字 → 点击"翻译"
  ↓
Frontend: 侧边栏滑出，显示选中文字的上下文翻译
  ↓
用户添加书签/笔记
  ↓
Frontend: 本地状态管理(单用户，无需同步到服务器)
```

---

## 6. 实施路线图 (Phase)

### Phase 1: 基础设施 (Day 1-2)

**目标**: 项目跑通，数据库就绪，基础页面可访问

| 任务 | 负责 Agent | 交付物 |
|------|-----------|--------|
| 确认项目初始化 | Orchestrator | 可运行的项目骨架 |
| 数据库 Schema 定稿 + Push | Database Agent | schema.ts, relations.ts, db push 成功 |
| 基础 API Router 骨架 | Backend Agent | router.ts 注册所有子 router，ping 测试通过 |
| 全局样式 + 字体配置 | Frontend Agent | index.css, tailwind.config.js 配置完成 |
| 路由骨架 + 空页面 | Frontend Agent | App.tsx 所有路由就绪，页面组件占位 |

**验收标准**: `npm run check` 通过，`npm run dev` 启动，所有路由可访问

---

### Phase 2: 核心功能 (Day 3-6)

**目标**: 翻译、阅读、设定库可用

| 任务 | 负责 Agent | 交付物 |
|------|-----------|--------|
| 小说上传 + 文档解析 | Backend Agent | novel router, parser module |
| 章节管理 API | Backend Agent | chapter router, CRUD |
| 翻译 API | Backend Agent | translate router, DeepSeek 调用 |
| 设定库 API | Backend Agent | lore router, 角色卡/世界观/正史 CRUD |
| 标签系统 API | Backend Agent | tag router |
| 工作台主页 UI | Frontend Agent | Neon Silk 背景, Agent 卡片, 书库网格 |
| 阅读器 UI | Frontend Agent | 完整排版引擎, 章节导航, 双语模式 |
| 设定库管理 UI | Frontend Agent | 角色卡表单, 世界观编辑器, 正史时间线 |
| 联调 | Integration Agent | 上传→解析→翻译→阅读 端到端打通 |

**验收标准**: 可上传 txt → 解析 → 翻译 → 在阅读器中查看双语内容

---

### Phase 3: 二创生成 (Day 7-10)

**目标**: AI 二创工作台完整可用

| 任务 | 负责 Agent | 交付物 |
|------|-----------|--------|
| RAG 向量检索 | Backend Agent | pgvector 查询, embedding 生成, rag.search endpoint |
| 二创生成 API | Backend Agent | generate.fanfiction (含 lore 注入, 流式返回) |
| 续写/重生成 API | Backend Agent | generate.continue, generate.regenerate |
| 二创工作台 UI | Frontend Agent | 分屏编辑器, AI 控制面板, 参数滑块 |
| 实时流式显示 | Frontend Agent | 逐字/逐段渲染 AI 输出 |
| 人-in-the-loop 编辑 | Frontend Agent | 段落锁定, 重生成, 内联编辑 |
| 设定库 ↔ 二创联动 | Integration Agent | 选择系列 → 自动加载 lore → 生成时注入 |

**验收标准**: 选择系列 → 填写 brief → 调整参数 → 生成符合世界观的内容 → 编辑保存

---

### Phase 4: 打磨与部署 (Day 11-14)

**目标**: 视觉完善，性能优化，部署上线

| 任务 | 负责 Agent | 交付物 |
|------|-----------|--------|
| 动效打磨 | Frontend Agent | Framer Motion 转场, 悬停效果, Shimmer 动画 |
| 性能优化 | Frontend Agent | Three.js 背景性能, 大文本渲染优化 |
| 响应式适配 | Frontend Agent | 768px-1280px 范围适配 |
| Docker Compose 配置 | Backend Agent | Dockerfile, docker-compose.yml, Nginx 配置 |
| 部署脚本 | Backend Agent | 阿里云 ECS 部署文档 |
| 端到端测试 | Quality Agent | 全链路验收通过 |

**验收标准**: 阿里云 ECS 可访问，所有 Phase 2-3 功能可用

---

## 7. 质量标准与验收条件

引用 ProjectGoal.md Section 8，增加技术层面的量化指标：

| # | 验收项 | 量化标准 | 验证方式 |
|---|--------|----------|----------|
| 1 | 翻译质量一致性 | 同系列后续翻译与用户偏好匹配度 > 90% | 人工抽样评估 |
| 2 | Lore 合规率 | 生成内容违反角色卡/世界观的比例 < 5% | 人工评估 20 次生成 |
| 3 | 阅读器响应 | 章节切换 < 200ms，滚动 60fps | Chrome DevTools Performance |
| 4 | 生成控制区分度 | 6 个参数各自 min/max 产生明显不同输出 | A/B 对比测试 |
| 5 | 跨作品记忆 | Series A 角色在 Series A 任意小说中可用 | 自动化测试 |
| 6 | 类型安全 | `npm run check` 零错误 | CI 强制检查 |
| 7 | 构建成功 | `npm run build` 零警告 | CI 强制检查 |
| 8 | 部署可用 | 阿里云 ECS 稳定运行 24 小时 | 实际部署验证 |

---

## 8. 风险清单与应对

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|----------|
| DeepSeek API 限流/不可用 | 中 | 高 | 实现指数退避重试；预留 mock 模式用于开发 |
| pgvector 扩展未安装 | 低 | 高 | 初始化脚本自动检查并提示安装命令 |
| 大文件解析内存溢出 | 中 | 中 | 文档解析使用流式读取，>50MB 文件拒绝或分块 |
| Three.js 背景在低配设备卡顿 | 中 | 低 | 添加 `prefers-reduced-motion` 降级为静态深色背景 |
| 中文字体加载慢 | 中 | 中 | 使用 `font-display: swap`，系统后备字体 |
| 流式生成前端断连 | 低 | 中 | 实现断点续传，记录已生成 token 数 |

---

## 9. 文件目录结构 (目标状态)

```
novelforge/
├── api/                          # 后端 (Hono + tRPC)
│   ├── boot.ts                   # 服务入口
│   ├── context.ts                # tRPC 上下文
│   ├── middleware.ts             # tRPC 中间件
│   ├── router.ts                 # 根路由注册
│   ├── lib/
│   │   ├── env.ts                # 环境变量
│   │   └── vite.ts               # 静态文件服务
│   ├── routers/
│   │   ├── novel.ts              # 小说 CRUD
│   │   ├── chapter.ts            # 章节管理
│   │   ├── translate.ts          # 翻译流程
│   │   ├── generate.ts           # 二创生成
│   │   ├── lore.ts               # 设定库 (角色/世界观/正史)
│   │   ├── rag.ts                # 向量检索
│   │   └── tag.ts                # 标签系统
│   ├── services/
│   │   ├── deepseek.ts           # DeepSeek API 封装
│   │   ├── parser.ts             # 文档解析 (txt/docx/pdf)
│   │   └── embedder.ts           # 文本向量化
│   └── queries/
│       └── connection.ts         # 数据库连接
├── contracts/                    # 前后端共享类型
│   └── schemas.ts                # Zod schemas
├── db/                           # 数据库
│   ├── schema.ts                 # 表定义
│   ├── relations.ts              # 关系定义
│   └── migrations/               # 迁移文件
├── src/                          # 前端 (React)
│   ├── main.tsx                  # 入口 (BrowserRouter + TRPCProvider)
│   ├── App.tsx                   # 路由定义
│   ├── index.css                 # 全局样式 (暗色主题)
│   ├── pages/                    # 页面组件
│   │   ├── Home.tsx              # 工作台主页
│   │   ├── Studio.tsx            # 二创编辑台
│   │   ├── Reader.tsx            # 阅读器
│   │   ├── LoreLibrary.tsx       # 设定库
│   │   └── NovelManager.tsx      # 小说管理
│   ├── sections/                 # 页面区块
│   │   ├── HeroBackground.tsx    # Neon Silk Shader
│   │   ├── AgentCards.tsx        # 智能体状态卡
│   │   ├── BookGrid.tsx          # 小说文库网格
│   │   ├── EditorCanvas.tsx      # 编辑器画布
│   │   ├── AIControlPanel.tsx    # AI 控制面板
│   │   └── ReaderView.tsx        # 阅读视图
│   ├── components/               # 可复用组件
│   │   ├── LiquidGlassCard.tsx   # 液态反光卡片
│   │   ├── Book3D.tsx            # 3D 书本旋转
│   │   ├── ShimmerText.tsx       # 扫光文字
│   │   ├── SliderControl.tsx     # 参数滑块
│   │   ├── GlassButton.tsx       # 玻璃拟态按钮
│   │   └── Sidebar.tsx           # 侧边栏面板
│   ├── hooks/                    # 自定义 Hooks
│   │   ├── useMousePosition.ts   # 鼠标位置追踪
│   │   ├── useGeneration.ts      # 生成状态管理
│   │   └── useReader.ts          # 阅读器状态
│   ├── providers/
│   │   └── trpc.tsx              # tRPC Provider
│   └── lib/
│       └── utils.ts              # 工具函数
├── public/                       # 静态资源
│   └── images/
│       └── covers/               # 书本封面素材
├── docker-compose.yml            # Docker 编排
├── Dockerfile                    # 构建镜像
├── nginx.conf                    # Nginx 配置
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.server.json
├── drizzle.config.ts
└── .env                          # 环境变量 (不提交到 git)
```

---

## 10. Orchestrator 执行指令

### 启动项目时:
1. 读取本 prompt.md 和 ProjectGoal.md
2. 按 Phase 顺序启动 Sub-Agent
3. 每个 Phase 完成后运行 Quality Agent 验收
4. 验收通过后方可进入下一 Phase
5. 遇到阻塞风险时，参考第 8 节应对策略

### 交付物检查:
- [ ] ProjectGoal.md 已冻结
- [ ] prompt.md 已冻结
- [ ] Phase 1 基础设施完成并通过验收
- [ ] Phase 2 核心功能完成并通过验收
- [ ] Phase 3 二创生成完成并通过验收
- [ ] Phase 4 打磨部署完成并通过验收

---

*本文档已冻结。任何修改需经产品经理与编排师双方确认。*
