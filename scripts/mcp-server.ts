#!/usr/bin/env node
/**
 * NovelForge MCP Server — 轻量级 stdio 传输实现
 *
 * 让 Claude Desktop 等 MCP Client 原生操控 NovelForge。
 * 零外部依赖，纯 Node.js 标准库实现 MCP 2024-11-05 协议子集。
 *
 * 配置方式（Claude Desktop）：
 * 1. 编辑 ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
 *    或 %APPDATA%\Claude\claude_desktop_config.json (Windows)
 * 2. 添加：
 *    {
 *      "mcpServers": {
 *        "novelforge": {
 *          "command": "node",
 *          "args": ["E:\\绝对路径\\scripts\\mcp-server.ts"],
 *          "env": {
 *            "NOVELFORGE_URL": "http://localhost/api/trpc"
 *          }
 *        }
 *      }
 *    }
 */

const BASE_URL = process.env.NOVELFORGE_URL || "http://localhost/api/trpc"

// ========== MCP Tools 定义 ==========

const TOOLS = [
  {
    name: "get_status",
    description:
      "获取 NovelForge 系统状态概览，包括系列数、角色数、素材数、作品数、向量块数等统计信息。",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "list_series",
    description: "列出 NovelForge 中所有系列/世界观组。",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "describe_series",
    description:
      "获取指定系列的完整详情，包括角色卡、世界观圣经、正史事件、素材列表、桥段库和最近作品。这是了解一个系列设定的首选工具。",
    inputSchema: {
      type: "object" as const,
      properties: {
        seriesId: {
          type: "number" as const,
          description: "系列 ID（可通过 list_series 获取）",
        },
      },
      required: ["seriesId"],
    },
  },
  {
    name: "search_rag",
    description:
      "RAG 语义搜索。在向量数据库中查找与查询语义相似的素材片段，使用向量+全文+trgm 混合检索。",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string" as const,
          description: "搜索关键词或描述",
        },
        seriesId: {
          type: "number" as const,
          description: "限定搜索范围到某个系列（可选）",
        },
        limit: {
          type: "number" as const,
          description: "返回条数，默认 5，最大 10",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_materials",
    description: "列出素材池中的素材，可按系列和类型筛选。",
    inputSchema: {
      type: "object" as const,
      properties: {
        seriesId: {
          type: "number" as const,
          description: "系列 ID（可选）",
        },
        sourceType: {
          type: "string" as const,
          description: "素材类型过滤，如 style_sample、reference 等（可选）",
        },
        limit: {
          type: "number" as const,
          description: "返回条数，默认 50",
        },
      },
    },
  },
  {
    name: "list_works",
    description: "列出二创作品，可按系列筛选。",
    inputSchema: {
      type: "object" as const,
      properties: {
        seriesId: {
          type: "number" as const,
          description: "系列 ID（可选）",
        },
        limit: {
          type: "number" as const,
          description: "返回条数，默认 20",
        },
      },
    },
  },
  {
    name: "get_work",
    description: "获取指定二创作品的完整内容和生成参数。",
    inputSchema: {
      type: "object" as const,
      properties: {
        workId: {
          type: "number" as const,
          description: "作品 ID",
        },
      },
      required: ["workId"],
    },
  },
  {
    name: "generate_fanfiction",
    description:
      "生成二创小说。需要提供创作要求（brief）和系列ID。系统会自动选择合适的角色、世界观和RAG素材。",
    inputSchema: {
      type: "object" as const,
      properties: {
        seriesId: {
          type: "number" as const,
          description: "系列 ID",
        },
        brief: {
          type: "string" as const,
          description: "创作要求描述，例如：写一个萧炎在魔兽山脉的冒险场景",
        },
        writingMode: {
          type: "string" as const,
          enum: [
            "canon_continuation",
            "character_spinoff",
            "original_in_universe",
            "alternate_universe",
          ],
          description: "创作模式：正史续写/角色外传/同世界观原创/AU",
        },
        styleFidelity: {
          type: "number" as const,
          description: "风格忠实度 1-10，默认 7",
        },
        characterLoyalty: {
          type: "number" as const,
          description: "角色忠诚度 1-10，默认 8",
        },
        lengthTarget: {
          type: "string" as const,
          enum: ["short", "chapter", "arc"],
          description: "长度目标：短场景/完整一章/多章大纲，默认 chapter",
        },
        parentNovelId: {
          type: "number" as const,
          description: "关联小说 ID（用于翻译记忆风格参考，可选）",
        },
        selectedCharacterIds: {
          type: "array" as const,
          items: { type: "number" as const },
          description: "指定参演角色 ID 列表（可选，不指定则使用系列全部角色）",
        },
      },
      required: ["seriesId", "brief"],
    },
  },
  {
    name: "save_style_sample",
    description:
      "将文字保存为风格样本，自动索引到 RAG 库。风格样本是飞轮的关键：用户认可的生成内容保存为样本后，会被 RAG 检索到，反哺后续生成。",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string" as const,
          description: "要保存的文本内容（至少 10 字）",
        },
        seriesId: {
          type: "number" as const,
          description: "系列 ID",
        },
        characterTag: {
          type: "string" as const,
          description: "角色标签，如"萧炎"（可选）",
        },
        sceneTag: {
          type: "string" as const,
          description: "场景标签：战斗描写/对话/心理活动/环境描写（可选）",
        },
      },
      required: ["content", "seriesId"],
    },
  },
  {
    name: "submit_feedback",
    description: "为某次生成提交 RAG 反馈（👍/👎），用于优化检索质量。",
    inputSchema: {
      type: "object" as const,
      properties: {
        generationId: {
          type: "number" as const,
          description: "生成记录 ID（fanFictionWorks.id）",
        },
        wasHelpful: {
          type: "boolean" as const,
          description: "是否满意",
        },
        reason: {
          type: "string" as const,
          description: "不满意原因：OOC/风格不像/世界观矛盾/其他（可选）",
        },
      },
      required: ["generationId", "wasHelpful"],
    },
  },
  {
    name: "extract_style",
    description:
      "为角色提炼语言风格画像（需该角色已有 ≥3 条风格样本）。提炼结果会更新到角色卡的 speechPatterns，反哺后续生成。",
    inputSchema: {
      type: "object" as const,
      properties: {
        seriesId: {
          type: "number" as const,
          description: "系列 ID",
        },
        characterName: {
          type: "string" as const,
          description: "角色名称",
        },
      },
      required: ["seriesId", "characterName"],
    },
  },
]

