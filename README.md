# NovelForge

AI 驱动的长篇小说翻译与二创平台。支持上传原文、AI 翻译（注入世界观设定与角色设定）、双语阅读、素材库 RAG 检索、以及 AI 辅助二创生成。

> **单用户桌面 Web 应用** | 暗黑主题 | Docker 一键部署

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-green.svg)

---

## 功能概览

| 模块 | 功能 |
|------|------|
| 📚 **小说管理** | 上传 EPUB/PDF/DOCX，自动解析章节，AI 逐章翻译 |
| 🌐 **双语阅读器** | 原文/译文对照阅读，段落级对齐，书签与批注 |
| 🧠 **设定库** | 系列世界观、角色卡、正史记事，翻译时自动注入 |
| 🔍 **素材池 RAG** | 上传参考材料，向量检索辅助翻译与二创 |
| ✨ **二创工坊** | 基于世界观生成番外、IF 线、角色短篇 |
| 🎨 **风格系统** | 自动提取译文风格指纹，保持全文风格一致 |

---

## 快速开始（5 分钟）

### 前置要求

- [Docker Desktop](https://docs.docker.com/get-docker/)（Windows / macOS / Linux）
- DeepSeek API Key（[免费获取](https://platform.deepseek.com/api_keys)）
- Embedding API Key（推荐 [阿里云百炼](https://dashscope.console.aliyun.com/apiKey)，新用户有免费额度）

### 步骤

```bash
# 1. 克隆仓库
git clone https://github.com/AoiArashi50/NovelForge.git
cd NovelForge

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填写你的 API Key

# 3. 一键启动（Windows 双击 start.bat，Linux/macOS 运行 ./start.sh）
docker compose -f docker-compose.simple.yml up -d

# 4. 打开浏览器访问
open http://localhost:3000
```

### Windows 用户

直接双击项目根目录的 **`start.bat`**，脚本会自动检查环境并启动。

### Linux / macOS 用户

```bash
chmod +x start.sh
./start.sh
```

---

## 环境变量配置

复制 `.env.example` 为 `.env`，填写以下必填项：

```env
# DeepSeek API（用于翻译与二创）
DEEPSEEK_API_KEY=sk-your-deepseek-key-here

# Embedding API（用于向量检索）
# 推荐阿里云百炼（国内速度快）：https://dashscope.console.aliyun.com/apiKey
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EMBEDDING_API_KEY=sk-your-dashscope-key-here
EMBEDDING_MODEL=text-embedding-v4

# 数据库密码（自定义任意密码）
DB_PASSWORD=your_secure_password
```

### API Key 获取指南

| 服务 | 地址 | 费用 |
|------|------|------|
| DeepSeek | https://platform.deepseek.com/api_keys | 按量付费，新用户有赠送额度 |
| 阿里云百炼 | https://dashscope.console.aliyun.com/apiKey | embedding 有免费额度 |
| SiliconFlow | https://cloud.siliconflow.cn/ | 备选方案 |

---

## 技术栈

### 前端
- React 19 + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- tRPC + React Query
- Three.js（首页背景）
- Framer Motion + Lenis

### 后端
- Hono + tRPC 11
- Drizzle ORM + PostgreSQL + pgvector
- DeepSeek API（大模型）
- DashScope（向量嵌入）

### 部署
- Docker + Docker Compose
- Nginx（生产环境，见 docker-compose.yml）

---

## 项目结构

```
├── api/                        # Hono + tRPC 后端
│   ├── routers/                # tRPC 路由（novel, translate, lore, rag...）
│   └── services/               # DeepSeek 调用、Embedding、Parser
├── src/                        # React 前端
│   ├── pages/                  # Studio, Reader, LoreLibrary, NovelManager...
│   └── components/             # 通用组件
├── db/                         # Drizzle 数据库 schema + 迁移
├── contracts/                  # Zod 共享校验 schema
├── docs/                       # 项目文档
│   ├── ROADMAP.md              # 开发路线图
│   ├── ProjectGoal.md          # 产品目标（最高权威设计文档）
│   ├── prompt/                 # 设计阶段 prompt 文档
│   └── GUIDE.md                # 使用指南
├── scripts/                    # 辅助脚本
├── .github/workflows/          # GitHub Actions CI/CD
├── docker-compose.simple.yml   # 本地一键启动（推荐）
├── docker-compose.yml          # 生产部署（含 nginx + SSL）
├── Dockerfile
├── start.sh / start.bat        # 一键启动脚本
└── README.md
```

---

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器（端口 3000，前端热更新 + API 热重载）
npm run dev

# 类型检查
npm run check

# 数据库 schema 推送（需要本地 PostgreSQL）
npm run db:push

# 构建生产包
npm run build
```

---

## 常见问题

**Q: 启动后访问 localhost:3000 显示空白？**
A: 首次启动需要等待数据库初始化（约 10-30 秒）。查看日志：`docker compose -f docker-compose.simple.yml logs -f`

**Q: 翻译时提示 API 错误？**
A: 检查 `.env` 中的 `DEEPSEEK_API_KEY` 是否有效，以及账户余额是否充足。

**Q: 如何备份数据？**
A: 数据库数据保存在 Docker Volume `pgdata` 中。备份命令：
`docker exec novelforge-db-1 pg_dump -U novelforge novelforge > backup.sql`

---

## 分支策略

| 分支 | 用途 |
|------|------|
| `master` | 稳定版本，随时可部署 |
| `dev` | 日常开发，功能合并后定期合并到 master |

新功能请从 `dev` 切出 feature 分支：

```bash
git checkout dev
git checkout -b feat/your-feature
```

---

## License

MIT
