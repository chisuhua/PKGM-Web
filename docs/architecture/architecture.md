# PKGM-Web 架构文档

**版本**: v3.0  
**创建日期**: 2026-07-17  
**状态**: 设计中（待评审）  
**关联文档**:
- 全栈架构总览：`docs/architecture/fullstack-architecture.md`
- 控制面架构：`../PKGM-Manager/docs/architecture/architecture.md`
- 业务逻辑层架构：`../PKGM-Wiki/docs/architecture/architecture.md`
- 调研文档：`docs/research/01-auth-multi-tenant.md`, `06-vector-qdrant.md`, `05-logseq-sync.md`

---

## 1. 项目定位

PKGM-Web 是 PKGM 系统的**展示面（Presentation Plane）**，负责：

- **用户认证与会话管理**（集成 Keycloak OIDC）
- **文档渲染与全文搜索**（SQLite FTS5 + Qdrant 双引擎）
- **实时推送**（SSE）
- **事件网关**（接收 Forgejo / MinIO / Temporal 的 Webhook）
- **范围问答**（RAG UI，基于 Qdrant 语义检索）
- **文件上传**（Presigned URL + tusd 可恢复上传）
- **Logseq 兼容层**（Web 端 Git Gateway）

### 1.1 与三项目的关系

```
┌─────────────────────────────────────────────────────────────────────┐
│                     基础设施层（独立部署）                              │
│  Keycloak │ MinIO │ Temporal │ Forgejo │ Qdrant │ tusd │ ClamAV     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  控制面：PKGM-Manager                                               │
│  - 租户生命周期（create/delete tenant）                               │
│  - 5 个 Provider 调用基础设施 API                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  业务逻辑面：PKGM-Wiki                                              │
│  - 6 阶段管线（SKILL.md 不变）                                        │
│  - Temporal Worker 适配层                                            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  展示面：PKGM-Web（本文档）                                           │
│  - NextAuth.js v5 认证                                               │
│  - Webhook Gateway                                                   │
│  - 双引擎搜索（FTS5 + Qdrant RAG）                                   │
│  - 上传服务（tusd 签名）                                              │
│  - SSE 实时推送                                                       │
│  - Logseq Web Gateway                                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 核心原则（保持不变）

> **文件系统/Markdown 仍是唯一数据源**。SQLite 是索引缓存，Qdrant 是语义缓存。  
> **Indexer 逻辑不变**。现有 chokidar + SQLite FTS5 索引继续工作。  
> **SSE 机制不变**。现有内存存储 SSE Broker 继续工作（1000+ 租户时评估 Redis Pub/Sub）。

---

## 2. 模块架构

### 2.1 认证模块

| 项 | 当前 | 目标 |
|---|---|---|
| JWT 签发 | `lib/auth.ts` 自签 HS256 | NextAuth.js v5 + Keycloak OIDC |
| Token 存储 | httpOnly Cookie `pkgm-token` | 保留（作为 session 包装层） |
| 验证 | `jose` 库直接验证 | Keycloak JWKS endpoint RS256 验证 |
| 中间件 | 自写 username 校验 | 改读 `tenant_id` claim |

**关键文件**：
```
src/lib/auth-v5.ts           # NextAuth.js v5 配置（替代 auth.ts）
src/middleware.ts             # 改造：从 username → tenant_id
src/app/api/auth/[...nextauth]/route.ts  # NextAuth 路由处理器
```

**目标 JWT Claims**：
```json
{
  "sub": "user_...",
  "tenant_id": "tnt_acme",
  "role": "owner",
  "iss": "https://auth.example.com/realms/pkgm"
}
```

**迁移策略**：
1. Phase 0：保留现有 `auth.ts`，新增 `auth-v5.ts` 并行运行
2. Phase 1：灰度切换到 NextAuth.js v5
3. Phase 2：删除旧 `auth.ts`

---

### 2.2 Webhook 网关模块

接收外部基础设施的事件通知，转换为 PKGM 内部事件。

#### 2.2.1 Forgejo Webhook

| 项 | 说明 |
|---|---|
| **端点** | `POST /api/webhooks/forgejo` |
| **触发源** | Forgejo push 事件（用户 git push） |
| **处理** | HMAC 验证 → 幂等去重（repo+ref+after）→ 启动 Temporal `PkgmReindexWorkflow` → SSE 推送 |
| **关键约束** | Forgejo 不自动重试 → 必须做 Outbox 持久化 |

**关键文件**：
```
src/app/api/webhooks/forgejo/route.ts
src/lib/webhooks/forgejo.ts        # HMAC 验证 + 幂等键生成
src/lib/webhooks/outbox.ts         # Outbox 持久化（SQLite）
```

#### 2.2.2 MinIO Webhook

| 项 | 说明 |
|---|---|
| **端点** | `POST /api/webhooks/minio` |
| **触发源** | MinIO 对象创建/删除事件 |
| **处理** | 验证 secret → 解析事件 → 启动 Temporal `PkgmUploadWorkflow` → SSE 推送 |
| **关键约束** | 异步模式 + queue_dir 持久化保证不丢事件 |

**关键文件**：
```
src/app/api/webhooks/minio/route.ts
src/lib/webhooks/minio.ts
```

#### 2.2.3 Temporal Webhook（可选）

| 项 | 说明 |
|---|---|
| **端点** | `POST /api/webhooks/temporal` |
| **触发源** | Temporal Workflow 完成事件 |
| **处理** | 解析 workflow_id → 更新 UI 状态 → SSE 推送 |

---

### 2.3 搜索模块（双引擎）

#### 2.3.1 关键字搜索（保留现有）

- 端点：`GET /api/search?q=...`
- 实现：代理到 Indexer HTTP API（SQLite FTS5）
- 用途：精确匹配英文/数字/部分中文

#### 2.3.2 语义搜索（新增）

| 项 | 说明 |
|---|---|
| **端点** | `GET /api/rag/search?q=...&domain=D01&confidence=3` |
| **实现** | 调用 Qdrant（dense + sparse + ColBERT 精排） |
| **过滤** | `tenant_id`（强制）+ `domain`/`tags`/`confidence`（可选） |
| **响应** | Top-K Markdown 文档 + 高亮片段 + 来源引用 |

**关键文件**：
```
src/app/api/rag/search/route.ts
src/lib/qdrant.ts                # Qdrant Client 封装
src/lib/embeddings.ts            # BGE-M3 嵌入（FastEmbed 包装）
```

**前端 UI**：
```
src/app/rag/page.tsx             # 范围问答界面
src/components/rag/              # 答案展示组件
```

---

### 2.4 上传模块

| 项 | 说明 |
|---|---|
| **端点** | `POST /api/upload/sign` |
| **实现** | 生成 Presigned PUT URL（5 分钟过期，签名 Content-Type/MD5） |
| **客户端** | 浏览器用 Uppy 直传 MinIO（tusd 协议） |
| **后续** | MinIO Webhook → 触发管线 |

**关键文件**：
```
src/app/api/upload/sign/route.ts
src/app/upload/page.tsx
src/components/upload/uppy.tsx
```

---

### 2.5 Logseq 兼容层

| 项 | 说明 |
|---|---|
| **问题** | Logseq 不完全支持 YAML Frontmatter（`---` 区块） |
| **解决** | 双向转换层：PKGM 原始 ↔ Logseq 属性格式 |
| **存储** | 投影文件存于 `.logseq/` 子目录，不污染原始仓库 |

**关键文件**：
```
src/lib/logseq_compat.ts         # YAML ↔ Logseq 属性转换
src/app/api/git/commit/route.ts  # Web 端 Git 提交 API
```

**转换规则**：
```yaml
# PKGM 原始
---
title: "文档"
type: "daily"
tags: ["tag1", "tag2"]
---