// ========== tRPC HTTP 调用封装 ==========

async function callTrpc(
  path: string,
  input: unknown,
  method: "query" | "mutation" = "query",
): Promise<unknown> {
  const url = `${BASE_URL}/${path}`
  let res: Response

  if (method === "query") {
    const params = new URLSearchParams({
      input: JSON.stringify({ json: input }),
    })
    res = await fetch(`${url}?${params}`)
  } else {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: input }),
    })
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`tRPC error ${res.status}: ${text}`)
  }

  const data = (await res.json()) as {
    result?: { data?: unknown }
    error?: { message?: string }
  }

  if (data.error) {
    throw new Error(data.error.message || "tRPC unknown error")
  }

  return data.result?.data
}

// ========== Tool 路由 ==========

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown

  switch (name) {
    case "get_status":
      result = await callTrpc("agent.status", {})
      break
    case "list_series":
      result = await callTrpc("lore.series.list", {})
      break
    case "describe_series":
      result = await callTrpc("agent.describeSeries", {
        seriesId: args.seriesId,
      })
      break
    case "search_rag":
      result = await callTrpc("agent.searchRag", {
        query: args.query,
        seriesId: args.seriesId,
        limit: args.limit || 5,
      })
      break
    case "list_materials":
      result = await callTrpc("agent.listMaterials", {
        seriesId: args.seriesId,
        sourceType: args.sourceType,
        limit: args.limit || 50,
      })
      break
    case "list_works":
      result = await callTrpc("agent.listWorks", {
        seriesId: args.seriesId,
        limit: args.limit || 20,
      })
      break
    case "get_work":
      result = await callTrpc("agent.getWork", {
        workId: args.workId,
      })
      break
    case "generate_fanfiction":
      result = await callTrpc(
        "generate.fanfiction",
        {
          seriesId: args.seriesId,
          brief: args.brief,
          parameters: {
            temperature: 0.8,
            styleFidelity: args.styleFidelity ?? 7,
            characterLoyalty: args.characterLoyalty ?? 8,
            tone: "dramatic",
            lengthTarget: args.lengthTarget || "chapter",
            canonConstraint: "strict",
            writingMode: args.writingMode || "canon_continuation",
            ragLimit: 5,
          },
          parentNovelId: args.parentNovelId,
          useMaterials: true,
          selectedCharacterIds: args.selectedCharacterIds,
        },
        "mutation",
      )
      break
    case "save_style_sample":
      result = await callTrpc(
        "agent.saveStyleSample",
        {
          content: args.content,
          seriesId: args.seriesId,
          characterTag: args.characterTag,
          sceneTag: args.sceneTag,
        },
        "mutation",
      )
      break
    case "submit_feedback":
      result = await callTrpc(
        "agent.submitFeedback",
        {
          generationId: args.generationId,
          wasHelpful: args.wasHelpful,
          reason: args.reason,
        },
        "mutation",
      )
      break
    case "extract_style":
      result = await callTrpc(
        "agent.extractStyle",
        {
          seriesId: args.seriesId,
          characterName: args.characterName,
        },
        "mutation",
      )
      break
    default:
      throw new Error(`Unknown tool: ${name}`)
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  }
}

// ========== MCP Protocol 处理 ==========

const { createInterface } = require("readline")

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
})

async function handleRequest(raw: string): Promise<object | null> {
  let msg: { id?: number; method: string; params?: Record<string, unknown> }
  try {
    msg = JSON.parse(raw)
  } catch {
    return null
  }

  const { id, method, params = {} } = msg

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: {
            name: "novelforge-mcp",
            version: "1.0.0",
          },
        },
      }

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      }

    case "tools/call": {
      const toolName = String(params.name || "")
      const toolArgs = (params.arguments || {}) as Record<
        string,
        unknown
      >
      try {
        const result = await handleToolCall(toolName, toolArgs)
        return {
          jsonrpc: "2.0",
          id,
          result,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message },
        }
      }
    }

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      }
  }
}

// ========== Main Loop ==========

rl.on("line", async (line: string) => {
  const trimmed = line.trim()
  if (!trimmed) return
  const response = await handleRequest(trimmed)
  if (response) {
    console.log(JSON.stringify(response))
  }
})

// 启动信号
console.error(`[NovelForge MCP] Started. BASE_URL=${BASE_URL}`)
