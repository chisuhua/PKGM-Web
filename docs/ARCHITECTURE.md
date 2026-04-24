# PKGM-Web 架构文档

**版本**: V2.0  
**创建日期**: 2026-04-22  
**最后更新**: 2026-04-22  
**状态**: 现行  

---

## 1. 项目概述与边界

### 1.1 定位

PKGM-Web 是 PKGM（Personal Knowledge Graph Manager）系统的**展示层**，负责：
- 渲染 AI Agent 生成的 Markdown 文档
- 提供全文搜索能力
- 实时推送文档更新（SSE）
- **多租户隔离**：每个用户独立目录 + 独立内容

### 1.2 与 PKGM 的关系

```
PKGM (知识处理)                    PKGM-Web (展示层)
┌─────────────────────┐            ┌─────────────────────┐
│ mynotes/             │   Markdown  │ /users/{user}/       │
│ 01_Wiki/             │ ──────────►│ content/             │
└─────────────────────┘            └─────────────────────┘
                                              │
                                     ┌─────────┴─────────┐
                                     │  chokidar 监控     │
                                     └─────────┬─────────┘
                                               ▼
                                     ┌─────────────────────┐
                                     │ SQLite + FTS5       │
                                     │ (Indexer)           │
                                     └─────────┬─────────┘
                                               ▼
                                     ┌─────────────────────┐
                                     │ Next.js 前端        │
                                     │ - Markdown 渲染     │
                                     │ - FTS5 搜索        │
                                     │ - SSE 实时更新     │
                                     └─────────────────────┘
```

**职责分工**：
| 项目 | 职责 | 不负责的领域 |
|------|------|-------------|
| **PKGM** | 知识摄入管线（Ingest → Extract → Link → WikiGen），生成结构化 Wiki 页面 | 用户管理、前端展示 |
| **PKGM-Web** | 将 Markdown 文档展示给用户，提供搜索和实时更新 | 内容生成逻辑、用户创建 |
| **PKGM-Manager** | 多租户管理（创建/删除用户 Agent） | 内容展示、索引服务 |

### 1.3 核心原则

> **文件系统是唯一数据源，SQLite 只是索引缓存。** 任何时刻可通过删除 `index.db` 并重启 Indexer 从文件重新生成索引。

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw 容器                               │
│  ┌─────────────┐     ┌─────────────┐                            │
│  │ PKGM Agent  │────►│ 原子写入     │                           │
│  └─────────────┘     └──────┬──────┘                           │
│                             │                                   │
└─────────────────────────────│───────────────────────────────────┘
                               │ /workspace/project/PKGM/users/{user}/content/
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     NAS 共享存储                                 │
│  /mnt/nas/project/PKGM/users/                                   │
│                             │                                   │
│         ┌───────────────────┴───────────────────┐              │
│         ▼                                       ▼              │
│  ┌─────────────┐                        ┌─────────────┐          │
│  │ pkgm-indexer │                        │  pkgm-web   │          │
│  │ (chokidar)   │                        │  (Next.js)  │          │
│  └──────┬──────┘                        └──────┬──────┘          │
│         │                                      │                 │
│         ▼                                      ▼                 │
│  ┌─────────────┐                        ┌─────────────┐          │
│  │ SQLite FTS5 │◄─────────────────────│   SSE       │          │
│  │ 索引服务     │     HTTP POST         │  实时推送   │          │
│  └─────────────┘   /api/events         └─────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| pkgm-web | 3001 | Next.js 前端 |
| pkgm-indexer | 3004 | 索引服务 HTTP API |

---

## 3. 核心模块设计

### 3.1 Indexer（索引服务）

**职责**：
- 监控用户 `content/` 目录（单实例多用户扫描）
- 解析 Markdown Frontmatter
- 中文分词（@node-rs/jieba）
- 写入 SQLite FTS5 索引
- 提供 HTTP API 给 Next.js
- 触发 SSE 推送

