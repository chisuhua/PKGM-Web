# PKGM 文档索引

> **创建日期**：2026-07-17  
> **最后更新**：2026-07-18  
> **状态**：设计中（待评审）

本文档是 PKGM 项目文档的总入口，包含架构文档、调研文档、ADR 议题和讨论计划。

---

## 0. ADR 讨论计划

> 📌 **[adr-discussion-plan.md](./adr-discussion-plan.md)** -- ADR 讨论的总跟踪表

当前讨论状态：
- Wave 0（前置）：adr-000 执行模型 -- ⏳ 待讨论
- Wave 1（P0 阻塞）：adr-001, 006, 007, 002, 008 -- ⏳ 待讨论
- Wave 2（关键项）：adr-010, 016, 017 -- ⏳ 待讨论
- Wave 3（重要项）：adr-024, 003, 004, 005, 009, 025, 026, 020, 030 -- ⏳ 待讨论
- Wave 4（低优先级）：adr-028, 018, 019, 029 -- ⏳ 待讨论

---

## 1. 架构文档

### 1.1 全栈架构

| 文档 | 说明 | 状态 |
|------|------|------|
| [architecture/fullstack-architecture.md](./architecture/fullstack-architecture.md) | 全栈架构总纲，定义 12 个功能模块的归属和技术路径 | 设计中 |

### 1.2 子项目架构

| 项目 | 定位 | 文档 | 状态 |
|------|------|------|------|
| **PKGM-Web** | 展示面（Presentation Plane） | [architecture/architecture.md](./architecture/architecture.md) | 设计中 |
| **PKGM-Manager** | 控制面（Control Plane） | [../PKGM-Manager/docs/architecture/architecture.md](../PKGM-Manager/docs/architecture/architecture.md) | 设计中 |
| **PKGM-Wiki** | 业务逻辑面（Business Logic Plane） | [../PKGM-Wiki/docs/architecture/architecture.md](../PKGM-Wiki/docs/architecture/architecture.md) | 设计中 |

### 1.3 归档文档

| 项目 | 归档位置 | 说明 |
|------|---------|------|
| PKGM-Web | [archive/architecture-v2-2026-04.md](./archive/architecture-v2-2026-04.md) | 2026-04 版本展示层架构 |
| PKGM-Manager | [../PKGM-Manager/docs/archive/architecture-v2-2026-04.md](../PKGM-Manager/docs/archive/architecture-v2-2026-04.md) | 2026-04 版本控制面架构 |
| PKGM-Wiki | [../PKGM-Wiki/docs/archive/architecture-v2-2026-04.md](../PKGM-Wiki/docs/archive/architecture-v2-2026-04.md) | 2026-04 版本业务逻辑层架构 |

---

## 2. 调研文档

基础设施调研（01-07）+ 知识管理规范调研（08-12）：

