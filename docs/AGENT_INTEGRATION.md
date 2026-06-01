# NovelForge Agent 集成方案

> **目标**：让外部 AI Agent（Claude Desktop、Claude Code、其他 MCP Client）能够操控 NovelForge，查询状态、检索素材、生成内容、保存反馈。

---

## 一、架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 外部 Agent（Claude Desktop / Claude Code / 其他 MCP Client）                │
│                                                                             │
│  Claude Desktop ──MCP stdio──┐                                              │
│                              │                                              │
│  Claude Code ────HTTP/tRPC───┼──→ NovelForge API                           │
│                              │                                              │
│  其他 Agent ─────HTTP/tRPC───┘                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ NovelForge 后端                                                             │
│                                                                             │
│  /api/trpc/agent.*      ← Agent Proxy 层（信息聚合 + 简单操作）              │
│  /api/trpc/generate.*   ← 核心创作（生成、续写、重写）                       │
│  /api/trpc/lore.*       ← 设定库（系列、角色、世界观）                       │
│  /api/trpc/material.*   ← 素材池（上传、索引、提取）                         │
│  /api/trpc/rag.*        ← RAG 检索与反馈                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、集成方式（三种可选）

### 方式 A：直接 HTTP/tRPC 调用（最通用）

任何支持 HTTP 的 Agent 都可以直接调用 NovelForge 的 tRPC API。

tRPC v11 的 HTTP 格式：
- **Query**：`GET /api/trpc/{path}?input={encodeURIComponent(JSON.stringify({json: input}))}`
- **Mutation**：`POST /api/trpc/{path}` with body `{ json: input }`
- **响应**：`{ result: { data: ... } }`

**示例：获取系统状态**
```bash
curl "http://localhost/api/trpc/agent.status?input=%7B%22json%22%3A%7B%7D%7D"
```

**示例：生成二创**
```bash
curl -X POST "http://localhost/api/trpc/generate.fanfiction" \
  -H "Content-Type: application/json" \
  -d '{"json":{"seriesId":1,"brief":"写一个萧炎在魔兽山脉的冒险场景","parameters":{"temperature":0.8,"styleFidelity":7,"characterLoyalty":8,"tone":"dramatic","lengthTarget":"chapter","canonConstraint":"strict","writingMode":"canon_continuation","ragLimit":5},"useMaterials":true}}'
```

**推荐入口点**：
| 接口 | 用途 |
|------|------|
| `agent.capabilities` | 发现所有可用能力 |
| `agent.status` | 系统状态概览 |
| `agent.describeSeries` | 系列完整详情（角色+世界观+素材+桥段） |
| `agent.searchRag` | RAG 语义搜索 |
| `agent.listWorks` | 二创作品列表 |
| `agent.listMaterials` | 素材列表 |

**核心创作接口**（直接调用，不走 agent 层）：
| 接口 | 用途 |
|------|------|
| `generate.fanfiction` | 生成二创 |
| `generate.continue` | 续写 |
| `generate.regenerate` | 重写段落 |
| `material.saveAsStyleSample` | 保存风格样本 |
| `rag.feedback` | 提交 RAG 反馈 |

---

### 方式 B：MCP Server（Claude Desktop 原生支持）

NovelForge 附带了一个**零依赖的轻量级 MCP Server**（`scripts/mcp-server.ts`），通过 stdio 与 Claude Desktop 通信。

**配置步骤**：

1. 编辑 Claude Desktop 配置文件：
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. 添加以下配置（替换为实际路径）：
```json
{
  "mcpServers": {
    "novelforge": {
      "command": "npx",
      "args": ["tsx", "E:\\绝对路径\\scripts\\mcp-server.ts"],
      "env": {
        "NOVELFORGE_URL": "http://localhost/api/trpc"
      }
    }
  }
}
```

3. 重启 Claude Desktop

4. 在对话中 Claude 会自动识别 NovelForge 的工具，你可以直接说：
   - "帮我看看 NovelForge 里有哪些系列"
   - "描述一下斗破苍穹系列的设定"
   - "搜索一下关于萧炎战斗风格的素材"
   - "生成一段萧炎和药老的对话"

