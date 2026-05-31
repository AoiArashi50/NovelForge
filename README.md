# NovelForge

AI 驱动的小说翻译与二创生成平台。支持小说上传、AI 翻译、RAG 素材投喂、设定库管理、以及基于世界观和桥段的智能二创生成。

## 技术栈

- **前端**: React 19 + TypeScript + Vite + Tailwind CSS + tRPC Client
- **后端**: Hono + tRPC 11 + Drizzle ORM + PostgreSQL 16 + pgvector
- **AI**: DeepSeek V4 Pro API
- **部署**: Docker Compose + Nginx

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY 等必要变量

# 3. 启动开发服务
npm run dev

# 4. 推送数据库 schema（需要 db 容器运行）
npm run db:push
```

## Docker 部署

```bash
# 生产环境构建并启动
docker compose down && docker compose up -d --build
```

服务映射：
- App: `http://localhost:8081`
- Nginx: `http://localhost:80`
- PostgreSQL: `localhost:15432`

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器（Vite + Hono） |
| `npm run check` | TypeScript 类型检查 |
| `npm run build` | 生产构建 |
| `npm run db:push` | 推送 schema 到数据库 |
| `npm run db:studio` | 启动 Drizzle Studio |

## 目录结构

```
├── api/              # Hono + tRPC 后端
├── src/              # React 前端
├── db/               # Drizzle schema + migrations
├── contracts/        # 共享 Zod schemas
├── propmt/           # 设计文档
├── docker-compose.yml
├── nginx.conf
└── Dockerfile
```

## 核心功能

- **小说管理**: 上传、阅读、翻译
- **翻译工作台**: AI 翻译 + 翻译记忆 + RAG 风格参考
- **设定库**: 世界观、角色卡、正史、桥段
- **二创工作台**: 基于设定库的 AI 小说生成
- **素材池**: RAG 素材投喂与索引
