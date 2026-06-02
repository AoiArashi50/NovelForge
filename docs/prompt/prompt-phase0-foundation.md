# Phase 0: 基础设施与项目初始化 — NovelForge

**角色**: 项目初始化 Agent  
**目标**: 创建可运行的项目骨架，配置好所有依赖和工具链  
**前提**: 空目录 `/mnt/agents/output/app`  
**前置知识**: 无（从零开始）  

---

## 1. 项目概述

NovelForge 是一款面向深度阅读者的 AI 驱动小说翻译与二创 Web 应用。
- **桌面端 Web**: 小说上传、AI 翻译、二创生成、设定库管理
- **移动端 Flutter**: 仅做阅读和翻译（二创在桌面端）
- **单用户**: 不需要登录、认证、权限系统
- **深色主题**: 以 #111827 为基底，#FDFBF5 为主文本，#F59E0B 为强调色
- **技术栈冻结**: React 19 + Fastify + PostgreSQL 16 + pgvector + DeepSeek V4

---

## 2. 初始化步骤

### Step 1: 初始化 WebApp

在项目根目录执行：

```bash
cd /mnt/agents/output
bash /app/.agents/skills/webapp-building/scripts/init-webapp.sh "NovelForge"
cd /mnt/agents/output/app
```

这会创建：
- React 19 + TypeScript + Vite 项目
- Tailwind CSS 3.4 + shadcn/ui (40+ 预装组件)
- src/sections/, src/hooks/, src/types/ 目录
- Path alias @/ 已配置

### Step 2: 嫁接 Backend

在 app 目录执行：

```bash
cd /mnt/agents/output/app
bash /app/.agents/skills/backend-building/scripts/init.sh "NovelForge" --features db
```

这会创建：
- Hono + tRPC 后端骨架
- Drizzle ORM + MySQL 配置（需要后续改为 PostgreSQL）
- api/, contracts/, db/ 目录
- src/providers/trpc.tsx（tRPC Provider）

### Step 3: 安装额外依赖

```bash
cd /mnt/agents/output/app
npm install postgres three @react-three/fiber @react-three/drei framer-motion lenis geist react-markdown remark-gfm @types/three
```

### Step 4: PostgreSQL 适配

当前后端默认使用 MySQL，需要全部改为 PostgreSQL：

**修改文件 1**: `api/queries/connection.ts`

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;

export function getDb() {
  if (!instance) {
    const client = postgres(env.databaseUrl, { prepare: false });
    instance = drizzle(client, { schema: fullSchema });
  }
  return instance;
}
```

**修改文件 2**: `drizzle.config.ts`

```typescript
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
```

**修改文件 3**: `vite.config.ts`
确保有 `db` alias：

```typescript
import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    inspectAttr(), react()],
  server: { port: 3000 },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
```

### Step 5: 编写数据库 Schema

在 `db/schema.ts` 中写入完整表定义：

```typescript
import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  real,
  vector,
} from "drizzle-orm/pg-core";