| 编号 | 文档 | 主题 | 关键结论 |
|------|------|------|---------|
| 01 | [research/01-auth-multi-tenant.md](./research/01-auth-multi-tenant.md) | 多租户认证方案 | 推荐 Keycloak Organizations |
| 02 | [research/02-object-storage-minio.md](./research/02-object-storage-minio.md) | 对象存储 | 推荐 MinIO Prefix 隔离 |
| 03 | [research/03-workflow-temporal.md](./research/03-workflow-temporal.md) | 工作流引擎 | 推荐 Temporal + 每租户 Task Queue |
| 04 | [research/04-git-forgejo.md](./research/04-git-forgejo.md) | Git 仓库 | 推荐 Forgejo 每租户私有 Repo |
| 05 | [research/05-logseq-sync.md](./research/05-logseq-sync.md) | Logseq 同步 | 推荐 Git 同步为主 + DB Sync 备选 |
| 06 | [research/06-vector-qdrant.md](./research/06-vector-qdrant.md) | 向量检索 | 推荐 Qdrant Payload 过滤 + BGE-M3 |
| 07 | [research/07-three-projects-mapping.md](./research/07-three-projects-mapping.md) | 三项目映射 | 定义三项目与新架构的映射关系 |
| 08 | [research/08-okf-document-standards.md](./research/08-okf-document-standards.md) | OKF 与文档规范 | OKF v0.1 跨组织互操作标准；PKGM 需投影层；8 种规范对比 |
| 09 | [research/09-kg-interoperability.md](./research/09-kg-interoperability.md) | KG 互操作与语义 Web | JSON-LD 渲染、块级建模、backlinks 实现、PROV-DM 适用性 |
| 10 | [research/10-sekv-karpathy-multiprojection.md](./research/10-sekv-karpathy-multiprojection.md) | SeKV/Karpathy/多投影 | SeKV≠SetKV（LLM 推理优化）；Karpathy Wiki 与 PKGM 85% 同构；多后端编译构想 |
| 11 | [research/11-compilation-backend.md](./research/11-compilation-backend.md) | 可插拔编译后端 | Haystack DAG + Skyframe 增量 + 工厂注册；16 个扩展点；三层架构设计 |
| 12 | [research/12-neuro-symbolic-dag.md](./research/12-neuro-symbolic-dag.md) | 神经-符号-DAG 混合记忆 v3.0 | 四层异质记忆体；DAG 导航引擎；语义锚点；RIA 编译纪律；作为 adr-030 DAG 编译后端候选方案 |

---

## 3. ADR 议题（待讨论）

共 22 个关键决策点，按项目/归属分类。讨论后将保存为 ADR 文档。编号规则详见各小节注释。

### 3.1 PKGM-Web 展示面（5 个议题）

| 编号 | 议题 | 优先级 | 说明 | 归档位置 |
|------|------|--------|------|---------|
| adr-001 | 认证方案选型 | 🔴 高 | NextAuth.js v5 + Keycloak OIDC vs 保留自签 JWT vs Supabase Auth | `docs/adr/adr-001-auth-scheme.md` |
| adr-002 | Webhook Gateway 持久化策略 | 🔴 高 | Outbox 模式（SQLite）vs Redis Stream vs 消息队列 vs MinIO queue_dir | `docs/adr/adr-002-webhook-persistence.md` |
| adr-003 | 双引擎搜索架构 | 🟡 中 | 独立端点 + 前端切换 vs 统一端点 vs 混合查询 | `docs/adr/adr-003-search-architecture.md` |
| adr-004 | 上传服务实现方式 | 🟡 中 | Presigned URL + tusd vs Next.js API Route vs MinIO SDK | `docs/adr/adr-004-upload-service.md` |
| adr-005 | Logseq 兼容层（合并投影生成） | 🟢 低 | PKGM-Web 端转换 vs PKGM-Wiki 端生成 vs 用户手动导出（含 `.logseq/` 投影策略，合并原 adr-027） | `docs/adr/adr-005-logseq-compat.md` |

### 3.2 PKGM-Manager 控制面（5 个议题）

| 编号 | 议题 | 优先级 | 说明 | 归档位置 |
|------|------|--------|------|---------|
| adr-006 | Provider 抽象层设计模式 | 🔴 高 | 统一接口 + 独立实现 vs Facade 模式 vs Event-Driven | `PKGM-Manager/docs/adr/adr-006-provider-pattern.md` |
| adr-007 | 租户注册表存储方案 | 🔴 高 | JSON 文件 vs SQLite vs PostgreSQL（Oracle 建议升级为 P0） | `PKGM-Manager/docs/adr/adr-007-tenant-registry.md` |
| adr-008 | 跨系统事务处理策略 | 🔴 高 | 反向清理 vs Saga 模式 vs 两阶段提交 | `PKGM-Manager/docs/adr/adr-008-cross-system-transaction.md` |
| adr-009 | 审计日志存储方案 | 🟡 中 | JSONL 文件 vs SQLite vs Elasticsearch | `PKGM-Manager/docs/adr/adr-009-audit-log.md` |
| adr-010 | create-agent 迁移策略 | 🔴 高 | 并行运行 + 灰度切换 vs 直接替换 vs 废弃旧技能 | `PKGM-Manager/docs/adr/adr-010-create-agent-migration.md` |

