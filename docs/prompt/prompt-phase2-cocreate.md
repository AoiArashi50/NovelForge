# Phase 2: 二创工作台 — NovelForge

**角色**: 二创功能开发 Agent  
**目标**: 实现完整的 AI 二创生成工作台，包括 RAG 检索、参数控制、流式生成、人-in-the-loop 编辑  
**前置依赖**: Phase 0 + Phase 1 完成（数据库、基础 API、阅读器就绪）  
**读取优先级**: 先读 `ProjectGoal.md` Section 2.3（二创生成）和 2.4（混合记忆架构），再读本 prompt  

---

## 1. 项目上下文

二创工作台是 NovelForge 的核心差异化功能，仅在桌面 Web 端实现。

### 核心能力
1. **记忆注入**: 生成前自动查询角色卡、世界观、正史，注入 System Prompt
2. **RAG 增强**: 向量检索用户上传的参考小说，提供风格灵感
3. **精细参数控制**: 6 个可调参数（创造力、风格忠实度、角色忠诚度、氛围、长度、正史约束）
4. **流式生成**: 实时显示 AI 输出，逐字/逐段渲染
5. **人-in-the-loop**: 段落锁定、内联编辑、指定范围重生成

### 生成流程
```
用户选择系列 → 加载角色卡 + 世界观 → 填写 Brief → 调整参数 → Generate
  → 后端组装 System Prompt（lore + RAG + brief）→ DeepSeek 流式生成
  → 前端实时渲染 → 用户编辑/锁定/重生成 → 保存
```

---

## 2. 后端开发任务

### 2.1 完善 RAG Router

替换 `api/routers/rag.ts`：

```typescript
import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { vectorChunks } from "@db/schema";
import { indexNovel, searchSimilar } from "../services/embedder";

export const ragRouter = createRouter({
  search: publicQuery
    .input(z.object({
      query: z.string().min(1),
      novelId: z.number().optional(),
      seriesId: z.number().optional(),
      limit: z.number().min(1).max(20).default(5),
    }))
    .query(async ({ input }) => {
      const results = await searchSimilar(input.query, {
        novelId: input.novelId,
        seriesId: input.seriesId,
        limit: input.limit,
      });
      return results;
    }),

  indexNovel: publicQuery
    .input(z.object({
      novelId: z.number(),
      seriesId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      // 获取小说内容
      const { chapters } = await import("@db/schema");
      const chapterList = await db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, input.novelId));

      const fullText = chapterList
        .map(ch => ch.contentOriginal)
        .filter(Boolean)
        .join("\n\n");

      if (!fullText) {
        return { chunkCount: 0 };
      }

      // 先删除旧索引
      await db
        .delete(vectorChunks)
        .where(eq(vectorChunks.novelId, input.novelId));

      // 创建新索引
      const result = await indexNovel(
        input.novelId,
        fullText,
        input.seriesId,
        "reference"
      );

      return result;
    }),
});
```

### 2.2 完善 Generate Router

替换 `api/routers/generate.ts`：