**防抖配置**：
| 配置项 | 值 | 说明 |
|--------|-----|------|
| 批量写入延迟 | 200ms | 文件变化后等待时间 |
| 文件稳定等待 | 300ms | stabilityThreshold |
| 轮询间隔 | 100ms | pollInterval |

**Indexer API 端点**：
| 端点 | 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|------|
| `/users` | GET | - | `{string[]}` | 所有用户名列表 |
| `/docs/:username` | GET | - | `{Doc[]}` | 用户文档列表 |
| `/doc/:username` | GET | `path` | `Doc` | 单篇文档详情 |
| `/search/:username` | GET | `q` | `{Result[]}` | FTS5 搜索结果 |

**关键实现细节**：
- 使用单实例多用户扫描模式（非每用户独立进程）
- DB 连接缓存：按用户名缓存 Database 连接
- 硬删策略：文件删除时同步删除 DB 记录
- 事务批量写入：按用户分组后统一事务提交

### 3.2 Web（Next.js 前端）

**职责**：
- 渲染 Markdown 文档（react-markdown + remark 插件链）
- 提供搜索界面
- SSE 实时接收更新
- 用户列表展示

**API 路由**：
| 路由 | 方法 | 说明 | 数据来源 |
|------|------|------|---------|
| `/api/users` | GET | 获取用户 + 文档列表 | 代理到 Indexer |
| `/api/doc` | GET | 获取单篇文档 | 代理到 Indexer |
| `/api/search` | GET | 搜索文档 | 代理到 Indexer |
| `/api/events` | GET | SSE 订阅端点 | 内存存储 |
| `/api/events` | POST | Indexer 回调端点 | Indexer 触发 |

**Markdown 渲染配置**：
```typescript
// src/lib/markdown.ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'      // GFM 支持
import remarkMath from 'remark-math'    // LaTeX 公式
import rehypeKatex from 'rehype-katex'  // 公式渲染
import rehypeRaw from 'rehype-raw'      // HTML 支持
import rehypeStringify from 'rehype-stringify'

export const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(rehypeKatex)
    .use(rehypeRaw)
    .use(rehypeStringify)
```

### 3.3 SSE 推送机制

**流程**：
```
Indexer 写入文件 → 解析 → 入库 → HTTP POST /api/events → Next.js → 浏览器
```

**实现要点**：
- Indexer 通过 HTTP POST 通知 Next.js
- Next.js 维护 SSE 客户端集合（内存存储）
- 心跳保持连接：每 25 秒发送 `:ping`
- 多实例部署需改用 Redis Pub/Sub

**事件类型**：
```typescript
interface IndexerEvent {
    username: string;           // 用户名
    event: 'update';            // 目前仅支持 'update'
    timestamp: number;          // Unix 时间戳 (ms)
}
```

**Indexer 触发逻辑**：
- 文件写入完成 → 解析 Frontmatter → 入库 → `notifyWeb(username, 'update')`
- 批量处理：200ms 防抖 + 按用户分组事务提交

### 3.4 SSE 重连机制

**当前实现**（page.tsx）：
```typescript
useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.event === 'update') {
            loadUsers();
        }
    };
    return () => es.close();
}, []);
```

**当前行为**：
- 浏览器 EventSource API 内置自动重连
- 默认 3 秒后重连（EventSource 规范）
- 无最大重试次数限制

**推荐实现（生产环境）**：
```typescript
useEffect(() => {
    let retryCount = 0;
    const MAX_RETRIES = 5;
    const BASE_DELAY = 1000; // 1 秒

    function connect() {
        const es = new EventSource('/api/events');
        es.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.event === 'update') {
                loadUsers();
            }
        };
        es.onerror = () => {
            if (retryCount < MAX_RETRIES) {
                retryCount++;
                const delay = BASE_DELAY * Math.pow(2, retryCount - 1); // 指数退避
                setTimeout(connect, delay);
            }
        };
        return es;
    }

    const es = connect();
    return () => es.close();
}, []);
```

