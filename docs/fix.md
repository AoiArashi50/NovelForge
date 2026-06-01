  用户反馈翻译功能完全无法使用，核心问题：

     1. Chunk 太大：splitText(text, 2000) 将整章切成 2000 字符块，每块独立调用 AI → 大量 API 调用、响应极慢                                                            
     2. 翻译效果差：prompt 过于简单，没有注入世界观、角色设定、正史等 lore
     3. RAG 范围受限：翻译只搜索 novelId 关联的 vector_chunks，但 novels 表没有 seriesId → 无法复用同一世界观下的二创 RAG 语料
     4. 没有进度反馈：前端只有一个 "翻译中..." spinner，用户不知道进行到哪一章
     5. 翻译不完全/不渲染：无重试机制，出错即中断；Reader 渲染逻辑对翻译后文本处理粗糙

     用户核心诉求：
     - 翻译能充分利用二创那边的 RAG 语料（同一世界观下的素材池、角色设定、世界观圣经）
     - 减小 chunk 提升速度
     - 提升翻译质量（注入 lore）

     ---
     现状诊断

     当前翻译流程

     NovelManager 点击"开始翻译"
       → trpc.translate.start.mutate({ novelId, style })
         → 查询该小说所有 chapters
           → 每章 splitText(content, 2000) → segments
             → 每 segment:
               → fuzzyTranslationMemoryMatch(segment, novelId) → 3条 TM
               → hybridSearchForTranslation(segment.slice(0,200), novelId) → 2条 RAG
               → buildTranslationPrompt(style, TM, RAG, segment)
               → streamChat({messages: [{role:"user", content: prompt}], temp:0.3, maxTokens:4000})
               → 累加到 translatedContent
             → 写入 chapter.contentTranslated
           → 下一章...
         → 返回 {progress:100, completed:true, results, ragCalls}

     关键问题清单

     ┌─────┬───────────────────────────────────────────────────────────────┬──────────────────────────────┬─────────┐
     │  #  │                             问题                              │             位置             │ 严重性  │
     ├─────┼───────────────────────────────────────────────────────────────┼──────────────────────────────┼─────────┤
     │ 1   │ ** novels 表没有 seriesId** → 翻译无法关联系列 RAG            │ db/schema.ts novels          │ 🔴 阻断 │
     ├─────┼───────────────────────────────────────────────────────────────┼──────────────────────────────┼─────────┤
     │ 2   │ 翻译 chunk 2000 字符太大 → 每块 1 次 API 调用，长章节 5-10 次 │ api/routers/translate.ts:226 │ 🔴 高   │
     ├─────┼───────────────────────────────────────────────────────────────┼──────────────────────────────┼─────────┤
     │ 3   │ 每 segment 都要做 embedding → N+1 API 调用                    │ translate.ts:230,231         │ 🔴 高   │
     ├─────┼───────────────────────────────────────────────────────────────┼──────────────────────────────┼─────────┤
     │ 4   │ Prompt 无 lore 注入 → 不利用角色设定、世界观、正史            │ translate.ts:125-154         │ 🟡 高   │
     ├─────┼───────────────────────────────────────────────────────────────┼──────────────────────────────┼─────────┤
     │ 5   │ 无进度反馈 → 用户不知道进行到哪一章                           │ NovelManager.tsx:527-533     │ 🟡 高   │
     ├─────┼───────────────────────────────────────────────────────────────┼──────────────────────────────┼─────────┤
     │ 6   │ 无重试/断点续传 → 出错即中断，已翻译章节丢失上下文            │ translate.ts:219-261         │ 🟡 中   │
     ├─────┼───────────────────────────────────────────────────────────────┼──────────────────────────────┼─────────┤
     │ 7   │ Reader 渲染不处理翻译特殊格式 → 可能显示异常                  │ Reader.tsx:723-724           │ 🟡 中   │
     ├─────┼───────────────────────────────────────────────────────────────┼──────────────────────────────┼─────────┤
     │ 8   │ RAG 只搜 novelId → 无法复用 series 级别的素材池               │ translate.ts:75-80           │ 🔴 阻断 │
     ├─────┼───────────────────────────────────────────────────────────────┼──────────────────────────────┼─────────┤
     │ 9   │ 翻译记忆 fallback 是随机取 3 条 → 完全无用                    │ translate.ts:43-56           │ 🟡 中   │
     ├─────┼───────────────────────────────────────────────────────────────┼──────────────────────────────┼─────────┤
     │ 10  │ 无术语一致性强制机制 → 同一人名/地名前后翻译不一致            │ translate.ts prompt          │ 🟡 中   │
     └─────┴───────────────────────────────────────────────────────────────┴──────────────────────────────┴─────────┘

     ---
     方案设计

     原则

     - 系列驱动：翻译以 seriesId 为核心，而非 novelId
     - 小 chunk + 上下文保留：600-800 字符/块，保留前后文重叠
     - Lore 注入：翻译 prompt 复用 buildSystemPrompt 中的世界观、角色、正史组装逻辑
     - 进度可见：分章节返回，前端轮询进度

     ---
     Phase 1: 数据层修复（必须先做）

     1.1 给 novels 表添加 seriesId（P0）

     位置：db/schema.ts

     export const novels = pgTable("novels", {
       // ... existing fields ...
       seriesId: integer("series_id"),  // ← 新增，关联到 series 表
     })

     关联修改：
     - src/pages/NovelManager.tsx：上传/创建小说时允许选择系列（或后续在小说卡片上绑定）
     - api/routers/upload.ts 或 novel.create：支持传入 seriesId

     ▎ 为什么必须：没有 seriesId，翻译就无法复用同一世界观下的 RAG 语料。

     1.2 novels ↔ series 关联前端（P0）

     位置：src/pages/NovelManager.tsx

     - 小说卡片操作菜单增加"绑定系列"选项
     - 翻译前检查：若小说未绑定系列，提示用户先绑定
     - 已绑定系列的小说，翻译时自动使用 seriesId 搜索 RAG

     ---
     Phase 2: 翻译引擎重构（核心）

     2.1 减小 chunk + 保留上下文重叠（P0）

     位置：api/routers/translate.ts

     替换 splitText(text, 2000) 为 splitIntoSemanticChunks()（复用 api/lib/chunk-utils.ts 中已有的语义切分）：

     // 当前（问题）
     const segments = splitText(chapter.contentOriginal, 2000) // 2000 字符/块

     // 目标（修复）
     const segments = splitIntoSemanticChunks(chapter.contentOriginal, {
       targetSize: 800,      // 800 字符/块，响应更快
       overlap: 200,         // 前后 200 字符重叠，保留上下文
       respectBoundaries: true, // 优先在段落/对话边界切分
     })

     2.2 预计算 embedding，避免 N+1（P0）

     位置：api/routers/translate.ts

     当前每 segment 都要做 2 次 embedding（TM + RAG）。改为每章预计算一次：

     // 当前（问题）
     for (const segment of segments) {
       const fuzzyMatches = await fuzzyTranslationMemoryMatch(segment, novelId, 3)  // ← 每段 1 次 embedding
       const ragRef = await hybridSearchForTranslation(segment.slice(0, 200), novelId, 2) // ← 每段 1 次 embedding
     }

     // 目标（修复）
     // 1. 用章节前 500 字做 embedding（代表本章主题）
     const chapterEmbedding = await getEmbedding(chapter.contentOriginal.slice(0, 500))

     for (const segment of segments) {
       // 2. 复用 chapterEmbedding 做 RAG 搜索（无需重复 embedding）
       const fuzzyMatches = await fuzzyTranslationMemoryMatchWithEmbedding(
         chapterEmbedding, novelId, seriesId, 3
       )
       const ragRef = await hybridSearchForTranslationWithEmbedding(
         chapterEmbedding, novelId, seriesId, 2
       )
     }

     新增函数：
     - fuzzyTranslationMemoryMatchWithEmbedding(embedding, novelId, seriesId, topK)
     - hybridSearchForTranslationWithEmbedding(embedding, novelId, seriesId, limit)

     2.3 RAG 搜索范围扩展到 series（P0）

     位置：api/routers/translate.ts:62-122

     当前 RAG 只搜 novelId：
     WHERE novel_id = ${novelId}

     改为优先搜 seriesId（若小说绑定了系列），同时保留 novelId 过滤：
     WHERE (
       (${seriesId}::int IS NOT NULL AND series_id = ${seriesId})
       OR novel_id = ${novelId}
     )

     这样可以复用：
     - 素材池中的平行语料（translation_memory）
     - 素材池中的参考小说/知识文档（vector_chunks）
     - 二创生成的风格样本（vector_chunks sourceType="style_sample"）

     2.4 翻译 Prompt 注入 Lore（P0）

     位置：api/routers/translate.ts:125-154

     当前 prompt 只有风格指令 + TM + RAG。应复用 generate.ts 中的 lore 组装逻辑：

     【世界观设定】（来自 worldBibles）
     【角色设定】（来自 characterCards，若小说中出现的角色）
     【正史约束】（来自 seriesCanon）
     【术语表】（来自 translation_memory 高频词提取）
     【翻译参考】（TM few-shot + RAG context）

     新增：术语一致性强制
     - 从 translation_memory 中提取该 series 下高频出现的 source→translated 映射
     - 在 prompt 中明确要求："以下术语必须按此表翻译，严禁自创译名"

     2.5 进度反馈机制（P1）

     位置：api/routers/translate.ts + src/pages/NovelManager.tsx

     由于 tRPC v11 不支持 streaming mutations，采用章节级轮询：

     后端：
     - translate.start 改为异步执行，写入 translation_jobs 表跟踪进度
     - 新增 translate.progress({ jobId }) query

     前端：
     - 开始翻译后获取 jobId
     - 每 2 秒轮询 translate.progress
     - 显示：第 3/15 章翻译中... 已完成 2 章

     简化方案（推荐，先做这个）：
     - 不改表结构，改为分章节返回：前端逐章调用 translate.chapter
     - 每章翻译完成后立即更新 UI，用户能看到逐章推进

     // 前端
     for (const chapter of chapters) {
       setProgress({ current: i + 1, total: chapters.length, chapterTitle: chapter.title })
       await translateChapter.mutateAsync({ novelId, chapterId, style, seriesId })
     }

     2.6 重试机制（P1）

     每 segment 翻译失败时，自动重试 1 次（换更小的 chunk 或更高的 temperature）。

     ---
     Phase 3: Reader 渲染修复（P1）

     3.1 翻译文本分段渲染（P1）

     位置：src/pages/Reader.tsx:790-834

     当前 renderParagraphs 按 \n\s*\n 分段。但 AI 翻译可能输出不同格式（如连续段落无空行）。

     修复：
     - 翻译后文本若段落数与原文差异 >20%，显示警告提示
     - 支持手动调整段落对齐

     3.2 双语对照模式增强（P2）

     - 桌面端：左右分栏对照（原文左、译文右）
     - 段落级对齐高亮（hover 某段时两边同步高亮）

     ---
     文件修改清单

     ┌────────┬────────────────────────────┬────────────────────────────────────────────────────────────────────┐
     │ 优先级 │            文件            │                                变更                                │
     ├────────┼────────────────────────────┼────────────────────────────────────────────────────────────────────┤
     │ P0     │ db/schema.ts               │ novels 表新增 seriesId 字段                                        │
     ├────────┼────────────────────────────┼────────────────────────────────────────────────────────────────────┤
     │ P0     │ api/routers/translate.ts   │ 重构 chunk 策略、预计算 embedding、series 级 RAG、lore 注入 prompt │
     ├────────┼────────────────────────────┼────────────────────────────────────────────────────────────────────┤
     │ P0     │ api/services/embedder.ts   │ 新增 searchSimilarWithEmbedding 复用 embedding                     │
     ├────────┼────────────────────────────┼────────────────────────────────────────────────────────────────────┤
     │ P0     │ src/pages/NovelManager.tsx │ 小说绑定系列 UI、翻译进度显示                                      │
     ├────────┼────────────────────────────┼────────────────────────────────────────────────────────────────────┤
     │ P0     │ api/routers/novel.ts       │ create/update 支持 seriesId                                        │
     ├────────┼────────────────────────────┼────────────────────────────────────────────────────────────────────┤
     │ P1     │ src/pages/Reader.tsx       │ 翻译文本渲染优化、段落对齐检测                                     │
     ├────────┼────────────────────────────┼────────────────────────────────────────────────────────────────────┤
     │ P1     │ api/routers/translate.ts   │ 逐章翻译 API（translate.chapter）                                  │
     └────────┴────────────────────────────┴────────────────────────────────────────────────────────────────────┘

     ---
     推荐实施顺序

     第 1 轮（必须，解决"完全不可用"）

     1. db/schema.ts 添加 novels.seriesId + npm run db:push
     2. NovelManager 添加小说→系列绑定 UI
     3. translate.ts 重构：
       - 小 chunk (800) + 重叠 (200)
       - 预计算 embedding（每章 1 次而非每段 1 次）
       - RAG 搜索扩展到 seriesId
       - prompt 注入 lore（世界观、角色、术语表）

     第 2 轮（体验提升）

     4. 逐章翻译 API + 前端进度条
     5. Reader 渲染优化

     ---
     验收标准

     1. 绑定系列后翻译，RAG 能召回素材池中的平行语料（检查 translateRagCalls）
     2. 长章节（5000+ 字）翻译时间从 "卡住数分钟" 降至 "每章 10-30 秒"
     3. 同一人名/术语在全文翻译中保持一致
     4. 翻译 prompt 中包含世界观/角色设定（可在 DeepSeek 日志中验证）
     5. npm run check 零错误