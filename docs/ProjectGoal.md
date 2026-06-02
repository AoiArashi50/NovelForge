# Project Goal — NovelCraft AI
## AI-Powered Novel Translation & Fan-Fiction Creation Platform

**Version**: 1.0 — Frozen  
**Stack Architecture**: Web (Desktop) + Flutter (Mobile) + DeepSeek V4 + PostgreSQL/pgvector  
**Deployment**: Alibaba Cloud (Private) / Single-User / Docker Compose  

---

## 1. Product Overview

NovelCraft AI is a **strictly single-user** cross-platform application for translating foreign-language novels into Chinese and generating AI-assisted fan-fiction (二创) within established fictional universes. The platform operates across **desktop web browsers** (primary creative workstation) and **mobile devices** (reading & translation on-the-go), deployed privately on Alibaba Cloud.

### Platform Split

| Platform | Primary Role | Key Capabilities |
|----------|-------------|------------------|
| **Desktop Web** | Complete workstation | **All capabilities** — document translation, AI fan-fiction generation, novel upload, structured lore management, parameter-tuned generation control, RAG material feeding, e-book reader with bilingual mode |
| **Mobile (Flutter)** | Portable reader & translator | Document translation (txt/docx/pdf), full-featured e-book reader, library browsing, offline reading cache, access to all lore and generated works, **RAG material feeding (simplified)** |

**Cross-platform data sync**: Both platforms connect to the same unified backend (single tRPC API), sharing the same PostgreSQL database and AI knowledge base (RAG + structured memory). All data — novels, translations, character cards, world bibles, fan-fiction works, and RAG vector indices — is accessible from both Web and Flutter.

**Desktop-first design**: Desktop Web is the **superset** of Mobile Flutter. Desktop includes every feature mobile has, plus exclusive creation tools (parameter sliders, side-by-side editing) that benefit from larger screens. Mobile focuses on reading experience and quick uploads, but can access all data created on desktop.

---

## 2. Core Functional Modules

### 2.1 Document Translation Pipeline