**重连策略**：
| 参数 | 值 | 说明 |
|------|-----|------|
| 最大重试次数 | 5 | 防止无限重连 |
| 基础延迟 | 1000ms | 首次重试等待时间 |
| 退避倍数 | 2 | 指数退避公式：`1000 * 2^(retryCount-1)` |
| 最大延迟 | 32000ms | 防止延迟过长 |

### 3.5 用户注册 API

**说明**：PKGM-Web **不提供用户注册 API**，用户创建由 PKGM-Manager 负责。

**创建用户流程**：
```
系统管理员 → PKGM-Manager create-agent 技能
                    │
                    ├─→ 创建用户目录结构
                    ├─→ 初始化 Wiki 骨架
                    ├─→ 注册用户专属 Agent
                    └─→ OpenClaw Gateway 重启
```

**PKGM-Web 感知新用户的机制**：
- Indexer 冷启动时调用 `discoverUsers()` 扫描 `/users/` 目录
- 新用户创建后，Indexer 自动发现新目录并开始监控
- Web 前端通过 SSE 接收更新通知，自动刷新用户列表

---

## 4. 数据存储约定

### 4.1 用户目录结构

```
/workspace/project/PKGM/users/{username}/
├── agent-workspace/            # 用户专属 Agent 工作区
│   └── SOUL.md                 # Agent 身份定义
│
├── content/                    # PKGM-Web 展示的内容
│   ├── daily/                  # 日报类文档 (YYYY-MM-DD-[主题].md)
│   ├── uploads/                # 用户上传文档
│   ├── tasks/                  # 任务类文档
│   └── app/                    # PKGM Wiki 内容
│       └── wiki/
│           ├── 01_Wiki/        # Wiki 页面 (concepts, entities...)
│           ├── 02_System/      # 用户级配置
│           ├── 03_Engine/      # 缓存和日志
│           ├── 04_Knowledge/   # 知识领域
│           ├── 05_Project/     # 项目知识
│           ├── 06_Mynotes/     # 原创思考
│           └── 07_Research/    # 创作研究
│
├── assets/                     # 图片和附件
└── meta/                       # SQLite 索引
    └── index.db
```

### 4.2 SQLite 配置（NFS 兼容）

**重要约束**：NFS 环境必须使用 DELETE 模式，避免 WAL 模式的 `.wal/.shm` 文件问题。

```javascript
PRAGMA journal_mode = DELETE;  // NFS 必须用 DELETE，避免 .wal/.shm 文件问题
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

**表结构**：
```sql
CREATE TABLE documents (
    path TEXT PRIMARY KEY,
    title TEXT,
    content TEXT,
    content_seg TEXT,  -- 分词后内容用于 FTS
    tags TEXT,
    type TEXT,
    status TEXT,
    created TEXT,
    modified TEXT
);

