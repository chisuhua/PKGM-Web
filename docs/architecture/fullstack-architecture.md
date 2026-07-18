# PKGM 全栈架构方案

> **版本**：v1.0  
> **创建日期**：2026-07-17  
> **状态**：方案设计（待评审）  
> **关联文档**：
> - `docs/research/01-auth-multi-tenant.md` — 认证方案
> - `docs/research/02-object-storage-minio.md` — 对象存储
> - `docs/research/03-workflow-temporal.md` — 工作流引擎
> - `docs/research/04-git-forgejo.md` — Git 仓库
> - `docs/research/05-logseq-sync.md` — Logseq 同步
> - `docs/research/06-vector-qdrant.md` — 向量检索
> - `docs/research/07-three-projects-mapping.md` — 三项目映射

---

## 0. 总览

PKGM 当前由三个项目组成（PKGM-Manager / PKGM-Wiki / PKGM-Web），采用「共享进程 + 文件系统隔离」的单实例多租户模式。本方案在保留三项目协作边界的前提下，引入 6 个基础设施组件，完成从「单人本地工具」到「多租户 SaaS 平台」的演进。

### 0.1 技术路径分类说明

| 路径 | 定义 | 适用条件 |
|------|------|----------|
| **集成开源** | 直接使用第三方项目，二进制或容器部署，不修改源码 | 成熟稳定、API 清晰、社区活跃、与 PKGM 技术栈不冲突 |
| **借鉴开源** | 参考开源项目的架构/算法/代码片段，在 PKGM 代码库中重写 | 核心逻辑与 PKGM 业务耦合强、需定制化、不适合直接依赖 |
| **完全自建** | 从零设计开发，无开源参考 | 业务高度专属、简单功能、性能/集成要求特殊 |

### 0.2 子项目架构文档

本全栈架构方案定义了三个子项目的目标架构。每个子项目都有独立的架构文档，详细描述其模块设计、数据流、依赖清单和迁移路线图：

| 子项目 | 定位 | 架构文档 | 归档文档 |
|--------|------|----------|----------|
| **PKGM-Web** | 展示面（Presentation Plane） | `docs/architecture/architecture.md` | `docs/archive/architecture-v2-2026-04.md` |
| **PKGM-Manager** | 控制面（Control Plane） | `../PKGM-Manager/docs/architecture/architecture.md` | `../PKGM-Manager/docs/archive/architecture-v2-2026-04.md` |
| **PKGM-Wiki** | 业务逻辑面（Business Logic Plane） | `../PKGM-Wiki/docs/architecture/architecture.md` | `../PKGM-Wiki/docs/archive/architecture-v2-2026-04.md` |

**文档层次**：
- **全栈架构**（本文档）：定义 12 个功能模块的归属和技术路径，是三项目协作的总纲
- **子项目架构**（三份子文档）：定义每个子项目内部的模块设计、数据流、API 清单和迁移路线图
- **调研文档**（`docs/research/`）：6 个基础设施组件的技术调研和选型依据

---

## 1. 全栈架构总览

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          用户层（浏览器 / Logseq 桌面 / 移动）               │
└──────────────────────────────────────────────────────────────────────────┘
                                │
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
        ┌──────────────────┐        ┌──────────────────┐
        │   Web CDN/LB     │        │   Forgejo SSH    │
        │   (Nginx)        │        │   (用户 git 接入) │
        └────────┬─────────┘        └────────┬─────────┘
                 │                           │
                 ▼                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       展示面：PKGM-Web (Next.js)                          │
│  - NextAuth.js v5 + Keycloak OIDC                                          │
│  - RAG UI + 关键字搜索（双引擎）                                           │
│  - Webhook Gateway（接收 Forgejo / MinIO 事件）                            │
└──────────────────────────────────────────────────────────────────────────┘
                 │                           │
                 ▼                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                  业务逻辑面：PKGM-Wiki (技能 + Temporal Adapter)           │
│  - 6 阶段管线 SKILL.md（不变）                                              │
│  - Temporal Worker 注册 6 个 Activity                                       │
│  - pkgm-architect HITL（Signal/Query）                                      │
└──────────────────────────────────────────────────────────────────────────┘
                 │                           │
                 ▼                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                  控制面：PKGM-Manager (Provider 编排器)                    │