# Logseq 投影
title:: 文档
type:: daily
tags:: tag1, tag2
```

---

### 2.6 Indexer（保留）

| 项 | 说明 |
|---|---|
| **状态** | **完全保留**，零改动 |
| **文件** | `indexer/index.js` |
| **职责** | chokidar 监控 + SQLite FTS5 索引 + HTTP API |
| **端口** | 3004 |

---

### 2.7 SSE 推送（保留）

| 项 | 说明 |
|---|---|
| **状态** | **完全保留**，零改动 |
| **文件** | `src/lib/sse-broker.ts` |
| **扩展** | Webhook → SSE 桥接（每个 Webhook 端点触发 SSE 事件） |

---

### 2.8 审计日志模块

| 项 | 说明 |
|---|---|
| **端点** | `GET /api/metrics` |
| **实现** | Next.js Middleware 扩展 + JSONL 日志 |
| **指标** | 上传/下载/Webhook/API 调用计数 |

**关键文件**：
```
src/middleware.ts                # 扩展：记录审计日志
src/app/api/metrics/route.ts    # Prometheus 指标
src/lib/audit.ts                # JSONL 日志写入
```

---

## 3. 数据流总览

```
用户浏览器 → PKGM-Web
    │
    ├─→ /api/upload/sign → MinIO Presigned URL → 浏览器直传 MinIO
    │                                                │
    │                                                ▼ (MinIO Webhook)
    │                                        /api/webhooks/minio
    │                                                │
    │                                                ▼
    │                                        Temporal PkgmUploadWorkflow
    │                                                │
    ├─→ /api/rag/search → Qdrant 语义检索 → 答案展示
    │
    ├─→ /api/search → Indexer FTS5 → 关键字搜索
    │
    ├─→ /api/webhooks/forgejo → Temporal PkgmReindexWorkflow
    │
    └─→ /api/events → SSE 实时推送