### 3.3 PKGM-Wiki 业务逻辑面（6 个议题）

| 编号 | 议题 | 优先级 | 说明 | 归档位置 |
|------|------|--------|------|---------|
| adr-024 | Temporal Worker 适配层设计 | 🔴 高 | 每个 Activity 委托给 SKILL.md vs 重构为 Python 函数 vs 混合模式 | `PKGM-Wiki/docs/adr/adr-024-temporal-worker.md` |
| adr-025 | Git Push 到 Forgejo 策略 | 🟡 中 | rebase --theirs vs separate branch vs 区域覆写 | `PKGM-Wiki/docs/adr/adr-025-git-push-strategy.md` |
| adr-026 | Qdrant 嵌入模型选择 | 🟡 中 | BGE-M3 vs OpenAI text-embedding-3-small vs Jina Embeddings v2 | `PKGM-Wiki/docs/adr/adr-026-embedding-model.md` |
| adr-028 | MinIO 缓存异步上传策略 | 🟢 低 | 订阅文件写入事件 vs 定时任务 vs 管线完成后批量上传 | `PKGM-Wiki/docs/adr/adr-028-cache-upload.md` |
| adr-029 | 块级建模与块级引用 | 🟢 低 | 块级建模（block_uuid）vs heading 锚点 vs 不做（基于 Roam/Logseq 调研） | `PKGM-Wiki/docs/adr/adr-029-block-modeling.md` |
| adr-030 | 可插拔编译后端架构 | 🟡 中 | 三层架构 vs 仅扩展 wiki-gen vs 不做（基于 Haystack+Skyframe+GraphRAG 调研） | `PKGM-Wiki/docs/adr/adr-030-compilation-backend.md` |

> **注 1**：原 adr-027（Logseq 投影生成策略）已合并入 adr-005（Logseq 兼容层），不再单独立项。
> **注 2**：PKGM-Wiki 当前有 20 个已确认 ADR（adr-001~023，含跳过编号），另有 4 个未来议题（adr-031~034）见本文 §附录。详见 [PKGM-Wiki ADR 索引](../PKGM-Wiki/docs/adr/README.md)。上述 6 个新议题续接编号从 adr-024 开始。

### 3.4 跨项目议题（6 个议题）

| 编号 | 议题 | 优先级 | 说明 | 归档位置 |
|------|------|--------|------|---------|
| adr-000 | 执行模型：ADR-017 vs Temporal Worker | 🔴 高 | 废弃 ADR-017 vs Activity 调 OpenClaw API vs 双轨制（阻塞所有其他议题） | `docs/adr/adr-000-execution-model.md` |
| adr-016 | 跨项目状态共享协议 | 🔴 高 | Webhook vs 共享 DB vs 事件总线 vs 轮询 | `docs/adr/adr-016-cross-project-state.md` |
| adr-017 | Phase 0 单机资源估算 | 🟡 中 | 单机最低配置评估（16 GB RAM + 4 vCPU） | `docs/adr/adr-017-resource-estimation.md` |
| adr-018 | 可观测性与告警策略 | 🟡 中 | OTel + Loki + Grafana vs 简化方案 | `docs/adr/adr-018-observability.md` |
| adr-019 | MinIO 数据备份与恢复 | 🟡 中 | 纠删码 vs 跨节点复制 vs 定时快照 | `docs/adr/adr-019-minio-backup.md` |
| adr-020 | OKF 互操作与知识库导出规范 | 🟡 中 | 完整互操作 vs 仅导出投影（PKGM -> OKF）vs 不支持（基于 OKF v0.1 调研） | `docs/adr/adr-020-okf-interop.md` |