│  - create-tenant / delete-tenant / manage-quota                            │
│  - 5 个 Provider（Keycloak / MinIO / Forgejo / Temporal / Qdrant）         │
└──────────────────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     基础设施层（独立部署的 6 个开源组件）                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐│
│  │ Keycloak │ │  MinIO   │ │ Temporal │ │ Forgejo  │ │ Qdrant   │ │ ...   ││
│  │ 认证     │ │ 对象存储 │ │ 编排     │ │ Git      │ │ 向量     │ │       ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └───────┘│
└──────────────────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       数据源：用户文件系统 (NFS/本地)                       │
│  /workspace/project/PKGM/users/{tenant_id}/content/                       │
│  + Forgejo Git Repo（每租户一个）                                           │
│  + MinIO Object Store（每租户一个 prefix）                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 模块清单与归属

下文按 12 个功能模块逐一定义。每个模块给出：

- **模块名称**：功能点
- **所属子项目**：在哪个 PKGM 项目内做
- **技术路径**：集成开源 / 借鉴开源 / 完全自建
- **具体方案**：组件选型 + 理由
- **关键边界**：与其它模块的接口

---

## 模块 1：多租户用户认证

| 项 | 决策 |
|---|---|
| **所属子项目** | **PKGM-Web**（前端认证）+ 独立部署 **Keycloak**（基础设施） |
| **技术路径** | **集成开源**：直接部署 Keycloak，前端用 NextAuth.js v5 集成 |
| **具体方案** | Keycloak 26.x（启用 Organizations feature）+ NextAuth.js v5 Keycloak Provider |
| **理由** | 自托管免费（Apache 2.0），Organizations 模型匹配 PKGM 用户结构，实测 1500+ 组织性能稳定，NextAuth.js v5 官方支持 |

**关键边界**：
- Keycloak 签发 RS256 JWT（`iss` = Keycloak realm URL）
- NextAuth.js v5 在 PKGM-Web 内做 session 管理（保留 `pkgm-token` httpOnly Cookie 作为 session 包装）
- 中间件读取 `tenant_id` claim 做路由隔离
- JWT 验证用 Keycloak JWKS endpoint（无需共享 secret）

**需要做的工作**：
1. 部署 Keycloak 单实例（Docker Compose）
2. 启用 Organizations feature（默认开启）
3. 创建 realm `pkgm` + 1 个客户端 `pkgm-web`
4. PKGM-Web 用 NextAuth.js v5 替换自签 JWT
5. Middleware 改造：从读 `username` 改为读 `tenant_id`

---

## 模块 2：租户注册与配额管理

| 项 | 决策 |
|---|---|
| **所属子项目** | **PKGM-Manager**（控制面） |
| **技术路径** | **完全自建**：扩展现有 `create-agent` 技能为 `create-tenant` |
| **具体方案** | 在 PKGM-Manager 内新增 `manager/scripts/create_tenant.py`，调用 5 个 Provider |
| **理由** | 控制面是 PKGM-Manager 的本职职责；现有 `create-agent` 技能只需扩展调用外部 API，不引入新依赖 |

**关键边界**：
- `create_tenant.py` 调用顺序：Keycloak → MinIO → Forgejo → 文件系统 → OpenClaw
- 任一 Provider 失败 → 触发反向清理（已成功的 Provider 撤回）
- 返回结构化的 `TenantProvisioningResult` 给调用方

**需要做的工作**：
1. 新增 `manager/skills/create-tenant/SKILL.md`（替换 `create-agent`）
2. 实现 `manager/scripts/create_tenant.py`
3. 新增 `manager/lib/providers/` 目录，按 Provider 拆分：
   - `keycloak_provider.py`
   - `minio_provider.py`
   - `forgejo_provider.py`
   - `filesystem_provider.py`（保留现有 init_user_wiki.sh）
   - `openclaw_provider.py`（保留现有逻辑）
4. 审计日志：每次创建/删除写入 JSONL

---

## 模块 3：对象存储（文件原始数据）