```typescript
import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { characterCards, worldBibles, seriesCanon, fanFictionWorks, chapters } from "@db/schema";
import { eq, asc } from "drizzle-orm";
import { streamChat, chatCompletion } from "../services/deepseek";
import { searchSimilar } from "../services/embedder";

// 生成参数 Schema
const generationParamsSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.8),
  styleFidelity: z.number().min(1).max(10).default(7),
  characterLoyalty: z.number().min(1).max(10).default(8),
  tone: z.string().default("dramatic"),
  lengthTarget: z.enum(["short", "chapter", "arc"]).default("chapter"),
  canonConstraint: z.enum(["strict", "loose", "au"]).default("strict"),
});

// 组装 System Prompt
async function buildSystemPrompt(
  seriesId: number,
  brief: string,
  params: z.infer<typeof generationParamsSchema>,
  parentNovelId?: number,
  userPrompt?: string  // 用户自定义提示词追加
): Promise<string> {
  const db = getDb();

  // 1. 查询角色卡
  const characters = await db
    .select()
    .from(characterCards)
    .where(eq(characterCards.seriesId, seriesId));

  // 2. 查询世界观
  const [worldBible] = await db
    .select()
    .from(worldBibles)
    .where(eq(worldBibles.seriesId, seriesId));

  // 3. 查询正史
  const canonEvents = await db
    .select()
    .from(seriesCanon)
    .where(eq(seriesCanon.seriesId, seriesId))
    .orderBy(asc(seriesCanon.eventOrder));

  // 4. Hybrid RAG 检索：向量检索 + 全文检索 + 素材池
  let ragContent = "";
  const ragParts: string[] = [];

  // 4a. 从关联小说做向量检索
  if (parentNovelId) {
    const novelResults = await searchSimilar(brief, { novelId: parentNovelId, limit: 3 });
    if (novelResults.length > 0) {
      ragParts.push("【原作风格参考】\n" + novelResults.map(r => r.content).join("\n---\n"));
    }
  }

  // 4b. 从素材池做向量检索
  const materialVecResults = await searchSimilar(brief, { seriesId, limit: 3 });
  if (materialVecResults.length > 0) {
    ragParts.push("【投喂素材参考】\n" + materialVecResults.map(r => r.content).join("\n---\n"));
  }

  // 4c. 全文检索补充（关键词匹配，对人名/术语更有效）
  try {
    const fullText = await db.execute(
      `SELECT content,
       ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $1)) as score
       FROM vector_chunks
       WHERE series_id = $2
         AND to_tsvector('simple', content) @@ plainto_tsquery('simple', $1)
       ORDER BY score DESC
       LIMIT 3`,
      [brief.slice(0, 100), seriesId]
    );
    if ((fullText.rows || []).length > 0) {
      const ftContent = (fullText.rows || []).map((r: any) => r.content).join("\n---\n");
      // 去重：如果全文检索结果不在向量检索结果中，才追加
      if (!ragParts.some(p => p.includes(ftContent.slice(0, 50)))) {
        ragParts.push("【关键词参考】\n" + ftContent);
      }
    }
  } catch { /* 全文检索可选，失败不影响主流程 */ }

  if (ragParts.length > 0) {
    ragContent = "\n" + ragParts.join("\n\n");
  }

  // 5. 约束级别说明
  const constraintDesc = {
    strict: "严格遵守正史设定，不得更改或违背已发生的不可变事件",
    loose: "以正史为基础，允许合理的延伸和发挥",
    au: "平行宇宙设定，可以大幅改编原作情节",
  }[params.canonConstraint];

  // 6. 长度说明
  const lengthDesc = {
    short: "一个短场景，约 500-1000 字",
    chapter: "完整一章，约 2000-4000 字",
    arc: "多章故事线大纲，包含 3-5 章的概要",
  }[params.lengthTarget];

  // 7. 氛围映射
  const toneMap: Record<string, string> = {
    dark: "黑暗压抑",
    romantic: "浪漫温情",
    action: "紧张激烈",
    slice_of_life: "日常轻松",
    mysterious: "悬疑诡秘",
    epic: "史诗壮阔",
  };

  // 组装
  const parts: string[] = [
    "你是一位精通中文创作的小说家。请根据以下设定进行创作，输出必须是中文小说正文。",
    "",
    "【创作要求】",
    `- 风格忠实度: ${params.styleFidelity}/10（越高越模仿原作风格）`,
    `- 角色忠诚度: ${params.characterLoyalty}/10（越高越严格遵守角色设定）`,
    `- 氛围: ${toneMap[params.tone] || params.tone}`,
    `- 长度: ${lengthDesc}`,
    `- 正史约束: ${constraintDesc}`,
  ];

  if (worldBible) {
    parts.push("", "【世界观设定】");
    if (worldBible.geography) parts.push(`地理环境: ${worldBible.geography}`);
    if (worldBible.magicSystem) parts.push(`力量体系: ${worldBible.magicSystem}`);
    if (worldBible.technologyLevel) parts.push(`技术水平: ${worldBible.technologyLevel}`);
    if (worldBible.culturalCustoms) parts.push(`文化习俗: ${worldBible.culturalCustoms}`);
  }

  if (characters.length > 0) {
    parts.push("", "【角色设定】");
    for (const char of characters) {
      const traits = (char.personalityTraits as string[] || []).join("、");
      const taboos = (char.taboos as string[] || []).join("、");
      parts.push(`- ${char.name}: ${traits || "无性格标签"}${taboos ? ` | 禁忌: ${taboos}` : ""}`);
      if (char.speechPatterns) parts.push(`  语言风格: ${char.speechPatterns}`);
    }
  }

  const immutableEvents = canonEvents.filter(e => e.isImmutable);
  if (immutableEvents.length > 0) {
    parts.push("", "【不可变正史事件】以下事件绝对不可更改或违背：");
    for (const event of immutableEvents) {
      parts.push(`- ${event.description}`);
    }
  }

  if (ragContent) {
    parts.push(ragContent);
  }

  // 8. 用户自定义提示词（最高优先级追加）
  if (userPrompt && userPrompt.trim()) {
    parts.push("", "【用户自定义要求】(以下内容优先级最高，请优先遵守)");
    parts.push(userPrompt.trim());
  }

  parts.push("", "输出格式要求：");
  parts.push("- 使用标准中文小说排版（段落分明、对话用引号）");
  parts.push("- 不要使用 Markdown 标记");
  parts.push("- 直接输出正文，不要添加额外说明");

  return parts.join("\n");
}

export const generateRouter = createRouter({
  // 二创生成（流式）
  fanfiction: publicQuery
    .input(z.object({
      seriesId: z.number(),
      brief: z.string().min(1),
      parameters: generationParamsSchema,
      parentNovelId: z.number().optional(),
      title: z.string().optional(),
      userPrompt: z.string().optional(), // 用户自定义系统提示词追加
    }))
    .mutation(async function* ({ input }) {
      // 构建系统提示词（含用户自定义）
      const systemPrompt = await buildSystemPrompt(
        input.seriesId,
        input.brief,
        input.parameters,
        input.parentNovelId,
        input.userPrompt
      );

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: input.brief },
      ];

      let fullContent = "";

      // 流式生成
      const stream = streamChat({
        messages,
        temperature: input.parameters.temperature,
        maxTokens: input.parameters.lengthTarget === "short" ? 1500 : input.parameters.lengthTarget === "chapter" ? 4000 : 2000,
      });

      for await (const chunk of stream) {
        fullContent += chunk;
        yield { type: "chunk" as const, content: chunk };
      }

      // 保存到数据库
      const db = getDb();
      const [work] = await db
        .insert(fanFictionWorks)
        .values({
          seriesId: input.seriesId,
          parentNovelId: input.parentNovelId || null,
          title: input.title || `二创_${new Date().toLocaleDateString()}`,
          brief: input.brief,
          parameters: input.parameters as any,
          generatedContent: fullContent,
          status: "draft",
        })
        .returning();

      yield { type: "complete" as const, workId: work.id };
    }),

  // 续写
  continue: publicQuery
    .input(z.object({
      workId: z.number(),
      brief: z.string().optional(),
      userPrompt: z.string().optional(),
    }))
    .mutation(async function* ({ input }) {
      const db = getDb();
      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.workId));

      if (!work) {
        yield { type: "error" as const, message: "作品不存在" };
        return;
      }

      const systemPrompt = await buildSystemPrompt(
        work.seriesId!,
        input.brief || "请继续以下内容",
        (work.parameters as any) || {},
        work.parentNovelId || undefined,
        input.userPrompt
      );

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: `请续写以下内容，保持上下文连贯：\n\n${work.generatedContent}\n\n${input.brief || "继续："}` },
      ];

      let newContent = "";
      const stream = streamChat({
        messages,
        temperature: ((work.parameters as any)?.temperature || 0.8) * 0.9, // 续写温度略低
        maxTokens: 4000,
      });

      for await (const chunk of stream) {
        newContent += chunk;
        yield { type: "chunk" as const, content: chunk };
      }

      // 追加保存
      const fullContent = work.generatedContent + "\n\n" + newContent;
      await db
        .update(fanFictionWorks)
        .set({ generatedContent: fullContent })
        .where(eq(fanFictionWorks.id, input.workId));

      yield { type: "complete" as const, workId: work.id };
    }),

  // 重生成指定段落
  regenerate: publicQuery
    .input(z.object({
      workId: z.number(),
      originalText: z.string(),
      modifiedBrief: z.string(),
      userPrompt: z.string().optional(),
    }))
    .mutation(async function* ({ input }) {
      const db = getDb();
      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.workId));

      if (!work) {
        yield { type: "error" as const, message: "作品不存在" };
        return;
      }

      const systemPrompt = await buildSystemPrompt(
        work.seriesId!,
        input.modifiedBrief,
        (work.parameters as any) || {},
        work.parentNovelId || undefined,
        input.userPrompt
      );

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: `请重写以下段落，要求：${input.modifiedBrief}\n\n原文：\n${input.originalText}\n\n重写：` },
      ];

      let regenerated = "";
      const stream = streamChat({
        messages,
        temperature: ((work.parameters as any)?.temperature || 0.8) * 1.1, // 重生成温度略高
        maxTokens: 2000,
      });

      for await (const chunk of stream) {
        regenerated += chunk;
        yield { type: "chunk" as const, content: chunk };
      }

      // 替换原文中的段落
      const newContent = (work.generatedContent || "").replace(input.originalText, regenerated);
      await db
        .update(fanFictionWorks)
        .set({ generatedContent: newContent })
        .where(eq(fanFictionWorks.id, input.workId));

      yield { type: "complete" as const, regenerated };
    }),

  // 获取作品
  getWork: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [work] = await db
        .select()
        .from(fanFictionWorks)
        .where(eq(fanFictionWorks.id, input.id));
      return work || null;
    }),

  // 更新作品
  updateWork: publicQuery
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      generatedContent: z.string().optional(),
      status: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      const [work] = await db
        .update(fanFictionWorks)
        .set(data)
        .where(eq(fanFictionWorks.id, id))
        .returning();
      return work;
    }),

  // 作品列表
  list: publicQuery
    .input(z.object({
      seriesId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      if (input?.seriesId) {
        return db
          .select()
          .from(fanFictionWorks)
          .where(eq(fanFictionWorks.seriesId, input.seriesId))
          .orderBy(fanFictionWorks.createdAt);
      }
      return db.select().from(fanFictionWorks).orderBy(fanFictionWorks.createdAt);
    }),
});
```