```

---

## 4. API 路由清单

### 4.1 保留的 API

| 路由 | 方法 | 说明 | 数据来源 |
|------|------|------|---------|
| `/api/users` | GET | 获取用户 + 文档列表 | 代理到 Indexer |
| `/api/doc` | GET | 获取单篇文档 | 代理到 Indexer |
| `/api/search` | GET | 关键字搜索 | 代理到 Indexer |
| `/api/events` | GET | SSE 订阅 | 内存存储 |
| `/api/events` | POST | Indexer 回调 | Indexer 触发 |
| `/api/login` | POST | 登录（过渡期保留） | 自签 JWT |
| `/api/logout` | POST | 登出 | 清除 Cookie |
| `/api/health` | GET | 健康检查 | - |
| `/api/metrics` | GET | Prometheus 指标 | 内存 |

### 4.2 新增的 API

| 路由 | 方法 | 说明 | 数据来源 |
|------|------|------|---------|
| `/api/auth/[...nextauth]` | * | NextAuth.js v5 路由 | Keycloak OIDC |
| `/api/webhooks/forgejo` | POST | Forgejo push 事件 | Forgejo Webhook |
| `/api/webhooks/minio` | POST | MinIO 对象事件 | MinIO Webhook |
| `/api/rag/search` | GET | 语义搜索 | Qdrant |
| `/api/upload/sign` | POST | Presigned URL 签名 | MinIO |
| `/api/git/commit` | POST | Web 端 Git 提交 | Forgejo API |

---

## 5. 依赖清单

### 5.1 新增 npm 依赖

| 包 | 用途 |
|---|---|
| `next-auth` | NextAuth.js v5（认证） |
| `@qdrant/js-client-rest` | Qdrant 客户端 |
| `minio` | MinIO 客户端（生成 Presigned URL） |
| `@uppy/core` | 上传客户端 |
| `@uppy/tus` | tusd 协议支持 |
| `gray-matter` | YAML Frontmatter 解析（已有） |
| `@octokit/webhooks` | Webhook 验证（借鉴） |

### 5.2 保留的依赖

| 包 | 用途 |
|---|---|
| `jose` | JWT 处理（过渡期） |
| `chokidar` | Indexer 文件监控 |
| `better-sqlite3` | Indexer SQLite |
| `@node-rs/jieba` | 中文分词 |
| `react-markdown` | Markdown 渲染 |
| `remark-*` / `rehype-*` | Markdown 插件链 |

---

## 6. 部署拓扑

### 6.1 Phase 0（单机原型）

```yaml
# docker-compose.yml 扩展
services:
  pkgm-web:
    build: ./web
    ports: ["3001:3001"]
    environment:
      - KEYCLOAK_ISSUER=https://keycloak:8080/realms/pkgm
      - QDRANT_URL=http://qdrant:6333
      - MINIO_ENDPOINT=http://minio:9000
  
  pkgm-indexer:
    build: ./indexer
    ports: ["3004:3004"]
    # 不变
```

### 6.2 Phase 1+（生产）

- PKGM-Web 多实例 → Nginx 负载均衡
- SSE 改用 Redis Pub/Sub（1000+ 租户时）
- Indexer 保持单实例（1000+ 租户时评估 Worker 化）

---

## 7. 迁移路线图

| 阶段 | 工作 | 风险 |
|------|------|------|
| **Phase 0** | 新增 NextAuth.js v5 + Keycloak 并行运行 | 低 |
| **Phase 1** | 新增 Webhook Gateway（Forgejo + MinIO） | 中（Outbox 持久化） |
| **Phase 2** | 新增 RAG 搜索 + Qdrant 集成 | 中（嵌入模型选择） |
| **Phase 3** | 新增上传服务（tusd + Uppy） | 低 |
| **Phase 4** | 新增 Logseq 兼容层 | 中（双向转换） |
| **Phase 5** | 删除旧 `auth.ts`，完全切换到 NextAuth.js v5 | 中（灰度） |

---

## 8. 关键约束

1. **Indexer 逻辑不变**：chokidar + SQLite FTS5 继续工作，零改动
2. **SSE 机制不变**：内存存储 SSE Broker 继续工作
3. **文件系统仍是数据源**：Qdrant 是语义缓存，可重建
4. **认证双模式运行**：过渡期保留旧 JWT + 新 Keycloak
5. **Webhook 不可靠**：必须做 Outbox 持久化 + 幂等去重
6. **Logseq 兼容层不污染原始仓库**：投影文件存于 `.logseq/` 子目录

---

## 9. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-04-22 | 初始版本 |
| v2.0 | 2026-04-22 | 精简架构，补充接口契约 |
| v3.0 | 2026-07-17 | 全栈架构改造：引入 Keycloak/Qdrant/Webhook Gateway/RAG/Logseq 兼容层 |

---

*本文档为 PKGM-Web 展示面的目标架构参考。*  
*当前状态：设计中（待评审）*