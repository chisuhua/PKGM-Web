# PKGM 多租户架构调研报告

> 调研日期：2026-07-17
> 调研范围：将 PKGM 从「单人本地工具」升级为「多租户 SaaS 平台」所需的全栈技术选型

## 背景

PKGM 当前是一个三项目架构的知识管理系统（PKGM-Manager + PKGM-Wiki + PKGM-Web），采用「共享进程 + 文件系统隔离」的单实例多租户模式。本次调研旨在为全栈化多租户 SaaS 平台选择基础设施组件。

## 参考系统对比

| 系统 | 用户模型 | 多租户支持 | 隔离方式 |
|------|---------|-----------|---------|
| **SilverBullet** | 单用户，Space=目录 | ❌ 官方拒绝，建议反代 | 进程隔离（1进程=1Space） |
| **SiYuan Note** | 单共享密码，无账户 | ❌ 仅 Publish 只读服务 | 文件目录+加密笔记本 |
| **PKGM（当前）** | JWT 用户认证 | ✅ 已有基础骨架 | 文件目录+应用层 |

## 调研覆盖范围

| # | 主题 | 关键结论 | 文件 |
|---|------|---------|------|
| 01 | **认证方案** | Keycloak Organizations 推荐 | [01-auth-multi-tenant.md](01-auth-multi-tenant.md) |
| 02 | **对象存储** | MinIO + Prefix 隔离 + Presigned URL | [02-object-storage-minio.md](02-object-storage-minio.md) |
| 03 | **工作流引擎** | Temporal + 每租户 Task Queue | [03-workflow-temporal.md](03-workflow-temporal.md) |
| 04 | **Git 多租户** | Forgejo + 每租户独立 Repo | [04-git-forgejo.md](04-git-forgejo.md) |
| 05 | **编辑同步** | Git 为主 + CouchDB 备选 | [05-logseq-sync.md](05-logseq-sync.md) |
| 06 | **向量检索** | Qdrant + Payload 过滤隔离 + BGE-M3 | [06-vector-qdrant.md](06-vector-qdrant.md) |
| 07 | **三项目映射** | PKGM-Manager/Wiki/Web 的改造方案与衔接点 | [07-three-projects-mapping.md](07-three-projects-mapping.md) |

## 核心推荐

### 认证 → Keycloak Organizations
- 免费自托管，JWT `tenant_id` claim 通过 Protocol Mapper 注入
- Organizations 模型匹配 PKGM 用户结构（1 user ≈ 1 org）
- NextAuth.js v5 官方支持
- 避免 Authentik（多租户锁定企业版）、Supabase（与文件系统架构冲突）
- [详见 01-auth-multi-tenant.md](01-auth-multi-tenant.md)

### 对象存储 → MinIO
- 单 Bucket + Prefix 隔离（`pkgm-data/{tenant_id}/uploads/`）
- Presigned PUT URL + tusd 可恢复上传
- Webhook 通知 → 触发管线
- ClamAV 异步扫描隔离区
- [详见 02-object-storage-minio.md](02-object-storage-minio.md)

### 工作流编排 → Temporal
- 单 Namespace + 每租户 Task Queue（Pattern 1）
- 6 Phase 管线 = 1 个 Workflow + 6 个 Activity
- LLM 调用禁用 provider retry，用 Temporal 接管
- Signal + wait_condition 实现人工审核
- [详见 03-workflow-temporal.md](03-workflow-temporal.md)

### Git 仓库 → Forgejo
- 每租户独立 Private Repo（从模板创建）
- Push Webhook → Pipeline 触发
- SSH Deploy Key 每租户独立
- `webhooks:false` 模板创建后再单独配置
- [详见 04-git-forgejo.md](04-git-forgejo.md)

### Logseq 同步 → Git 为主
- **桌面端**：Git clone 仓库到 Logseq，内置 auto-commit
- **Web/移动端**：PKGM Web Git Gateway API
- **原生 DB Sync**：仅当需要实时协同且可接受 DB graph 模型
- Logseq 的 YAML Frontmatter 兼容性问题需要处理
- [详见 05-logseq-sync.md](05-logseq-sync.md)

### 向量检索 → Qdrant
- 单 Collection + `is_tenant=True` Payload 过滤（不建多 Collection）
- BGE-M3 模型（1024d dense + sparse + ColBERT multi-vector）
- Hybird Search（Dense RRF + Sparse BM25）
- LlamaIndex 集成
- [详见 06-vector-qdrant.md](06-vector-qdrant.md)

## 分阶段实施建议

### Phase 0：单机原型（2-3周）
- MinIO + Qdrant + Forgejo + Temporal（Docker Compose）
- PKGM 管线封装为 Temporal Workflow
- Git Sync 桌面 Logseq 直连 Forgejo

### Phase 1：多租户 MVP（4-6周）
- Keycloak Organizations + 租户管理 API
- 注册 → 自动创建 Git Repo + Qdrant Collection
- Web 前端：上传 + 管线看板 + Wiki 浏览

### Phase 2：完整体验（6-8周）
- 范围问答（domain/tags 过滤器）
- 改造版 logseq-sync-server（Web/移动端）
- 管线可视化 + 审计 + 配额

### Phase 3：高级特性（持续）
- 知识图谱可视化（Neo4j）
- 协作审阅（Temporal Signal）
- 导出 + 计量 + 计费