### 2.3 在 api/router.ts 中确保 Router 已注册

确认 `api/router.ts` 包含：

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

### 3.1 二创工作台完整实现（Studio.tsx）

替换 `src/pages/Studio.tsx`：

```tsx
// src/pages/Studio.tsx
// AI 二创工作台 — Phase 2 完整实现
// 左侧编辑区 + 右侧 AI 控制面板

import { useState, useRef, useCallback, useEffect } from "react";
import { useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import {
  PenTool, Sparkles, Save, Download, RotateCcw,
  Lock, Unlock, ChevronRight, Wand2,
  Thermometer, Palette, Heart, Music, FileText, Shield,
  Database
} from "lucide-react";

// 生成参数类型
interface GenParams {
  temperature: number;
  styleFidelity: number;
  characterLoyalty: number;
  tone: string;
  lengthTarget: "short" | "chapter" | "arc";
  canonConstraint: "strict" | "loose" | "au";
}

const DEFAULT_PARAMS: GenParams = {
  temperature: 0.8,
  styleFidelity: 7,
  characterLoyalty: 8,
  tone: "dramatic",
  lengthTarget: "chapter",
  canonConstraint: "strict",
};

const TONE_OPTIONS = [
  { value: "dark", label: "黑暗压抑", icon: "🌑" },
  { value: "romantic", label: "浪漫温情", icon: "💕" },
  { value: "action", label: "紧张激烈", icon: "⚔️" },
  { value: "slice_of_life", label: "日常轻松", icon: "☕" },
  { value: "mysterious", label: "悬疑诡秘", icon: "🔮" },
  { value: "epic", label: "史诗壮阔", icon: "🏔️" },
];

export default function Studio() {
  const { workId } = useParams<{ workId?: string }>();
  const utils = trpc.useUtils();

  // 数据查询
  const { data: seriesList } = trpc.lore.series.list.useQuery();
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null);
  const { data: characters } = trpc.lore.character.list.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  );

  // 状态
  const [content, setContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [brief, setBrief] = useState("");
  const [title, setTitle] = useState("");
  const [userPrompt, setUserPrompt] = useState(""); // 用户自定义系统提示词
  const [params, setParams] = useState<GenParams>(DEFAULT_PARAMS);
  const [lockedParagraphs, setLockedParagraphs] = useState<Set<number>>(new Set());
  const [generatedWorkId, setGeneratedWorkId] = useState<number | null>(null);
  const [useMaterials, setUseMaterials] = useState(true); // 默认启用素材池检索

  // 流式内容
  const [streamingContent, setStreamingContent] = useState("");

  // 生成 mutation
  const generateMutation = trpc.generate.fanfiction.useMutation({
    onSuccess: () => {
      utils.generate.list.invalidate();
    },
  });

  const updateWorkMutation = trpc.generate.updateWork.useMutation();
  const continueMutation = trpc.generate.continue.useMutation();
  const regenerateMutation = trpc.generate.regenerate.useMutation();

  // 处理流式生成
  const handleGenerate = async () => {
    if (!selectedSeriesId || !brief.trim()) return;
    setIsGenerating(true);
    setStreamingContent("");

    const stream = generateMutation.mutateAsync({
      seriesId: selectedSeriesId,
      brief: brief.trim(),
      parameters: params,
      title: title || undefined,
      userPrompt: userPrompt.trim() || undefined,
    });

    let fullContent = "";

    try {
      for await (const chunk of await stream) {
        if (chunk.type === "chunk") {
          fullContent += chunk.content;
          setStreamingContent(fullContent);
        } else if (chunk.type === "complete") {
          setGeneratedWorkId(chunk.workId);
          setContent(fullContent);
        }
      }
    } catch (error) {
      console.error("Generation failed:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  // 段落分割
  const paragraphs = (content || streamingContent)
    .split("\n\n")
    .filter(p => p.trim().length > 0);

  // 锁定/解锁段落
  const toggleLock = (index: number) => {
    setLockedParagraphs(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // 保存
  const handleSave = () => {
    if (!generatedWorkId) return;
    updateWorkMutation.mutate({
      id: generatedWorkId,
      generatedContent: content,
      status: "saved",
    });
  };

  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      <div className="flex h-screen">
        {/* 左侧编辑区 */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* 顶部操作栏 */}
          <header className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-[#111827]/90 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <PenTool className="w-4 h-4 text-amber-500" />
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="作品标题"
                className="bg-transparent text-sm font-serif outline-none placeholder:text-white/30 w-64"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={!generatedWorkId}
                className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 text-sm transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                保存
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([content], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${title || "untitled"}.txt`;
                  a.click();
                }}
                className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-sm transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                导出
              </button>
            </div>
          </header>

          {/* 编辑画布 */}
          <div className="flex-1 overflow-y-auto p-8">
            {content || streamingContent ? (
              <div className="max-w-3xl mx-auto space-y-4">
                {paragraphs.map((para, idx) => (
                  <div
                    key={idx}
                    className={`group relative p-4 rounded-lg transition-colors ${
                      lockedParagraphs.has(idx)
                        ? "bg-amber-500/5 border border-amber-500/20"
                        : "hover:bg-white/[0.02] border border-transparent"
                    }`}
                  >
                    <p className="font-serif leading-[1.8] text-[#FDFBF5] whitespace-pre-wrap">
                      {para}
                    </p>
                    {/* 段落操作 */}
                    <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => toggleLock(idx)}
                        className={`p-1.5 rounded ${
                          lockedParagraphs.has(idx)
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-white/5 text-white/30 hover:text-white/60"
                        }`}
                        title={lockedParagraphs.has(idx) ? "解锁" : "锁定"}
                      >
                        {lockedParagraphs.has(idx) ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
                {isGenerating && (
                  <div className="flex items-center gap-2 text-amber-500 animate-pulse">
                    <Sparkles className="w-4 h-4" />
                    <span className="font-mono text-xs">生成中...</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <Wand2 className="w-12 h-12 text-white/10 mx-auto mb-4" />
                  <p className="text-white/30 font-mono text-sm">在右侧面板选择系列并填写创作要求</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右侧 AI 控制面板 */}
        <aside className="w-[360px] border-l border-white/10 bg-[#111827]/95 backdrop-blur-md overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* 系列选择 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/50 mb-3">
                <BookText className="w-3.5 h-3.5" />
                选择系列
              </label>
              <select
                value={selectedSeriesId || ""}
                onChange={e => setSelectedSeriesId(Number(e.target.value) || null)}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
              >
                <option value="">选择一个系列...</option>
                {seriesList?.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* 已加载的角色 */}
            {selectedSeriesId && characters && characters.length > 0 && (
              <div>
                <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/50 mb-3">
                  <Sparkles className="w-3.5 h-3.5" />
                  已加载角色 ({characters.length})
                </label>
                <div className="flex flex-wrap gap-2">
                  {characters.map(char => (
                    <span
                      key={char.id}
                      className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-mono border border-amber-500/20"
                    >
                      {char.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 素材作用域选择 */}
            {selectedSeriesId && (
              <div>
                <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/50 mb-3">
                  <Database className="w-3.5 h-3.5" />
                  素材作用域
                </label>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    id="use-materials"
                    checked={useMaterials}
                    onChange={e => setUseMaterials(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-white/5 text-amber-500 focus:ring-amber-500"
                  />
                  <label htmlFor="use-materials" className="text-sm text-white/70">
                    包含素材池中的投喂素材
                  </label>
                </div>
                <p className="text-white/30 text-xs">
                  勾选后将同时检索你在<a href="/materials" className="text-amber-500/60 hover:text-amber-500">素材池</a>中上传的平行语料、参考小说和知识文档
                </p>
              </div>
            )}

            {/* 创作要求 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/50 mb-3">
                <PenTool className="w-3.5 h-3.5" />
                创作要求 (Brief)
              </label>
              <textarea
                value={brief}
                onChange={e => setBrief(e.target.value)}
                placeholder="描述你想创作的内容，如：萧炎在魔兽山脉修炼时遇到一位神秘老者的故事"
                className="w-full h-32 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/20"
              />
            </div>

            {/* 用户自定义提示词 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/50 mb-3">
                <Wand2 className="w-3.5 h-3.5" />
                自定义系统提示词 (可选)
              </label>
              <textarea
                value={userPrompt}
                onChange={e => setUserPrompt(e.target.value)}
                placeholder="追加到系统提示词的自定义指令，优先级最高。如：模仿金庸风格，多用环境描写；增加对话推进情节；保持段落简短..."
                className="w-full h-24 px-4 py-3 rounded-xl bg-white/5 border border-amber-500/20 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/20"
              />
              <p className="text-white/30 text-xs mt-2">
                输入的内容将直接追加到 AI 的系统提示词中，优先级高于所有默认设定（但不会覆盖角色卡和世界观的硬约束）
              </p>
            </div>

            {/* 参数滑块 */}
            <div className="space-y-5">
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/50">
                <Thermometer className="w-3.5 h-3.5" />
                生成参数
              </label>

              {/* 创造力温度 */}
              <SliderControl
                label="创造力 (Temperature)"
                value={params.temperature}
                min={0}
                max={2}
                step={0.05}
                onChange={v => setParams(p => ({ ...p, temperature: v }))}
                description="值越高输出越发散有创意，越低越保守"
              />

              {/* 风格忠实度 */}
              <SliderControl
                label="风格忠实度"
                value={params.styleFidelity}
                min={1}
                max={10}
                step={1}
                onChange={v => setParams(p => ({ ...p, styleFidelity: v }))}
                description="对原作写作风格的模仿程度"
              />

              {/* 角色忠诚度 */}
              <SliderControl
                label="角色忠诚度"
                value={params.characterLoyalty}
                min={1}
                max={10}
                step={1}
                onChange={v => setParams(p => ({ ...p, characterLoyalty: v }))}
                description="对角色设定卡的遵守严格程度"
              />
            </div>

            {/* 氛围选择 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/50 mb-3">
                <Music className="w-3.5 h-3.5" />
                氛围
              </label>
              <div className="grid grid-cols-2 gap-2">
                {TONE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setParams(p => ({ ...p, tone: opt.value }))}
                    className={`px-3 py-2 rounded-xl text-sm transition-colors ${
                      params.tone === opt.value
                        ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                        : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                    }`}
                  >
                    <span className="mr-1">{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 长度目标 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/50 mb-3">
                <FileText className="w-3.5 h-3.5" />
                长度
              </label>
              <div className="flex gap-2">
                {[
                  { value: "short" as const, label: "短场景" },
                  { value: "chapter" as const, label: "完整章" },
                  { value: "arc" as const, label: "故事线" },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setParams(p => ({ ...p, lengthTarget: opt.value }))}
                    className={`flex-1 px-3 py-2 rounded-xl text-sm transition-colors ${
                      params.lengthTarget === opt.value
                        ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                        : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 正史约束 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/50 mb-3">
                <Shield className="w-3.5 h-3.5" />
                正史约束
              </label>
              <div className="flex gap-2">
                {[
                  { value: "strict" as const, label: "严格" },
                  { value: "loose" as const, label: "宽松" },
                  { value: "au" as const, label: "AU" },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setParams(p => ({ ...p, canonConstraint: opt.value }))}
                    className={`flex-1 px-3 py-2 rounded-xl text-sm transition-colors ${
                      params.canonConstraint === opt.value
                        ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                        : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 生成按钮 */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !selectedSeriesId || !brief.trim()}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed text-[#111827] rounded-full font-medium text-sm transition-colors flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  开始创作
                </>
              )}
            </button>

            {/* 续写按钮 */}
            {content && generatedWorkId && (
              <button
                onClick={async () => {
                  setIsGenerating(true);
                  const stream = continueMutation.mutateAsync({
                    workId: generatedWorkId,
                  });
                  let newContent = "";
                  for await (const chunk of await stream) {
                    if (chunk.type === "chunk") {
                      newContent += chunk.content;
                      setContent(prev => prev + chunk.content);
                    }
                  }
                  setIsGenerating(false);
                }}
                disabled={isGenerating}
                className="w-full py-3 bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white/70 rounded-full text-sm transition-colors flex items-center justify-center gap-2"
              >
                <ChevronRight className="w-4 h-4" />
                续写
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// 参数滑块组件
function SliderControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  description,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  description: string;
}) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-white/70">{label}</span>
        <span className="font-mono text-xs text-amber-500">{value.toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer slider-track"
          style={{
            background: `linear-gradient(to right, #F59E0B ${percentage}%, rgba(255,255,255,0.1) ${percentage}%)`,
          }}
        />
      </div>
      <p className="text-white/30 text-xs mt-1">{description}</p>
    </div>
  );
}
```

### 3.2 添加滑块样式

在 `src/index.css` 中添加滑块样式：

```css
/* 自定义滑块样式 */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 999px;
  outline: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #F59E0B;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
  border: 2px solid #F59E0B;
  transition: transform 0.15s, box-shadow 0.15s;
}

input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.6);
}

input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #F59E0B;
  cursor: pointer;
  border: 2px solid #F59E0B;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
}
```

---

## 4. 交付物清单

- [ ] 二创工作台完整 UI（系列选择、Brief 输入、6 个参数控制、生成按钮）
- [ ] 流式生成实时渲染（逐字显示 AI 输出）
- [ ] 段落锁定/解锁功能
- [ ] 续写功能
- [ ] 保存/导出功能
- [ ] 后端 generate router 完整实现（fanfiction/continue/regenerate）
- [ ] 后端 rag router 完整实现（search/indexNovel）
- [ ] System Prompt 组装逻辑（角色卡 + 世界观 + 正史 + RAG）
- [ ] `npm run check` 零错误
- [ ] `npm run build` 构建成功

---

## 5. 技术约束

1. 流式生成必须使用 tRPC 的 async generator，前端用 for await 消费
2. System Prompt 组装必须包含所有角色卡、世界观、不可变正史事件
3. RAG 检索结果最多取 top-3，作为风格参考注入
4. 段落锁定状态仅存于前端，不持久化到数据库
5. 所有参数滑块必须实时显示当前数值（Geist Mono 字体）
6. 生成按钮在生成过程中必须禁用并显示"生成中..."