| 项 | 决策 |
|---|---|
| **所属子项目** | 独立部署 **MinIO**（基础设施） |
| **技术路径** | **集成开源**：MinIO 社区版（Docker 单节点起步） |
| **具体方案** | MinIO 单 Bucket `pkgm-data` + Prefix 隔离 `uploads/{tenant_id}/`、`cache/{tenant_id}/`、`wiki/{tenant_id}/` |
| **理由** | 单桶足够 1000+ 租户；IAM Policy Variables 实现自动隔离；S3 API 兼容便于未来切换 |

**关键边界**：
- PKGM-Web 用 `minio-js` 生成 Presigned PUT URL（5 分钟过期，签名 Content-Type）
- PKGM-Wiki 用 `minio-py` 读写缓存和 LFS
- MinIO Webhook → PKGM-Web `/api/webhooks/minio` → 启动 Temporal Workflow

**需要做的工作**：
1. Docker Compose 加 MinIO 服务
2. 创建初始 Bucket 和 IAM Policy 模板
3. PKGM-Web 集成 `minio-js`（生成 Presigned URL）
4. PKGM-Wiki 集成 `minio-py`（缓存读写）
5. 实现 Webhook 接收端 `/api/webhooks/minio`

**重要限制**：
- MinIO 数据盘**禁止 NFS**，推荐本地 XFS/ZFS/Btrfs
- 超过 100GB 数据后考虑 4 节点分布式
- 未来商业化时考虑 MinIO AIStor（社区版 2025 起维护模式）

---

## 模块 4：管线编排（6 阶段 Workflow）

| 项 | 决策 |
|---|---|
| **所属子项目** | 独立部署 **Temporal**（基础设施） + PKGM-Wiki 接入（业务逻辑） |
| **技术路径** | **集成开源 Temporal 服务端** + **完全自建 Temporal Worker 适配层** |
| **具体方案** | Temporal 单 Namespace + 每租户 Task Queue `pkgm-{tenant_id}` + Python Worker 封装 6 个 SKILL.md |
| **理由** | Temporal 的 Event History 完美匹配「断点续传管线 + LLM 重试 + 人工审核」需求；Python SDK 与 PKGM-Wiki 同语言 |

**关键边界**：
- Workflow = 6 阶段顺序编排，每个 Phase 对应 1 个 Activity
- LLM Activity 重试由 Temporal 接管（OpenAI 客户端 `max_retries=0`）
- pkgm-architect 审核用 Signal + wait_condition（24h 超时）
- Workflow 状态由 Temporal UI 可视化（`localhost:8233`）

**需要做的工作**：
1. Docker Compose 加 Temporal Server（dev 模式） + PostgreSQL
2. PKGM-Wiki 新增 `scripts/temporal_worker.py`，注册 6 个 Activity 委托给现有 SKILL.md
3. 配置 LLM RetryPolicy（initial_interval=10s, backoff_coefficient=3.0, max_attempts=20）
4. PKGM-Web 加 Temporal Client，启动 Workflow
5. 新增审核 UI（WebSocket 监听 Workflow Query）

**重要约束**：
- **保持 PKGM-Wiki 内 SKILL.md 完全不变**——Agent 仍可手动触发
- Worker 进程 1 个起步，每 250 用户扩 1 个 Worker Pod

---

## 模块 5：Git 仓库与版本控制

| 项 | 决策 |
|---|---|
| **所属子项目** | 独立部署 **Forgejo**（基础设施） + PKGM-Manager 接入（控制面） |
| **技术路径** | **集成开源**：Forgejo 15.x LTS（Docker 单节点起步） |
| **具体方案** | 组织 `pkgm-tenants` + 每租户私有 Repo `tenant-{id}`（从模板创建）+ SSH Deploy Key |
| **理由** | Forgejo 比 Gitea 社区更活跃（1,171 vs 1,012 近半年提交），v15 LTS 支持到 2027-07-15 |

**关键边界**：
- 模板仓库 `pkgm-system/tenant-template`：只放目录骨架，不放真实文件
- 每租户独立 Deploy Key（`ed25519`），存储于 Secret Manager
- Push Webhook → PKGM-Web `/api/webhooks/forgejo`（HMAC 验证 + 幂等去重）
- LFS 存储大文件（图片/PDF），后端对接 MinIO