- **Supported formats**: `.txt`, `.docx`, `.pdf`
- **Parsing layer**: `pdf-parse` + `mammoth` + custom text segmentation engine
- **AI translation engine**: DeepSeek V4 (official API)
- **Translation memory**: When user uploads source text alongside its existing translation, the system stores parallel corpus to improve future translation consistency (learns user's preferred phrasing, terminology, and style)
- **Batch upload**: Desktop supports bulk novel upload; mobile supports single-file upload
- **Post-translation**: Parsed into structured chapter/paragraph format for reading engine consumption

### 2.2 Full-Featured E-Book Reader (Shared across platforms)

- **Typography**: Adjustable font family, font size, line spacing, paragraph spacing, margins
- **Themes**: Light / Sepia / Dark / OLED black modes
- **Navigation**: Chapter list, progress bar, jump-to-chapter, bookmarking
- **Annotation**: Highlighting (multiple colors), margin notes, annotation list sidebar
- **Layout**: Paginated (desktop default) + continuous scroll (mobile default), switchable
- **Translation toggle**: Side-by-side or inline toggle between original and translated text (desktop: split view; mobile: tab switch)
- **User-defined translation instructions**: Users can input custom prompt text to influence translation style (e.g., "translate in classical Chinese style", "keep paragraph structure intact", "use these name mappings: Harry→哈利")
- **Dual-format translation export** (核心功能):
  - **纯中文模式** (`pure`): 只输出译文，给人阅读
  - **对照模式** (`parallel`): 输出原文+译文对照格式（上外下中 / 隔行 `===` 分隔），可直接作为 `parallel_corpus` 素材投喂 RAG
  - 对照格式示例：
    ```
    The sky burned with amber light.
    ===
    天空燃烧着琥珀色的光芒。
    ===
    He walked through the silent forest.
    ===
    他穿过寂静的森林。
    ```
  - 用户翻译完成后可选择导出任意格式，对照格式可直接上传到素材池
- **Offline cache**: Mobile supports downloading translated novels for offline reading

### 2.2b AI Translation Engine Features

- **Three built-in styles**: Literal / Fluent / Literary
- **Translation memory learning**: Automatically learns from user-uploaded parallel corpus, applying consistent terminology
- **Fuzzy translation memory match**: Vector-based similarity search against all previously uploaded source+translation pairs, retrieving the closest match as a few-shot example
- **User prompt override**: Free-text field where users can input custom instructions that are appended to the system prompt with highest priority
- **Style persistence**: Remembers the last-used style and user prompt per novel

### 2.3 AI Fan-Fiction Generation (Desktop only)

- **Foundation model**: DeepSeek V4 API
- **Input**: User provides creative brief (plot outline, desired scene, character focus, tone) + optional custom system prompt override
- **Output**: Structured novel chapters with proper paragraphing and dialogue formatting
- **Fine-grained control parameters** (all adjustable via UI sliders/inputs):
  - **Creativity / Temperature**: adherence vs. originality spectrum
  - **Style fidelity**: how closely to mimic source author's prose style
  - **Character loyalty**: strictness to character cards vs. creative reinterpretation
  - **Tone / Atmosphere**: dark, romantic, action-heavy, slice-of-life, etc.
  - **Length target**: short scene, full chapter, multi-chapter arc outline
  - **Canon constraint level**: strict (100% lore-compliant) → loose (inspired by) → AU (alternate universe)
- **User prompt override (system prompt append)**: Free-text field where users can append custom instructions to the system prompt with highest priority override (e.g., "imitate Jin Yong's narrative style", "increase environmental descriptions", "use more dialogue to advance plot")
- **Regeneration**: Per-paragraph regeneration with context preservation, accepts modified brief for the specific paragraph
- **Human-in-the-loop**: Edit generated text inline, lock approved paragraphs, regenerate only unlocked sections

### 2.4 Structured Lore & Character Database (Hybrid Memory Architecture)

This is the **secret sauce** of the platform. Two complementary storage systems work together:

#### A. Structured SQL Storage ("Iron Rules" — mandatory compliance)

Stored in PostgreSQL as typed relational data. Agent **must query and inject** into system prompt before every generation call.

| Entity | Fields | Purpose |
|--------|--------|---------|
| **Character Cards** | name, aliases, age, appearance_tags, personality_traits (JSON array), core_motivations, relationships (JSON graph), speech_patterns, taboos, canonical_arc_summary | Ensures zero character drift across generations |
| **World-Building Bible** | universe_name, geography, magic_system / technology_level, factions, timeline_events, cultural_customs, linguistic_notes | Prevents lore contradictions across different fan-fiction works |
| **Series Canon Lock** | key_plot_points (ordered), immutable_events, spoiler_restrictions | Agent knows what it cannot change or spoil |

- **Cross-work sharing**: Character cards and world bibles are tagged by series/genre and **shared across all novels in that universe**
- **User-managed**: Full CRUD UI for creating, editing, linking, and versioning character/world entries
- **Pre-generation check**: Agent automatically queries relevant structured lore based on user-selected tags and brief keywords

#### B. Vector RAG Storage ("Fuzzy Inspiration" — style & reference)

Stored in pgvector (same PostgreSQL instance). Used for style mimicry and contextual inspiration.

| Source | Chunking Strategy | Retrieval Purpose |
|--------|-------------------|---------------------|
| User-uploaded parallel corpus (source + translation) | Paragraph-level, 500-token overlap | Translation style matching, terminology consistency |
| User-uploaded reference novels (same series/genre) | Scene-level chunks (2-3 paragraphs) | Style imitation, plot rhythm reference, genre tropes |
| User's own past fan-fiction | Chapter-level | Personal voice consistency |
| **User-fed reference documents** (raw text, world-building docs, character sheets) | Configurable chunk size | Custom domain knowledge injection |

- **Scale expectation**: Hundreds to low-thousands of documents — well within pgvector's comfort zone
- **Retrieval strategy**: Hybrid search — **pgvector semantic similarity + PostgreSQL full-text search (tsvector)** combined with reranking for maximum relevance
- **Enhancement mechanism**: The more source+translation pairs the user feeds in, the better the translation quality and terminology consistency become

**High-Utilization RAG Pipeline**:

1. **Hybrid Retrieval**: For each query, simultaneously execute:
   - **Vector search** (`embedding <=> query_embedding`): captures semantic meaning, effective for long descriptive queries
   - **Full-text search** (`tsvector @@ plainto_tsquery`): captures exact keyword matches, critical for proper nouns, character names, and terminology
   - **Fuzzy translation memory lookup**: embeds the source text segment and searches `translation_memory` for the closest match by vector similarity, returning the user's preferred translation as a few-shot example
   - Results merged and **reranked** by a simple BM25-inspired scoring function

2. **Query Expansion**: User briefs/queries are automatically expanded with series-specific keywords (character names, place names) from the structured lore before retrieval, improving recall

3. **Translation Memory Fuzzy Match**: During translation, each source paragraph is embedded and matched against `translation_memory.source_text` via vector similarity. The closest match's `translated_text` is injected as a few-shot example, ensuring terminology consistency even without exact string matches

4. **Scope-aware Filtering**: All RAG queries are filtered by active series/material tags, preventing irrelevant content from contaminating results

#### C. RAG Material Feeding Pipeline (User-Driven Indexing)

Users have **dedicated UI entry points** to actively feed materials into the RAG vector store for retrieval augmentation:

| Feed Type | Input Method | Processing |
|-----------|-------------|------------|
| **Parallel Corpus** (source + translation pair) | **Dual-file upload** (source + translation files separately) or paste text with delimiter | Auto-align paragraphs → store aligned pairs in `translation_memory` (with pre-computed source embeddings) + index source in `vector_chunks` |
| **Reference Novel** | Upload txt/docx/pdf | Parse → chunk → embed → store in `vector_chunks` with series/genre tags |
| **Raw Knowledge Document** (world-building notes, character sheets, timeline) | Upload or paste text | Chunk → embed → store as `sourceType: "knowledge_doc"` |
| **URL/Web Page** (optional advanced) | Paste URL | Fetch → extract text → chunk → embed |

**Dual-File Upload Workflow** (核心功能):
1. 用户在素材池选择 "平行语料" 类型
2. 系统显示**两个上传区域**："上传原文" + "上传译文"
3. 用户分别上传原文文件(txt/docx/pdf)和译文文件(txt/docx/pdf)
4. 后端分别解析两个文件 → 各得段落数组 `sourceParagraphs[]` 和 `translatedParagraphs[]`
5. **自动对齐**：按顺序 1:1 配对（第1段原文↔第1段译文），段落数量不一致时标记缺口
6. 用户在界面上**预览对齐结果**，可拖拽调整段落对应关系
7. 确认后 → 逐对存入 `translation_memory`（预计算 sourceText embedding）
8. 对齐后的原文同时索引到 `vector_chunks`

**Single-File Upload Fallback**:
- 如果用户只有一个对照文件（已用 `===` 分隔原文译文），走原有的 `parseParallelCorpus()` 逻辑

- **Feeding UI**: A dedicated "Material Pool" (素材池) page accessible from both Web and mobile (mobile: simplified view)
- **Per-material metadata**: User can tag each fed document with series, genre, and a custom label
- **Search scope control**: When generating or translating, user can select which fed materials to include in RAG retrieval (e.g., "只使用《斗破苍穹》系列的参考素材")
- **Visibility**: Fed materials appear in the Material Pool with their indexing status (pending / indexed / failed)
- **Deletion**: User can remove fed materials from the vector store at any time

This pipeline is the primary way the RAG knowledge base grows — the more high-quality, domain-specific material the user feeds, the better the AI's translation and generation become.

### 2.5 Content Management & Classification

- **User-defined tag system**: Free-form hierarchical tags (e.g., `Genre/Fantasy/Xianxia`, `Status/In-Progress`, `Series/Brandon-Sanderson/Cosmere`)
- **Series/Collection grouping**: Novels can be grouped into series; structured lore attaches at series level
- **Smart classification**: Agent auto-suggests tags based on content analysis; user confirms or overrides
- **Template/Memory selection**: Before generation, user selects which series' structured lore + vector memory to load. Agent only uses activated memories.
- **Search & filter**: Full-text search across titles, tags, character names, and content; faceted filtering

---

## 3. Technical Stack (Frozen)

### Frontend

| Platform | Technology | Version |
|----------|-----------|---------|
| Desktop Web | React + TypeScript + Vite + Tailwind CSS + shadcn/ui | React 19, Tailwind 3.4 |
| Mobile App | Flutter | 3.x |

### Backend

| Layer | Technology | Purpose |
|-------|-----------|---------|
| API Framework | Fastify (Node.js) | High-throughput HTTP API |
| Type Safety | tRPC + Zod | End-to-end type safety |
| ORM | Drizzle ORM | Type-safe SQL queries |
| Database | PostgreSQL 16 + pgvector | Relational data + vector search in one engine |
| Task Queue | BullMQ (Redis) | Async translation/generation jobs |
| Real-time | Socket.io | Generation progress streaming |
| AI Orchestration | LangChain.js | RAG pipelines, prompt management, tool calling |
| LLM Provider | DeepSeek V4 (official API) | Translation + generation |
| File Parsing | pdf-parse + mammoth + custom segmenter | Document ingestion |
| Storage | Local filesystem (volume-mounted) | Raw uploaded files |
| Auth | Simple JWT (single hardcoded user) | Minimal auth for single-user setup |

### DevOps

| Component | Technology |
|-----------|-----------|
| Containerization | Docker + Docker Compose |
| Deployment | Alibaba Cloud ECS (single instance) |
| Reverse Proxy | Nginx |
| SSL | Let's Encrypt |

---

## 4. Data Architecture

### Database Schema (Key Tables)

```
users (1 record only)
novels (title, author, status, metadata, file_path)
  → novel_tags (M:N join)
tags (name, parent_id, color, icon) -- user-defined hierarchical
chapters (novel_id, chapter_number, title, content_original, content_translated)
character_cards (series_id, name, aliases, personality, relationships, speech_patterns, taboos, ...)
world_bibles (series_id, universe_name, geography, magic_system, factions, timeline, ...)
series_canon (series_id, event_order, description, is_immutable, ...)
vector_chunks (content, embedding, source_type, novel_id, metadata) -- pgvector
translation_memory (source_text, translated_text, **embedding** [pgvector 1536], novel_id, **series_id**, frequency) -- parallel corpus with pre-computed embedding for fuzzy match
fan_fiction_works (parent_novel_id, brief, parameters, generated_content, status)
generation_jobs (job_id, type, status, progress, result, error_log)
```

### Memory Activation Flow (Generation-Time)

1. User selects target series/collection → loads active `series_id`
2. Agent queries structured lore: `SELECT * FROM character_cards WHERE series_id = ?` + `world_bibles` + `series_canon`
3. Agent constructs enriched system prompt with lore injection
4. RAG retrieval: vector search over user's uploaded reference novels (filtered by series/genre tags) → top-5 relevant chunks appended as few-shot examples
5. User's creative brief + control parameters appended
6. DeepSeek V4 generates → streamed to client via Socket.io
7. Post-generation: user edits, locks paragraphs, regenerates unlocked sections

---

## 5. User Flow Summary

### Translation Flow
1. User uploads foreign novel (txt/docx/pdf) → backend parses into chapters
2. User optionally uploads existing translation (parallel corpus) → stored in `translation_memory`
3. User selects DeepSeek V4 translation parameters (style: literal/fluent/literary)
4. Translation job queued → progress streamed → result saved as `chapters.content_translated`
5. User reads in e-book reader, toggling original/translated

### Fan-Fiction Generation Flow
1. User navigates to "Create" → selects series (activates structured lore + RAG memory)
2. User writes creative brief (plot outline, scene description, characters involved)
3. User adjusts fine-grained parameters (creativity, style fidelity, character loyalty, tone, length, canon strictness)
4. System auto-queries character cards + world bible + RAG references → injects into prompt
5. Generation begins → real-time paragraph streaming
6. User reviews: edits inline, locks approved paragraphs, regenerates specific sections with modified brief
7. Final work saved to `fan_fiction_works` with full version history

### Lore Management Flow
1. User creates/organizes series → defines character cards, world bibles, canon events
2. User uploads source novels + translations to build RAG corpus
3. Content auto-classified into series with tag suggestions
4. All future generation for that series automatically loads activated memories

---

## 6. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| **Privacy** | Strictly private — single-user, no data leaves Alibaba Cloud except DeepSeek API calls (text only, no metadata) |
| **Availability** | Personal use — best-effort, single ECS instance |
| **Scale** | Supports library of ~1,000 novels, ~10,000 chapters, ~500 character cards comfortably |
| **Translation latency** | ~1-2 minutes per 50-page chapter (DeepSeek V4 dependent) |
| **Generation latency** | ~30-90 seconds for a standard chapter scene |
| **Offline mobile** | Last 10 read novels cached locally on mobile device |

---

## 7. Explicitly Out of Scope (Frozen Boundaries)

- Multi-user support / social features / sharing / publishing
- Native mobile generation (desktop-only for fan-fiction creation)
- Real-time collaborative editing
- Payment/subscription system
- Built-in e-book store or content marketplace
- Support for formats other than txt/docx/pdf
- Audio/TTS features
- Mobile text editing for fan-fiction (read-only on mobile; full edit on desktop web)

---

## 8. Success Criteria

1. **Translation Quality**: After feeding 3-5 source+translation pairs of a series, subsequent translations demonstrate consistent terminology and style matching user's preference
2. **Lore Compliance**: With character cards and world bibles populated, generated fan-fiction has <5% lore/character inconsistency rate (user-judged)
3. **Mobile Reading Experience**: Reader app achieves <200ms chapter switch time, supports all annotation features offline
4. **Generation Control**: All 6 fine-grained parameters produce visibly distinct outputs when adjusted
5. **Cross-Work Memory**: Characters and settings defined in Series A are automatically available when creating fan-fiction for any novel tagged under Series A

---

*This document is frozen. All subsequent design, development, and prompt engineering must strictly adhere to the goals, boundaries, and technical decisions defined herein.*