**可用的 MCP Tools**：

| Tool | 描述 |
|------|------|
| `get_status` | 系统状态概览 |
| `list_series` | 列出所有系列 |
| `describe_series` | 系列完整详情 |
| `search_rag` | RAG 语义搜索 |
| `list_materials` | 素材列表 |
| `list_works` | 二创作品列表 |
| `get_work` | 获取作品内容 |
| `generate_fanfiction` | 生成二创 |
| `save_style_sample` | 保存风格样本 |
| `submit_feedback` | 提交 RAG 反馈 |
| `extract_style` | 提炼角色风格画像 |

---

### 方式 C：Claude Code / 本 CLI 直接操控

如果你正在使用 **Claude Code CLI**（即当前这个会话），可以直接调用 NovelForge 的 API：

```typescript
// 获取系统状态
const status = await trpc.agent.status.query()

// 描述系列
const series = await trpc.agent.describeSeries.query({ seriesId: 1 })

// RAG 搜索
const results = await trpc.agent.searchRag.query({ query: "萧炎战斗", seriesId: 1 })

// 生成二创
const work = await trpc.generate.fanfiction.mutate({
  seriesId: 1,
  brief: "写一个萧炎在魔兽山脉的冒险场景",
  parameters: { /* ... */ },
})
```

---

## 三、Agent 操控的典型工作流

### 工作流 1：探索 → 生成 → 保存 → 反馈

```
1. get_status          → 了解系统概况
2. list_series         → 选择目标系列
3. describe_series     → 深入了解设定（角色、世界观、桥段）
4. search_rag          → 检索相关素材
5. generate_fanfiction → 生成二创
6. save_style_sample   → 保存满意的段落为风格样本
7. submit_feedback     → 提交 👍/👎 反馈
```

### 工作流 2：风格飞轮强化

```
1. 多次 generate_fanfiction → 积累生成内容
2. save_style_sample       → 保存多条同角色的风格样本
3. extract_style           → 自动提炼角色语言风格画像
4. 再次 generate_fanfiction → 生成质量提升（speechPatterns 已更新）
```

### 工作流 3：素材库查漏补缺

```
1. describe_series → 查看素材列表
2. search_rag      → 测试检索效果
3. 如果检索质量差 → submit_feedback 👎
4. 补充新素材 → 重新索引 → 再次测试
```

---

## 四、数据返回格式说明

### agent.describeSeries 返回示例

```json
{
  "series": { "id": 1, "name": "斗破苍穹", "description": "..." },
  "summary": {
    "characterCount": 12,
    "materialCount": 7,
    "workCount": 3,
    "worldBibleExists": true,
    "canonEventCount": 8,
    "tropeCount": 6
  },
  "characters": [...],
  "worldBible": { "aspects": [...], "geography": "...", "magicSystem": "..." },
  "canonEvents": [...],
  "materials": [...],
  "tropes": [...],
  "recentWorks": [...],
  "suggestion": "该系列已有 12 个角色。你可以调用 generate.fanfiction（seriesId=1）生成二创..."
}
```

每个返回都包含 `suggestion` 字段，提示 Agent 下一步可以做什么。

---

## 五、约束与注意事项

1. **无认证**：所有 API 都是 public，Agent 可以直接调用
2. **单用户**：系统设计为单用户，Agent 操作等同于用户本人操作
3. **生成耗时**：`generate_fanfiction` 需要 10-60 秒（取决于内容长度和 DeepSeek API 响应速度），Claude Desktop 会等待结果
4. **风格样本积累**：`extract_style` 需要 ≥3 条同角色的风格样本才能执行
5. **向量检索**：`search_rag` 需要 Embedding API Key 配置正确（DashScope）

---

## 六、文件清单

| 文件 | 用途 |
|------|------|
| `api/routers/agent.ts` | Agent Proxy 路由（信息聚合 + 简单操作） |
| `scripts/mcp-server.ts` | 轻量级 MCP Server（stdio 传输） |
| `api/router.ts` | 注册 agent router |
| `docs/AGENT_INTEGRATION.md` | 本文档 |