**需要做的工作**：
1. Docker Compose 加 Forgejo + PostgreSQL
2. 创建模板仓库（含 PKGM 目录骨架）
3. PKGM-Manager ForgejoProvider 实现：生成 Repo + 注入 Deploy Key + 创建 Webhook
4. PKGM-Web 实现 Webhook 接收端 `/api/webhooks/forgejo`
5. PKGM-Wiki Temporal Worker 在 Phase 4 后执行 `git push` 到 Forgejo Repo

**重要约束**：
- Webhook 不可靠（Forgejo 不自动重试）——PKGM-Web 必须做 Outbox 持久化
- 禁止 `git push --force` 和 `git reset --hard`
- LFS 走 HTTPS（SSH LFS 默认关闭）

---

## 模块 6：Logseq 本地编辑与同步

| 项 | 决策 |
|---|---|
| **所属子项目** | **PKGM-Web**（Web 端）+ 用户自行管理（桌面端） |
| **技术路径** | **集成开源 Forgejo Git**（复用模块 5）+ **借鉴 Logseq DB Sync 协议**（可选，未来） |
| **具体方案** | 桌面端：`git clone` + Logseq 内置 Git auto-commit + post-commit hook 推送；Web 端：PKGM Git Gateway API |
| **理由** | 复用 Forgejo 基础设施零成本；Logseq 内置 Git 不负责 push——需用 hook 补齐 |

**关键边界**：
- 桌面：用户机器 → Logseq 本地仓库 → post-commit hook（fetch+rebase+push）
- Web：PKGM-Web Git API 提交需要 token 鉴权
- 移动端：暂不支持 Logseq 同步，建议用 Web 端

**需要做的工作**：
1. 提供 PKGM `post-commit` 脚本模板（Git hook）
2. PKGM-Web 加 `/api/git/commit` API（Web 端提交）
3. 提供 `pkgm clone {tenant_id}` CLI 工具（桌面端一键 clone）
4. **关键兼容性问题**：PKGM 的 YAML Frontmatter 需转换（详见模块 11）

**重要约束**：
- Logseq 不完全支持标准 YAML Frontmatter（`---` 区块），需要适配层
- 强制 Git LFS 用 HTTPS（不要用 SSH LFS）
- 并发冲突用 rebase + ours 策略，AI 写入追加到 `## AI Updates` 区域

---

## 模块 7：语义问答（AI Q&A）

| 项 | 决策 |
|---|---|
| **所属子项目** | **PKGM-Web**（前端 + API） + 独立部署 **Qdrant**（基础设施） |
| **技术路径** | **集成开源 Qdrant 服务** + **借鉴 LlamaIndex 集成模式** + **完全自建范围问答 API** |
| **具体方案** | Qdrant 单 Collection `pkgm_knowledge` + Payload 过滤（`tenant_id`, `domain`, `confidence`）+ BGE-M3 嵌入 + Hybrid Search |
| **理由** | Qdrant 原生支持 dense+sparse+multi-vector，与 BGE-M3 完美匹配；Payload 过滤可承担多租户隔离 |

**关键边界**：
- Collection 模型：dense(1024d) + sparse + colbert(multi-vector)
- `is_tenant=True` + `payload_m=16, m=0` 实现租户子图
- PKGM-Wiki 在 Phase 4 后异步触发 `QdrantProvider.upsert_chunks`
- PKGM-Web `/api/rag/search` 接收查询，调用 Qdrant + 可选 LLM 包装

**需要做的工作**：
1. Docker Compose 加 Qdrant（v1.18+）
2. 创建 Collection + Payload 索引（`tenant_id` 必加 `is_tenant=True`）
3. 集成 `llama-index-vector-stores-qdrant`（注意 `client`+`aclient` 必须同时传）
4. PKGM-Wiki 嵌入脚本：`scripts/embed_chunks.py`，调用 BGE-M3（FastEmbed 包装）
5. PKGM-Web 新增 RAG UI（范围选择器 + 答案展示）

**重要约束**：
- 必须使用 `LlamaIndex QdrantVectorStore(client=, aclient=)`，否则异步挂起
- BGE-M3 嵌入 1024d，无须为 query 加 instruction
- 嵌入应保留 `Frontmatter` 到 payload，不嵌入正文 chunk

---

## 模块 8：文档上传与病毒扫描