// 小说主表
export const novels = pgTable("novels", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  author: varchar("author", { length: 200 }),
  originalLanguage: varchar("original_language", { length: 50 }),
  status: varchar("status", { length: 50 }).notNull().default("unread"),
  filePath: varchar("file_path", { length: 1000 }),
  contentOriginal: text("content_original"),
  contentTranslated: text("content_translated"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// 章节表
export const chapters = pgTable("chapters", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id").notNull(),
  chapterNumber: integer("chapter_number").notNull(),
  title: varchar("title", { length: 500 }),
  contentOriginal: text("content_original"),
  contentTranslated: text("content_translated"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 标签表（用户自定义层级）
export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  parentId: integer("parent_id"),
  color: varchar("color", { length: 50 }),
  icon: varchar("icon", { length: 50 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 小说-标签关联
export const novelTags = pgTable("novel_tags", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id").notNull(),
  tagId: integer("tag_id").notNull(),
});

// 系列/世界观组
export const series = pgTable("series", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  universeName: varchar("universe_name", { length: 200 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 角色卡
export const characterCards = pgTable("character_cards", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  aliases: jsonb("aliases").default([]),
  age: varchar("age", { length: 50 }),
  appearanceTags: jsonb("appearance_tags").default([]),
  personalityTraits: jsonb("personality_traits").default([]),
  coreMotivations: text("core_motivations"),
  relationships: jsonb("relationships").default({}),
  speechPatterns: text("speech_patterns"),
  taboos: jsonb("taboos").default([]),
  canonicalArcSummary: text("canonical_arc_summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// 世界观圣经
export const worldBibles = pgTable("world_bibles", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull(),
  geography: text("geography"),
  magicSystem: text("magic_system"),
  technologyLevel: text("technology_level"),
  factions: jsonb("factions").default([]),
  timelineEvents: jsonb("timeline_events").default([]),
  culturalCustoms: text("cultural_customs"),
  linguisticNotes: text("linguistic_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// 正史记事
export const seriesCanon = pgTable("series_canon", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull(),
  eventOrder: integer("event_order").notNull(),
  description: text("description").notNull(),
  isImmutable: boolean("is_immutable").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 向量存储（RAG）
export const vectorChunks = pgTable("vector_chunks", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  sourceType: varchar("source_type", { length: 50 }).notNull(),
  novelId: integer("novel_id"),
  seriesId: integer("series_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 翻译记忆
export const translationMemory = pgTable("translation_memory", {
  id: serial("id").primaryKey(),
  sourceText: text("source_text").notNull(),
  translatedText: text("translated_text").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  // 预计算的 sourceText embedding，入库时由 DeepSeek API 生成
  // 翻译时直接用此 embedding 做 fuzzy match，无需实时计算
  novelId: integer("novel_id"),
  seriesId: integer("series_id"), // 绑定系列，检索时过滤用
  frequency: integer("frequency").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 二创作品
export const fanFictionWorks = pgTable("fan_fiction_works", {
  id: serial("id").primaryKey(),
  parentNovelId: integer("parent_novel_id"),
  seriesId: integer("series_id"),
  title: varchar("title", { length: 500 }),
  brief: text("brief"),
  parameters: jsonb("parameters"),
  generatedContent: text("generated_content"),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// 生成任务记录
export const generationJobs = pgTable("generation_jobs", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 50 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  progress: real("progress").notNull().default(0),
  result: text("result"),
  errorLog: text("error_log"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================================
// RAG Material Pool (用户主动投喂素材)
// ============================================================

export const materials = pgTable("materials", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 300 }).notNull(),
  content: text("content").notNull(),
  sourceType: varchar("source_type", { length: 50 }).notNull(),
  // "parallel_corpus" — 原文+译文对照语料
  // "reference_novel" — 参考小说原文
  // "knowledge_doc"   — 知识文档(设定集、世界观笔记等)
  seriesId: integer("series_id"), // 绑定系列，用于检索过滤
  tags: jsonb("tags").default([]), // 用户自定义标签
  description: text("description"), // 素材描述
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  // "pending" | "indexing" | "indexed" | "failed"
  indexedChunks: integer("indexed_chunks").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### Step 6: 创建 relations.ts

在 `db/relations.ts` 中写入：

```typescript
// Relations can be defined here if needed for complex queries
// For now, simple foreign key references are used inline in schema.ts
```

### Step 7: 配置全局样式

在 `src/index.css` 中写入暗色主题：

```css
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 220 13% 9%;
    --foreground: 43 70% 97%;
    --card: 220 13% 12%;
    --card-foreground: 43 70% 97%;
    --popover: 220 13% 12%;
    --popover-foreground: 43 70% 97%;
    --primary: 43 96% 56%;
    --primary-foreground: 220 13% 9%;
    --secondary: 220 13% 18%;
    --secondary-foreground: 43 70% 97%;
    --muted: 220 13% 18%;
    --muted-foreground: 220 9% 46%;
    --accent: 220 13% 18%;
    --accent-foreground: 43 70% 97%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 43 70% 97%;
    --border: 220 13% 20%;
    --input: 220 13% 20%;
    --ring: 43 96% 56%;
    --radius: 0.5rem;
    
    --cream: #FDFBF5;
    --amber: #F59E0B;
    --dark-base: #111827;
    --dark-card: #1F2937;
    --dark-border: rgba(255, 255, 255, 0.1);
    --glass-surface: rgba(255, 255, 255, 0.03);
  }

  body {
    @apply bg-[#111827] text-[#FDFBF5] antialiased;
    font-family: 'Noto Serif SC', 'Georgia', serif;
  }

  * {
    @apply border-[rgba(255,255,255,0.1)];
  }
}
```

### Step 8: 配置字体

在 `tailwind.config.js` 中扩展字体配置：

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        cream: "#FDFBF5",
        amber: "#F59E0B",
        "dark-base": "#111827",
        "dark-card": "#1F2937",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      fontFamily: {
        mono: ['Geist Mono', 'JetBrains Mono', 'monospace'],
        serif: ['Noto Serif SC', 'Georgia', 'serif'],
        display: ['Playfair Display', 'Georgia', 'serif'],
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        shimmerSweep: {
          "0%": { backgroundPosition: "-500%" },
          "100%": { backgroundPosition: "500%" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        shimmerSweep: "shimmerSweep 3s linear infinite",
        float: "float 3s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

### Step 9: 配置 main.tsx（移除 StrictMode）

```typescript
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <TRPCProvider>
      <App />
    </TRPCProvider>
  </BrowserRouter>,
)
```

### Step 10: 配置路由骨架

在 `src/App.tsx` 中写入：

```tsx
import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Studio from './pages/Studio'
import Reader from './pages/Reader'
import LoreLibrary from './pages/LoreLibrary'
import NovelManager from './pages/NovelManager'
import MaterialPool from './pages/MaterialPool'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/studio/:workId?" element={<Studio />} />
      <Route path="/reader/:novelId" element={<Reader />} />
      <Route path="/lore" element={<LoreLibrary />} />
      <Route path="/library" element={<NovelManager />} />
      <Route path="/materials" element={<MaterialPool />} />
    </Routes>
  )
}
```

创建 6 个空页面文件：

```bash
mkdir -p /mnt/agents/output/app/src/pages
mkdir -p /mnt/agents/output/app/src/sections
mkdir -p /mnt/agents/output/app/src/components
mkdir -p /mnt/agents/output/app/src/hooks
mkdir -p /mnt/agents/output/app/src/lib
mkdir -p /mnt/agents/output/app/api/routers
mkdir -p /mnt/agents/output/app/api/services
```

每个页面文件写入最小占位内容：

```tsx
// src/pages/Home.tsx
export default function Home() {
  return <div className="min-h-screen bg-dark-base text-cream">Home</div>
}
```

```tsx
// src/pages/Studio.tsx
export default function Studio() {
  return <div className="min-h-screen bg-dark-base text-cream">Studio</div>
}
```

```tsx
// src/pages/Reader.tsx
export default function Reader() {
  return <div className="min-h-screen bg-dark-base text-cream">Reader</div>
}
```

```tsx
// src/pages/LoreLibrary.tsx
export default function LoreLibrary() {
  return <div className="min-h-screen bg-dark-base text-cream">LoreLibrary</div>
}
```

```tsx
// src/pages/NovelManager.tsx
export default function NovelManager() {
  return <div className="min-h-screen bg-dark-base text-cream">NovelManager</div>
}

// src/pages/MaterialPool.tsx
export default function MaterialPool() {
  return <div className="min-h-screen bg-dark-base text-cream">MaterialPool</div>
}
```

### Step 11: Push 数据库 Schema

```bash
cd /mnt/agents/output/app
npm run db:push
```

### Step 12: 验证构建

```bash
cd /mnt/agents/output/app
npm run check
```

必须零类型错误。

---

## 3. 交付物清单

- [ ] `npm run check` 零错误
- [ ] `npm run dev` 启动成功
- [ ] 5 个路由页面可访问（/、/studio、/reader/:id、/lore、/library）
- [ ] 数据库 Schema 已 push 到 PostgreSQL
- [ ] 所有额外依赖已安装（three, framer-motion, lenis, geist 等）
- [ ] 全局暗色主题生效

---

## 4. 技术约束（不可违反）

1. **数据库**: 必须用 PostgreSQL + pgvector，不能用 MySQL
2. **驱动**: 必须用 postgres-js，不能用 mysql2
3. **Drizzle dialect**: postgresql，不能是 mysql
4. **无 StrictMode**: main.tsx 不能包裹 StrictMode
5. **无认证**: 不安装任何 auth 相关库
6. **端口 3000**: 不能修改
7. **路径别名**: @/ 指向 src/，@contracts/ 指向 contracts/，@db/ 指向 db/