CREATE VIRTUAL TABLE documents_fts USING fts5(
    path UNINDEXED, title, content_seg, tags UNINDEXED, type UNINDEXED,
    tokenize='unicode61 remove_diacritics 1'
);
```

### 4.3 Frontmatter 规范

**Frontmatter 规范**:

PKGM 系统统一使用 PKGM-Wiki 定义的 Schema，详见：

- [schema.yaml](../../PKGM-Wiki/references/default-configs/schema.yaml) — 完整的实体类型、关系类型、属性定义
- [Frontmatter 格式规范](../../PKGM-Wiki/references/default-configs/schema.yaml#4-frontmatter-格式规范) — 正确/错误示例

**快速参考**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 文档标题 |
| `type` | enum | 是 | `daily` \| `upload` \| `task` \| `wiki` |
| `status` | enum | 否 | `writing` \| `completed`（默认 `completed`） |
| `source` | enum | 否 | `cron` \| `user-upload` \| `explore-task` \| `wiki-gen` |
| `created` | ISO8601 | 是 | 创建时间 |
| `modified` | ISO8601 | 是 | 修改时间 |

**Wiki 类型扩展字段**（PKGM Wiki 内容专用）：

Wiki 类型页面的扩展字段参见
[PKGM-Wiki schema.yaml §3 通用属性（所有实体必须拥有）](../../PKGM-Wiki/references/default-configs/schema.yaml#3-通用属性所有实体必须拥有)。

**状态机规则**:

| status | Indexer 行为 | 说明 |
|--------|-------------|------|
| `writing` | **跳过**（不索引） | 流式生成中，可能不完整 |
| `completed` | **索引** | 生成完毕，可安全读取 |
| 缺失 | **索引**（向后兼容） | 旧文件默认索引 |

---

## 5. 对外接口契约

### 5.1 PKGM-Manager 集成

**职责边界**: PKGM-Web **不直接创建用户**，用户生命周期由 PKGM-Manager 管理。

| 操作 | 调用方 | 执行者 | 输出 |
|------|--------|--------|------|
| 创建用户 | PKGM-Manager | create-agent 技能 | `/users/{username}/` + Wiki 骨架 |
| 删除用户 | PKGM-Manager | delete-agent 技能 | 清理目录 + 会话 |
| 查询用户 | PKGM-Web | Indexer `/users` API | 用户名列表 |
| 用户状态 | PKGM-Manager | query-status 技能 | 健康度报告 |

**用户初始化流程**：
```
PKGM-Manager → create-agent 技能
    ├─→ 验证用户名唯一性 (test -d /users/{username})
    ├─→ 创建目录结构 (/users/{username}/)
    │   ├── agent-workspace/SOUL.md
    │   ├── content/app/wiki/01_Wiki/...
    │   └── meta/index.db
├─→ 初始化 Wiki 骨架 (content/app/wiki/)
     │   └─→ bash /workspace/project/PKGM-Wiki/skills/pkgm/scripts/init_user_wiki.sh {username}
    ├─→ 创建用户专属 Agent (agent-workspace/SOUL.md)
    │   └─→ templates/SOUL_TEMPLATE.md
    ├─→ 写入 USER_PROMPT.md
    │   └─→ templates/USER_PROMPT.md
    ├─→ 注册到 OpenClaw Gateway
    │   └─→ openclaw agents add pkgm-{username}
    └─→ 重启 Gateway (gateway restart)