| 项 | 决策 |
|---|---|
| **所属子项目** | **PKGM-Web**（上传 API + 浏览器直传）+ **完全自建** 扫描服务 |
| **技术路径** | **集成开源 tusd**（可恢复上传）+ **集成开源 ClamAV**（病毒扫描）+ **完全自建 pkgm-scanner 协调器** |
| **具体方案** | tusd 接收浏览器分片上传 → 直传 MinIO → MinIO Webhook → pkgm-scanner（订阅 → 下载 → ClamAV → 打 tag → 触发管线） |
| **理由** | tusd 协议成熟支持断点续传；ClamAV 是开源病毒扫描事实标准；pkgm-scanner 协调器轻量级 |

**关键边界**：
- tusd 服务独立部署，HTTPS 端点对外
- 浏览器用 Uppy 客户端分片上传
- ClamAV 通过 `clamav-rest` 暴露 REST API
- 扫描结果写入 MinIO 对象 tag（`scan-status=clean|infected|pending`）

**需要做的工作**：
1. Docker Compose 加 tusd + ClamAV + clamav-rest
2. PKGM-Web 实现上传签名 API（返回 tusd endpoint）
3. 集成 Uppy 到 PKGM-Web 前端
4. 实现 `pkgm-scanner` 服务（订阅 MinIO Webhook）
5. MinIO IAM Policy 用 `scan-status` tag 控制可下载性

**重要约束**：
- ClamAV 扫描失败时文件默认不可下载
- 隔离区 `pkgm-quarantine` bucket 存放感染文件
- tusd 服务不要暴露在公网（用 HTTPS 反向代理）

---

## 模块 9：管线缓存（增量复用）

| 项 | 决策 |
|---|---|
| **所属子项目** | **PKGM-Wiki**（业务逻辑保留）+ **PKGM-Web**（索引器）+ 选配 **MinIO** |
| **技术路径** | **保留本地文件系统** + **借鉴开源 dual-write 模式**（本地写 + MinIO 异步写） |
| **具体方案** | 当前 `03_Engine/cache/ingest|analysis|link/` 保留；同时异步复制到 MinIO `pkgm-data/{tenant_id}/cache/` |
| **理由** | 缓存是临时数据（7 天过期），本地快；MinIO 备份防丢失 |

**关键边界**：
- 本地缓存：保持 PKGM-Wiki 当前实现，零改动
- MinIO 缓存：PKGM-Wiki 在 cache 写入时同步 PUT（异步队列，不阻塞主线）
- MinIO Lifecycle：`cache/` prefix 7 天过期自动清理

**需要做的工作**：
1. PKGM-Wiki 新增 `scripts/cache_uploader.py`（订阅本地 cache 写入事件）
2. 配置 MinIO Lifecycle 规则（`mc ilm rule add ... --prefix cache/ --expire-days 7`）

**重要约束**：
- 缓存写入失败不影响管线主流程
- MinIO 缓存恢复时序：本地优先，MinIO 兜底

---

## 模块 10：实时推送（SSE）

| 项 | 决策 |
|---|---|
| **所属子项目** | **PKGM-Web**（保持现状） |
| **技术路径** | **保留现有实现**（借鉴 Redis Pub/Sub 模式，但不引入） |
| **具体方案** | 当前 Next.js SSE Broker + 内存 Map；单机足够，1000+ 租户时改用 Redis Pub/Sub |
| **理由** | 单实例 SSE 简单有效；现有 `lib/sse-broker.ts` 已实现 |

**关键边界**：
- MinIO Webhook → SSE 推送
- Forgejo Webhook → SSE 推送
- Temporal Workflow 完成事件 → SSE 推送

**需要做的工作**：
1. 保持现有 SSE 实现
2. 增加 Webhook → SSE 桥接器（每个 Webhook 端点触发 SSE 事件）
3. 1000+ 租户时评估 Redis Pub/Sub 改造

**重要约束**：
- SSE 断线重连由前端 EventSource 自动处理
- 内存 Map 存储连接，PKGM-Web 重启时所有连接断开

---

## 模块 11：Markdown 渲染与 Frontmatter 兼容