> **编号规则**：PKGM-Wiki 议题使用 adr-024+ 续接已有 adr-001~023；跨项目/Web/Manager 议题使用全局编号 adr-000~020。详见 [adr-discussion-plan.md §6](./adr-discussion-plan.md)。

---

## 4. 优先级汇总

| 优先级 | 议题数量 | 议题列表 |
|--------|---------|---------|
| 🔴 高（P0） | 9 | adr-000, 001, 002, 006, 007, 008, 010, 016, 024 |
| 🟡 中（P1） | 11 | adr-003, 004, 009, 017, 018, 019, 020, 025, 026, 028, 030 |
| 🟢 低（P2） | 2 | adr-005, 029 |

**讨论顺序**：按 Wave 分组推进，依赖驱动而非纯优先级。Wave 0（adr-000）阻塞所有其他议题。详见 [adr-discussion-plan.md §3](./adr-discussion-plan.md)。

---

## 5. 后续步骤

1. **逐个讨论 ADR 议题**：每个议题讨论后，将决策结果保存为 ADR 文档
2. **保存位置**：
   - PKGM-Web: `docs/adr/adr-xxx-标题.md`
   - PKGM-Manager: `PKGM-Manager/docs/adr/adr-xxx-标题.md`
   - PKGM-Wiki: `PKGM-Wiki/docs/adr/adr-xxx-标题.md`
3. **更新架构文档**：根据 ADR 决策更新对应的架构文档

---

## 6. 文档维护

- **架构文档**：每次重大变更后更新
- **调研文档**：技术选型确定后归档
- **ADR 文档**：决策确定后立即创建，不可修改（如需变更，创建新的 ADR 替代）

---

## 7. 文档维护流程

### 新增/修改 ADR 议题时，必须同步更新

1. **本项目**的 `README.md`（docs/ 或 docs/adr/）
2. **PKGM 文档总索引** `docs/README.md` 的 §3 ADR 议题列表
3. **ADR 讨论计划** `docs/adr-discussion-plan.md` 的议题总览表

### 审核检查点

每次提交涉及 ADR 的修改前，确认三项目的 README 中 ADR 引用一致，并确保 `docs/adr-discussion-plan.md` 的议题总览已同步。

### 废弃文档

- 文件顶部添加 Deprecated 标记 + 替代文档路径
- 引用方全部更新为新路径
- 至少保留一个 Git 版本周期后再删除

### Submodule 文档更新（PKGM-Wiki / PKGM-Manager）

这两个项目是 Git submodule，修改其文档需要两步提交：

```bash
# 1. 在子模块内提交
cd PKGM-Wiki && git add <file> && git commit -m "..." && cd ..
# 2. 在主仓库更新子模块指针
git add PKGM-Wiki && git commit -m "..."
```

遗漏第二步会导致主仓库的子模块指针停留在旧版本，CI/其他开发者拉取不到文档更新。

---

*本文档为 PKGM 项目文档的总入口。*  
*当前状态：设计中（待评审）*

---

## 附录：历史待定议题（迁移自 PKGM-Wiki PENDING_ADR_TOPICS.md）

以下议题来自已废弃的 `PKGM-Wiki/docs/PENDING_ADR_TOPICS.md`，为 Phase 0 范围外的未来议题，暂不展开讨论。

| 原编号 | 新编号 | 标题 | 说明 | 优先级 |
|--------|--------|------|------|--------|
| ADR-018 | adr-031 | 知识老化与更新 | Wiki 页面过时标记、定期审查、自动归档 | 🟢 P2 |
| ADR-019 | adr-032 | 多模型协作策略 | LLM 模型分工、降级策略、成本控制 | 🟡 P1 |
| ADR-020 | adr-033 | 知识图谱查询语言 | 图谱查询方式（CLI/API/NLQ） | 🟢 P2 |
| ADR-021 | adr-034 | 跨项目知识绑定 | 项目与知识图谱的绑定方式 | 🟢 P2 |