```

**关键文件位置**：
| 文件 | 路径 | 说明 |
|------|------|------|
| SOUL.md | `/users/{username}/agent-workspace/SOUL.md` | Agent 身份定义 |
| USER_PROMPT.md | `/users/{username}/agent-workspace/USER_PROMPT.md` | System Prompt |
| init_user_wiki.sh | `/workspace/project/PKGM-Wiki/skills/pkgm/scripts/init_user_wiki.sh` | Wiki 目录初始化脚本 |

### 5.2 PKGM-Wiki 内容消费

**职责边界**: PKGM-Web **仅展示内容**，不负责生成。内容来源包括：

| 内容类型 | 来源 | 存储位置 | Frontmatter type |
|---------|------|---------|------------------|
| Wiki 页面 | PKGM-Wiki | `content/app/wiki/01_Wiki/*.md` | `wiki` |
| 日报 | OpenClaw Agent | `content/daily/*.md` | `daily` |
| 上传文件 | 用户上传 | `content/uploads/*.md` | `upload` |
| 任务文档 | 探索任务 | `content/tasks/*.md` | `task` |

**内容消费流程**：
```
PKGM-Wiki 输出 Markdown
        ↓
原子写入 /users/{username}/content/
        ↓
Indexer chokidar 检测变化
        ↓
解析 Frontmatter → 分词 → 入库
        ↓
Next.js 渲染展示
```

**Frontmatter 规范对齐**：
- `type`: `wiki` 对应 PKGM Wiki 页面
- `domain`: D01-D12 知识领域 ID
- `confidence`: 1-5 溯源置信度
- `verification.status`: unverified/pending/verified/refuted
- `lifecycle.status`: active/superseded/deprecated/refuted
- `relations`: wikilink 格式 `[[页面名]]`

详细规范参见 [PKGM-Wiki schema.yaml](/workspace/project/PKGM-Wiki/references/default-configs/schema.yaml)。

### 5.3 Indexer HTTP API 完整契约

| 端点 | 方法 | 参数 | 返回 | 示例 |
|------|------|------|------|------|
| `/users` | GET | - | `{string[]}` | `["alice", "bob"]` |
| `/docs/:username` | GET | - | `{Doc[]}` | `[{"path": "...", "title": "..."}]` |
| `/doc/:username` | GET | `path` | `Doc` | `{"path": "...", "content": "..."}` |
| `/search/:username` | GET | `q` | `{Result[]}` | `[{"path": "...", "title": "...", "snippet": "..."}]` |
| `/api/events` | POST | `{username, event}` | `{sent: number}` | `{"sent": 5}` |

**Doc 类型**：
```typescript
interface Doc {
    path: string;           // 文件绝对路径
    title: string;          // 标题（来自 frontmatter）
    content: string;        // 纯文本内容（去除 markdown 标记）
    content_seg: string;    // 分词后内容（用于 FTS 搜索）
    tags: string;           // 标签（逗号分隔）
    type: string;           // daily | upload | task | wiki
    status: string;         // writing | completed
    created: string;        // ISO8601 时间戳
    modified: string;       // ISO8601 时间戳
}
```

**Search Result 类型**：
```typescript
interface SearchResult {
    path: string;           // 文件路径
    title: string;          // 文档标题
    snippet: string;        // 高亮片段（含 <mark> 标签）
    type: string;           // 文档类型
    score?: number;         // 相关度分数（可选）
}
```

---

## 6. 开发指南

### 6.1 本地开发命令

**Web (Next.js)**:
```bash
cd web
npm run dev      # 开发服务器 (localhost:3000)
npm run build    # 生产构建
npm run lint     # ESLint 检查
```

**Indexer**:
```bash
cd indexer
node index.js    # 直接运行（需要设置环境变量）
# 或通过 Docker: docker compose up -d pkgm-indexer
```

### 6.2 常见故障处理

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 索引不更新 | Indexer 未运行 | `docker compose restart pkgm-indexer` |
| 中文搜索失效 | jieba 未安装 | `npm install @node-rs/jieba` |
| SQLite Busy | 并发冲突 | 增加 `busy_timeout` 或重试 |
| SSE 断开 | 连接超时 | 检查 Nginx 缓冲配置 |
| 索引损坏 | DB 文件异常 | 删除 `index.db*` 后重启 Indexer |

### 6.3 索引重建

如果索引数据损坏：

```bash
# 删除索引数据库
rm -f /workspace/project/PKGM/users/{username}/meta/index.db*

# 重启 Indexer 自动全量扫描
docker compose restart pkgm-indexer
```

---

## 附录

### A. 相关文档链接

| 文档 | 路径 | 说明 |
|------|------|------|
| [SYSTEM-ARCHITECTURE-OVERVIEW](/workspace/project/PKGM/docs/SYSTEM-ARCHITECTURE-OVERVIEW.md) | PKGM 总览 | 三项目联合架构 |
| [DEPLOYMENT](./DEPLOYMENT.md) | 本文档同级 | 部署与运维 |
| [ARCHITECTURE 归档](./archive/ARCHITECTURE.md) | 历史版本 | 已废弃的架构提案 |

### B. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| V1.0 | 2026-04-22 | 初始版本 |
| V2.0 | 2026-04-22 | 精简架构，补充接口契约，对齐多租户架构 |

---

*本文档为 PKGM-Web 项目的核心架构参考，开发者应依据此文档进行开发和集成。*
*上次更新：2026-04-22*