| 项 | 决策 |
|---|---|
| **所属子项目** | **PKGM-Web**（渲染）+ **PKGM-Wiki**（生成）+ Logseq 兼容（**完全自建**适配层） |
| **技术路径** | **集成开源** markdown-it + **借鉴开源** gray-matter + **完全自建** Logseq 转换器 |
| **具体方案** | PKGM-Web 用现有 `lib/markdown.ts`；新增 `lib/logseq_compat.ts` 处理 PKGM↔Logseq 双向转换 |
| **理由** | 现有 markdown 渲染稳定；Logseq 不识别 YAML Frontmatter，需双向转换层 |

**关键边界**：
- **PKGM 原文件**：`---` 包裹的 YAML Frontmatter
- **Logseq 兼容格式**：`title:: xxx` 行内属性
- **转换器**：PKGM 写 → 生成 Logseq 投影；Logseq 读 → 合并回 PKGM
- **同步策略**：投影文件存于 `.logseq/` 子目录，不污染 PKGM 原始仓库

**需要做的工作**：
1. 新增 `web/src/lib/logseq_compat.ts`：YAML ↔ Logseq 属性转换
2. PKGM-Wiki 在 `pkgm-wiki-gen` 阶段输出双格式（PKGM 原始 + Logseq 投影）
3. PKGM-Web 前端加格式切换提示

**重要约束**：
- Logseq 的 `[[Page]]` 引用需保留为 Markdown 的 wikilink 格式
- 数组类型（tags）需稳定序列化规则
- 未知字段不能丢失（保留为扩展属性）

---

## 模块 12：审计日志与计量

| 项 | 决策 |
|---|---|
| **所属子项目** | **PKGM-Manager**（控制面）+ **PKGM-Web**（API 端点） |
| **技术路径** | **集成开源** OpenTelemetry SDK + **完全自建**审计日志聚合器 |
| **具体方案** | 关键操作（创建/删除租户、上传/下载、Webhook 接收）写入结构化 JSONL 日志 + Prometheus metrics |
| **理由** | JSONL 简单可靠；Prometheus metrics 用于实时监控；不引入重组件 |

**关键边界**：
- 审计日志格式：`{timestamp, action, tenant_id, user_id, resource, status, latency_ms}`
- Prometheus 指标：`pkgm_*` 前缀，`/api/metrics` 暴露
- 写入路径：操作成功时记录（失败时记录 error 类型）

**需要做的工作**：
1. PKGM-Web 实现审计日志中间件（Next.js Middleware 扩展）
2. PKGM-Web `/api/metrics` 端点（参考现有 `metrics.ts`）
3. PKGM-Manager 在 `create-tenant/delete-tenant` 时记录
4. Docker Compose 加 Prometheus + Grafana（可选）

**重要约束**：
- 审计日志不可变（追加模式，不删除）
- 保留期 ≥ 1 年（合规要求）

---

## 3. 全栈组件清单

| 组件 | 来源 | 部署方式 | 依赖 |
|------|------|---------|------|
| **Keycloak** | 集成开源（Apache 2.0） | Docker 单节点起步 | PostgreSQL |
| **MinIO** | 集成开源（AGPLv3） | Docker 单节点起步 | XFS/ZFS 本地盘 |
| **Temporal** | 集成开源（MIT） | `temporal server start-dev` 起步 | PostgreSQL |
| **Forgejo** | 集成开源（MIT） | Docker 单节点起步 | PostgreSQL |
| **Qdrant** | 集成开源（Apache 2.0） | Docker 单节点起步 | - |
| **tusd** | 集成开源（MIT） | Docker 单节点起步 | MinIO（S3 后端） |
| **ClamAV** | 集成开源（GPLv2） | Docker 单节点起步 | - |
| **clamav-rest** | 集成开源（MIT） | Docker 单节点起步 | ClamAV |
| **NextAuth.js v5** | 集成开源（ISC） | npm 安装 | PKGM-Web |
| **LlamaIndex** | 集成开源（MIT） | pip 安装 | PKGM-Wiki |
| **minio-js / minio-py** | 集成开源（Apache 2.0） | npm/pip 安装 | 前后端 |
| **markdown-it / gray-matter** | 集成开源 | npm 安装 | PKGM-Web |
| **bge-m3** | 集成开源（MIT） | 模型下载 | PKGM-Wiki（嵌入服务） |
| **FastEmbed** | 集成开源（Apache 2.0） | pip 安装 | Qdrant 嵌入 |
| **OpenTelemetry** | 集成开源（Apache 2.0） | npm/pip 安装 | 审计模块 |

