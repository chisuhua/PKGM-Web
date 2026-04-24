---
load_skills: ['pkgm-web-environment']
---

# PKGM-Web Agent Instructions

## 项目概述

PKGM-Web 是 PKGM（Personal Knowledge Graph Manager）系统的**展示层**，负责渲染 AI Agent 生成的 Markdown 文档、提供全文搜索、实时推送更新。

## 三项目架构

```
PKGM-Web/                    # 展示层（当前项目）
├── web/                    # Next.js 前端 (port 3001)
├── indexer/                # Node.js 索引服务 (port 3004)
├── docker-compose.yml      # 容器编排
├── PKGM-Manager -> ../PKGM # 链接到 PKGM-Manager（管理平面）
└── PKGM-Wiki -> ../PKGM-Wiki  # 链接到 PKGM-Wiki（业务逻辑层）
```

| 项目 | 职责 | 定位 |
|------|------|------|
| **PKGM-Manager** | 多租户管理（创建/删除用户 Agent） | 管理平面 |
| **PKGM-Wiki** | 多租户内容生成技能（知识管线） | 业务逻辑层 |
| **PKGM-Web** | 前端展示页面（渲染/搜索/SSE） | 展示平面 |

## 关键原则

**文件系统是唯一数据源，SQLite 只是索引缓存。** 任何时刻可通过删除 `index.db` 并重启 Indexer 从文件重新生成索引。

## 目录结构

```
PKGM-Web/
├── web/                    # Next.js 前端 (port 3001)
│   ├── src/app/           # App Router 页面
│   │   ├── page.tsx      # 根页面（用户列表）
│   │   ├── docs/[user]/  # 用户文档页
│   │   └── api/          # API Routes
│   └── src/lib/          # 工具库
├── indexer/              # Node.js 索引服务 (port 3004)
│   └── index.js          # 单实例多用户扫描
├── docker-compose.yml    # 容器编排
├── PKGM-Manager -> ../PKGM  # 链接到管理平面
└── PKGM-Wiki -> ../PKGM-Wiki  # 链接到业务逻辑层
```

### 跨项目开发

在 PKGM-Web 项目目录下可直接访问其他两个项目：

```bash
# 查看 PKGM-Manager 文档
cat PKGM-Manager/docs/ARCHITECTURE.md

# 查看 PKGM-Wiki 文档
cat PKGM-Wiki/docs/ARCHITECTURE.md

# 访问 PKGM 总览
cat PKGM-Manager/docs/SYSTEM-ARCHITECTURE-OVERVIEW.md
```

## 开发命令

### Web (Next.js)
```bash
cd web
npm run dev      # 开发服务器 (localhost:3000)
npm run build    # 生产构建
npm run lint     # ESLint 检查
```

### Indexer
```bash
cd indexer
node index.js    # 直接运行（需要设置环境变量）
# 或通过 Docker: docker compose up -d pkgm-indexer
```

## 环境变量

### Web (.env)
```
PKGM_USERS_DIR=/workspace/project/PKGM/users
JWT_SECRET=<生成的安全密钥>
INDEXER_HOST=pkgm-indexer
INDEXER_PORT=3004
PORT=3001
INDEXER_SECRET=<Indexer 回调密钥>
```

### Indexer
```
PKGM_USERS_DIR=/workspace/project/PKGM/users
WEB_HOST=pkgm-web
WEB_PORT=3001
INDEXER_PORT=3004
INDEXER_SECRET=<与 Web 一致的密钥>
```

## 认证系统

### 认证模型
- **Token 存储**: httpOnly Cookie (`pkgm-token`)
- **有效期**: 24 小时
- **验证方式**: Next.js Middleware + JWT

### 公开路径
| 路径 | 说明 |
|------|------|
| `/login` | 登录页 |
| `/api/login` | 登录 API |
| `/api/logout` | 登出 API |
| `/_next/*` | 静态资源 |
| `/favicon.ico` | 图标 |

### 需要认证的路径
所有其他路径都需要有效的 JWT token。

### 安全机制
- **多租户隔离**: 用户只能访问自己的文档
- **POST /api/events**: 需要 `x-indexer-secret` header（Indexer's call）
- **GET /api/events**: 需要有效的 JWT token（browser's SSE）

## 用户数据目录结构

每个用户独立目录：
```
/workspace/project/PKGM/users/{username}/
├── content/              # Markdown 文件
│   ├── daily/           # 日报 (YYYY-MM-DD-[主题].md)
│   ├── uploads/         # 用户上传
│   └── tasks/          # 任务文档
├── assets/              # 图片/附件
└── meta/
    └── index.db         # SQLite + FTS5（WAL 模式）
```

## Frontmatter 规范

```yaml
---
title: "文档标题"
type: "daily"           # daily | upload | task
tags: ["标签1", "标签2"]
status: "completed"     # writing | completed
source: "cron"          # cron | user-upload | explore-task
created: "2026-04-15T08:00:00Z"
---
```

**状态机**：
- `writing` → Indexer 跳过（流式生成中，可能不完整）
- `completed` → 索引
- 缺失 → 索引（向后兼容）

## Indexer API 端点

Indexer HTTP API (port 3004)：
- `GET /users` → 返回用户名列表
- `GET /docs/:username` → 返回该用户文档列表
- `GET /doc/:username?path=...` → 返回单篇文档
- `GET /search/:username?q=...` → FTS5 搜索

## 重要约束

### SQLite WAL 模式（NFS 兼容）
```javascript
PRAGMA journal_mode = DELETE;  // NFS 必须用 DELETE，避免 .wal/.shm 文件问题
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

### 防抖配置
- 批量写入延迟：200ms
- 文件稳定等待：300ms (stabilityThreshold)
- 轮询间隔：100ms

### Docker 部署
- Web: `docker compose up -d pkgm-web` (只读挂载用户目录)
- Indexer: `docker compose up -d pkgm-indexer` (读写挂载用户目录)

### 索引重建
```bash
rm -f /workspace/project/PKGM/users/{username}/meta/index.db*
docker compose restart pkgm-indexer  # 自动全量扫描
```

## 常见问题

1. **Indexer 内存限制**：Docker 限制 256MB，NFS 写性能影响批处理
2. **SSE 多实例**：当前使用内存存储，Docker 多实例部署需改用 Redis Pub/Sub
3. **better-sqlite3 编译**：Web Docker 构建时已完成，无需本地编译