---

## 4. 子项目改造清单

### 4.1 PKGM-Manager

| 改造项 | 技术路径 | 新增/修改文件 |
|--------|---------|--------------|
| 5 个 Provider 抽象 | **完全自建** | `manager/lib/providers/`（5 个文件） |
| `create-tenant` 技能 | **完全自建**（扩展 `create-agent`） | `manager/skills/create-tenant/SKILL.md` |
| `delete-tenant` 技能 | **完全自建** | `manager/skills/delete-tenant/SKILL.md` |
| 审计日志聚合 | **完全自建**（借鉴 OpenTelemetry 模式） | `manager/lib/audit.py` |
| Keycloak API 调用 | **集成开源**（`python-keycloak` 库） | `manager/lib/providers/keycloak_provider.py` |
| Forgejo API 调用 | **集成开源**（`pyforgejo` 或 requests） | `manager/lib/providers/forgejo_provider.py` |
| MinIO 客户端 | **集成开源**（`minio-py`） | `manager/lib/providers/minio_provider.py` |
| OpenClaw 接入 | **保留现有** | `manager/scripts/` |

### 4.2 PKGM-Wiki

| 改造项 | 技术路径 | 新增/修改文件 |
|--------|---------|--------------|
| Temporal Worker | **完全自建**（借鉴 Temporal Python SDK 示例） | `scripts/temporal_worker.py` |
| 6 个 Activity 适配 | **完全自建**（包装现有 SKILL.md） | `scripts/activities.py` |
| Qdrant 嵌入脚本 | **完全自建** + 借鉴 LlamaIndex | `scripts/embed_chunks.py` |
| Git Push 到 Forgejo | **集成开源**（`pygit2` 或 `GitPython`） | `scripts/git_pusher.py` |
| MinIO 缓存异步上传 | **集成开源**（`minio-py`） | `scripts/cache_uploader.py` |
| Logseq 投影生成 | **完全自建** | `scripts/logseq_projector.py` |
| **保持不变的 SKILL.md** | - | `skills/pkgm-*.md` 全部不变 |

### 4.3 PKGM-Web

| 改造项 | 技术路径 | 新增/修改文件 |
|--------|---------|--------------|
| NextAuth.js v5 集成 | **集成开源** | `src/lib/auth-v5.ts`（替换 `auth.ts`） |
| Middleware 改造 | **借鉴 NextAuth.js 模式** | `src/middleware.ts` |
| Forgejo Webhook | **集成开源**（`@octokit/webhooks` 借鉴） | `src/app/api/webhooks/forgejo/route.ts` |
| MinIO Webhook | **完全自建** | `src/app/api/webhooks/minio/route.ts` |
| RAG 搜索 API | **集成开源**（`@qdrant/js-client-rest`） | `src/app/api/rag/search/route.ts` |
| Qdrant 上传管道 | **集成开源**（Qdrant Client） | `src/lib/qdrant.ts` |
| Logseq 兼容层 | **完全自建** | `src/lib/logseq_compat.ts` |
| 范围问答 UI | **完全自建** | `src/app/rag/` |
| 上传 UI（Uppy） | **集成开源**（`@uppy/core` + `@uppy/tus`） | `src/app/upload/` |
| tusd 签名 API | **完全自建** | `src/app/api/upload/sign/route.ts` |
| 审计日志中间件 | **完全自建** + 借鉴 OTel | `src/middleware.ts`（扩展） |
| **保留的 Indexer** | - | `indexer/index.js` 不变 |
| **保留的 SQLite FTS5** | - | 数据库和索引逻辑不变 |

---

## 5. 部署拓扑

### 5.1 Phase 0 单机原型（Docker Compose）

```yaml
# docker-compose.yml (扩展)
services:
  # 现有 PKGM 服务
  pkgm-web: { ... }
  pkgm-indexer: { ... }
  
  # 新增基础设施
  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: start-dev
  
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
  
  temporal:
    image: temporalio/temporal:latest
    command: temporal server start-dev --ip 0.0.0.0
  
  temporal-ui:
    image: temporalio/ui:latest
    ports: ["8233:8080"]
  
  forgejo:
    image: codeberg.org/forgejo/forgejo:15.0
  
  qdrant:
    image: qdrant/qdrant:v1.18.1
  
  postgres:
    image: postgres:14  # 共享给 Keycloak/Temporal/Forgejo
  
  tusd:
    image: tusproject/tusd:latest
    command: -verbose -s3-bucket pkgm-data -s3-endpoint http://minio:9000
  
  clamav:
    image: clamav/clamav:latest
```

### 5.2 Phase 1+ 生产（K8s）

- Keycloak → StatefulSet + 外部 PostgreSQL + Infinispan 缓存
- MinIO → 4 节点分布式
- Temporal → Helm Chart + PostgreSQL（< 1k workflow/s）/ Cassandra（> 10k）
- Forgejo → 2 节点 + 外部 PostgreSQL + 共享 Git POSIX 存储
- Qdrant → 3 节点 + 副本因子 2
- tusd / ClamAV → 单 Pod 即可

---

## 6. 实施阶段路线图

### Phase 0：单机原型验证（2-3 周）

**目标**：验证 6 个组件协同工作，PKGM 管线能在多租基础设施上正确执行

- 部署 Docker Compose 全部 6 个组件
- PKGM-Wiki 新增 Temporal Worker（最小适配）
- PKGM-Manager 不动（继续本地 `create-agent`）
- PKGM-Web 加 `/api/rag/search`（Qdrant 测试）
- 用 1 个测试租户跑完整管线

### Phase 1：最小多租户 MVP（4-6 周）

**目标**：可邀请 5-10 个内测用户

- PKGM-Manager 扩展为 `create-tenant`（引入 5 个 Provider）
- PKGM-Web 替换认证：NextAuth.js v5 + Keycloak
- Forgejo 创建租户私有 Repo
- Web 端：上传 + 管线看板 + Wiki 浏览
- 全局语义问答（无范围过滤）

### Phase 2：完整体验（6-8 周）

**目标**：可公开注册的 Beta 版

- 范围问答（domain/tags/confidence 过滤）
- Logseq 桌面端 Git 同步（发布 post-commit hook 脚本）
- 管线报告前端可视化
- 租户配额 + Token 计量
- tusd + ClamAV 集成

### Phase 3：高级特性（持续）

- 知识图谱可视化（Neo4j 集成）
- 协作审阅（pkgm-architect UI）
- 静态站点生成导出
- K8s 多区域部署

---

## 7. 关键风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| MinIO 数据丢失 | 高 | 不挂 NFS，本地 XFS/ZFS；LFS 双写 |
| Forgejo Webhook 漏推 | 中 | Webhook 接收端做 Outbox 持久化 + 定期对账 |
| Temporal 学习成本 | 中 | Phase 0 先用 1 个 Workflow 验证，避免大规模上 |
| Keycloak 集成复杂度 | 中 | NextAuth.js v5 是官方推荐，参考示例多 |
| Logseq YAML Frontmatter 兼容 | 中 | 投影文件隔离，不污染原始仓库 |
| LLM 成本失控 | 中 | Temporal Rate Limiter 按租户限速 |
| 多组件运维复杂 | 高 | Phase 0 必须先打通 Docker Compose 编排 |

---

## 8. 与现有 PKGM 哲学的契合

| 哲学原则 | 是否保持 |
|---------|---------|
| 文件系统/Markdown 是唯一数据源 | ✅ 保持（Forgejo Repo + MinIO + 本地 files） |
| 业务逻辑与控制面/展示面分离 | ✅ 保持（PKGM 三项目边界不变） |
| SKILL.md 是 Agent 与管线交互的核心 | ✅ 保持（PKGM-Wiki 内部 SKILL.md 不变） |
| 渐进式演进（小步快跑） | ✅ 保持（Phase 0 → Phase 3） |
| SQLite 是索引缓存（可重建） | ✅ 保持（Indexer 逻辑不变） |

---

## 9. 一句话总结

> **三项目（PKGM-Manager / PKGM-Wiki / PKGM-Web）的协作边界不变，控制面引入 5 个 Provider 抽象，业务逻辑面加 Temporal Adapter，展示面重构认证并加 RAG。技术路径以"集成开源"为主线，仅在 Keycloak/MinIO/Forgejo/Qdrant/Temporal/NextAuth 等成熟组件之外做必要的自建代码。**