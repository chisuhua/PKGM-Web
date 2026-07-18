# ADR 讨论计划

> **创建日期**：2026-07-17  
> **最后修订**：2026-07-18（v1.3）  
> **状态**：进行中  
> **跟踪方式**：本文档 + todo 列表  
> **讨论结果归档**：各项目的 `docs/adr/` 目录

---

## 1. 讨论原则

1. **前置议题优先**：adr-000 阻塞所有其他议题，必须先解决
2. **一次一个议题**：每个议题充分讨论后形成结论，写入 ADR 文件
3. **结论不可修改**：ADR 一旦确认，如需变更则创建新 ADR 替代
4. **讨论记录留存**：每个议题的讨论过程记录在本文档中
5. **依赖驱动顺序**：被依赖的议题先讨论

---

## 2. 议题全景图

### 2.1 依赖关系

```
adr-000 (执行模型)
    │
    ├──> adr-024 (Temporal Worker 适配) ──┐
    │                                     │
    │                                     ▼
    │                          adr-026 (嵌入模型)
    │                          adr-028 (缓存上传)
    │
    ├──> adr-001 (认证方案)
    │        │
    │        ▼
    │   adr-002 (Webhook 持久化)
    │
    ├──> adr-025 (Git Push 策略)
    │
    └──> adr-006 (Provider 抽象)
             │
             ├──> adr-007 (租户注册表) ──> adr-008 (跨系统事务)
             │                                │
             │                                ▼
             │                          adr-010 (迁移策略)
             │
             └──> adr-016 (跨项目状态共享)
```

> **注**：PKGM-Wiki 议题使用 `adr-024`~`adr-030` 编号，续接 PKGM-Wiki 已有的 `adr-001`~`adr-023`；其他议题使用全局编号 `adr-000`~`adr-020`。详见 §6 编号规则。

### 2.2 议题总览

| 编号 | 标题 | 项目 | 优先级 | 状态 | 依赖 |
|------|------|------|--------|------|------|
| **Wave 0：前置** | | | | | |
| adr-000 | 执行模型：ADR-017 vs Temporal Worker 矛盾 | 跨项目 | 🔴 P0 | ⏳ 待讨论 | 无 |
| **Wave 1：P0 阻塞项** | | | | | |
| adr-001 | 认证方案选型 | PKGM-Web | 🔴 P0 | ⏳ 待讨论 | adr-000 |
| adr-006 | Provider 抽象层设计 | PKGM-Manager | 🔴 P0 | ⏳ 待讨论 | adr-000 |
| adr-007 | 租户注册表存储 | PKGM-Manager | 🔴 P0 | ⏳ 待讨论 | adr-006 |
| adr-002 | Webhook Gateway 持久化 | PKGM-Web | 🔴 P0 | ⏳ 待讨论 | adr-001 |
| adr-008 | 跨系统事务处理 | PKGM-Manager | 🔴 P0 | ⏳ 待讨论 | adr-006, adr-007 |
| **Wave 2：P1 关键项** | | | | | |
| adr-010 | create-agent 迁移策略 | PKGM-Manager | 🔴 P0 | ⏳ 待讨论 | adr-006, adr-008 |
| adr-016 | 跨项目状态共享协议 | 跨项目 | 🔴 P0 | ⏳ 待讨论 | adr-006 |
| adr-017 | Phase 0 单机资源估算 | 跨项目 | 🟡 P1 | ⏳ 待讨论 | 无 |
| **Wave 3：P2 重要项** | | | | | |
| adr-024 | Temporal Worker 适配层设计 | PKGM-Wiki | 🔴 P0 | ⏳ 待讨论 | adr-000 |
| adr-003 | 双引擎搜索架构 | PKGM-Web | 🟡 P1 | ⏳ 待讨论 | 无 |
| adr-004 | 上传服务实现 | PKGM-Web | 🟡 P1 | ⏳ 待讨论 | 无 |
| adr-005 | Logseq 兼容层（合并 adr-027 投影生成） | 跨项目 | 🟢 P2 | ⏳ 待讨论 | 无 |
| adr-009 | 审计日志存储 | PKGM-Manager | 🟡 P1 | ⏳ 待讨论 | 无 |
| adr-025 | Git Push 策略 | PKGM-Wiki | 🟡 P1 | ⏳ 待讨论 | adr-000 |
| adr-026 | Qdrant 嵌入模型 | PKGM-Wiki | 🟡 P1 | ⏳ 待讨论 | adr-024 |
| adr-020 | OKF 互操作与知识库导出规范 | 跨项目 | 🟡 P1 | ⏳ 待讨论 | 无 |
| adr-030 | 可插拔编译后端架构 | PKGM-Wiki | 🟡 P1 | ⏳ 待讨论 | 无 |
| **Wave 4：P3 低优先级** | | | | | |
| adr-028 | MinIO 缓存异步上传 | PKGM-Wiki | 🟢 P2 | ⏳ 待讨论 | adr-024 |
| adr-018 | 可观测性与告警策略 | 跨项目 | 🟡 P1 | ⏳ 待讨论 | 无 |
| adr-019 | MinIO 数据备份与恢复 | 跨项目 | 🟡 P1 | ⏳ 待讨论 | 无 |
| adr-029 | 块级建模与块级引用 | PKGM-Wiki | 🟢 P2 | ⏳ 待讨论 | 无 |

> **注**：编号采用双轨方案。PKGM-Wiki 新议题使用 `adr-024`~`adr-030`，续接 PKGM-Wiki 已有的 `adr-001`~`adr-023`；跨项目/Web/Manager 议题使用全局编号 `adr-000`~`adr-020`。详见 §6 编号规则。

---

## 3. 讨论波次

> **说明**：Wave 分组以**讨论顺序**（依赖驱动）为主，优先级（P0~P3）为辅。因此部分 Wave 内可能混合多个优先级 -- 例如 Wave 2 以 P0 为主但含 P1 议题。各议题的准确优先级见 §2.2 总览表。

### Wave 0：前置议题（1 个）

**目标**：解决 PKGM-Wiki ADR-017（脚本/Agent 边界）与 Temporal Worker 执行模型的根本矛盾，确定 Temporal Activity 的 LLM 调用方式。本议题仅决定执行模型，适配层设计见 adr-024。

| 议题 | 核心问题 | 选项概要 | 预期产出 |
|------|---------|---------|---------|
| adr-000 | Python 脚本能否直接调 LLM？还是必须通过 Agent？ | A: 废弃 ADR-017 / B: Activity 调 OpenClaw API / C: 双轨制 | adr-000-execution-model.md |

---

### Wave 1：P0 阻塞项（5 个）

**目标**：确定认证、Provider、注册表、Webhook、事务的核心架构决策。

| 议题 | 核心问题 | 选项概要 | 预期产出 |
|------|---------|---------|---------|
| adr-001 | 认证方案 | NextAuth v5 + Keycloak vs 自签 JWT vs Supabase | adr-001-auth-scheme.md |
| adr-006 | Provider 设计模式 | 统一接口 vs Facade vs Event-Driven | adr-006-provider-pattern.md |
| adr-007 | 租户注册表存储 | JSON vs SQLite vs PostgreSQL | adr-007-tenant-registry.md |
| adr-002 | Webhook 持久化 | Outbox(SQLite) vs Redis Stream vs MQ vs MinIO queue_dir | adr-002-webhook-persistence.md |
| adr-008 | 跨系统事务 | 反向清理 vs Saga vs 2PC | adr-008-cross-system-transaction.md |

---

### Wave 2：关键项（3 个，含 P0+P1）

**目标**：解决迁移、跨项目通信、资源评估。

| 议题 | 核心问题 | 选项概要 | 预期产出 |
|------|---------|---------|---------|
| adr-010 | create-agent 迁移 | 并行运行 vs 直接替换 vs 废弃 | adr-010-create-agent-migration.md |
| adr-016 | 跨项目状态共享 | Webhook vs 共享 DB vs 事件总线 | adr-016-cross-project-state.md |
| adr-017 | Phase 0 资源估算 | 单机最低配置评估 | adr-017-resource-estimation.md |

---

### Wave 3：重要项（9 个，含 P0+P1+P2）

**目标**：Temporal 适配层、搜索、上传、Logseq、审计、Git Push、嵌入模型、OKF 互操作、编译后端。

| 议题 | 核心问题 | 选项概要 | 预期产出 |
|------|---------|---------|---------|
| adr-024 | Temporal Worker 适配层设计 | Activity 委托 SKILL.md vs 重构 Python 函数 vs 混合模式 | adr-024-temporal-worker.md |
| adr-003 | 双引擎搜索 | 独立端点 vs 统一端点 vs 混合查询 | adr-003-search-architecture.md |
| adr-004 | 上传服务 | Presigned URL vs tusd vs 混合（按大小切换） | adr-004-upload-service.md |
| adr-005 | Logseq 兼容（含投影，合并 adr-027） | Web 端转换 vs Pipeline 端生成 vs 双向同步 | adr-005-logseq-compat.md |
| adr-009 | 审计日志 | JSONL vs SQLite vs Elasticsearch | adr-009-audit-log.md |
| adr-025 | Git Push 策略 | rebase --theirs vs separate branch vs 区域覆写 | adr-025-git-push-strategy.md |
| adr-026 | 嵌入模型 | BGE-M3 vs OpenAI vs Jina | adr-026-embedding-model.md |
| adr-020 | OKF 互操作与知识库导出 | 完整互操作 vs 仅导出投影 vs 不支持 | adr-020-okf-interop.md |
| adr-030 | 可插拔编译后端架构 | 三层架构 vs 仅扩展 wiki-gen vs 不做（基于 Haystack+Skyframe 调研） | adr-030-compilation-backend.md |

---

### Wave 4：低优先级（4 个，含 P1+P2）

**目标**：缓存、可观测性、备份、块级建模。

| 议题 | 核心问题 | 选项概要 | 预期产出 |
|------|---------|---------|---------|
| adr-028 | MinIO 缓存上传 | 文件事件 vs Cron vs 批量 | adr-028-cache-upload.md |
| adr-018 | 可观测性 | OTel + Loki + Grafana vs 简化方案 | adr-018-observability.md |
| adr-019 | MinIO 备份 | 纠删码 vs 跨节点复制 vs 定时快照 | adr-019-minio-backup.md |
| adr-029 | 块级建模与块级引用 | 块级建模 vs heading 锚点 vs 不做 | adr-029-block-modeling.md |

---

## 4. 议题详情

### adr-000：执行模型 -- ADR-017 vs Temporal Worker

**状态**：⏳ 待讨论  
**优先级**：🔴 P0（阻塞所有其他议题）  
**归属**：跨项目（影响 PKGM-Wiki + 全栈架构）

**背景**：
- 现有 PKGM-Wiki `adr-017-script-agent-boundary.md` 规定 Python 脚本层禁止调用 LLM
- 新架构的 Temporal Worker (`activities.py`) 是 Python 进程，需执行 LLM 密集型管线
- 代码骨架 `subprocess.run(["pkgm-ingest", ...])` 无法执行 SKILL.md 定义的 Agent 工作流

**范围**：本议题仅决定 **LLM 调用执行模型**（脚本能否直接调 LLM）。Temporal Activity 如何组织、是否委托 SKILL.md 等适配层设计问题，由 **adr-024** 讨论。

**选项**：
- **A：废弃 ADR-017** -- 承认 Temporal 模式下 Python 可直接调 LLM
- **B：Activity 调 OpenClaw API** -- Activity 不做 LLM 调用，HTTP 调 OpenClaw Gateway
- **C：双轨制** -- 手动触发走 Agent（SKILL.md），自动触发走 Python（新代码）

**Oracle 建议**：这是整个架构最严重的一致性问题，必须在 Phase 0 之前解决。

**影响范围**：PKGM-Wiki 架构文档 §2.2、全栈架构模块 4、所有 Temporal 相关 ADR

**讨论记录**：
> （待填写）

**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-001：认证方案选型

**状态**：⏳ 待讨论  
**优先级**：🔴 P0  
**归属**：PKGM-Web  
**依赖**：adr-000

**背景**：当前使用自签 JWT（`lib/auth.ts`），需升级到多租户认证。

**选项**：
- A：NextAuth.js v5 + Keycloak OIDC（推荐）
- B：保留自签 JWT + 扩展多租户
- C：Supabase Auth

**Oracle 补充**：
- 未评估 Keycloak 运维复杂度（JVM 调优、主题定制、realm export/import）
- Keycloak 26.x 版本号需验证（稳定版是 25.x）
- 现有"无密码输入即登录"行为如何迁移到 Keycloak？

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-006：Provider 抽象层设计

**状态**：⏳ 待讨论  
**优先级**：🔴 P0  
**归属**：PKGM-Manager  
**依赖**：adr-000

**选项**：
- A：统一接口 + 独立实现（推荐）
- B：Facade 模式
- C：Event-Driven

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-007：租户注册表存储

**状态**：⏳ 待讨论  
**优先级**：🔴 P0（Oracle 建议从中升级）  
**归属**：PKGM-Manager  
**依赖**：adr-006

**选项**：
- A：JSON 文件（推荐起步）
- B：SQLite
- C：PostgreSQL

**Oracle 补充**：
- 选项对比缺少关键维度：并发安全
- JSON 文件方案无法处理并发写入
- SQLite 是最佳选择（PKGM 哲学一致），但应明确 WAL 模式与多进程访问

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-002：Webhook Gateway 持久化

**状态**：⏳ 待讨论  
**优先级**：🔴 P0  
**归属**：PKGM-Web  
**依赖**：adr-001

**选项**：
- A：Outbox 模式（SQLite）（推荐）
- B：Redis Stream
- C：消息队列（Kafka/RabbitMQ）
- D：MinIO queue_dir（Oracle 补充）

**Oracle 补充**：
- 缺失选项 D：直接用 MinIO queue_dir 做事件缓冲
- Outbox + PKGM-Web SQLite 在 Docker 部署中有数据持久化风险

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-008：跨系统事务处理

**状态**：⏳ 待讨论  
**优先级**：🔴 P0  
**归属**：PKGM-Manager  
**依赖**：adr-006, adr-007

**选项**：
- A：反向清理（Compensating Transaction）（推荐）
- B：Saga 模式
- C：两阶段提交（2PC）

**Oracle 补充**：
- teardown 本身可能失败，需定义幂等性
- 建议：3 次重试失败 -> `orphans.jsonl` -> Cron 每 6 小时扫描

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-010：create-agent 迁移策略

**状态**：⏳ 待讨论  
**优先级**：🔴 P0  
**归属**：PKGM-Manager  
**依赖**：adr-006, adr-008

**选项**：A: 并行运行 / B: 直接替换 / C: 废弃旧技能

**Oracle 补充**：未提及已创建的历史租户如何迁移

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-016：跨项目状态共享协议（新增）

**状态**：⏳ 待讨论  
**优先级**：🔴 P0  
**归属**：跨项目  
**依赖**：adr-006

**背景**：PKGM-Manager 创建租户后，PKGM-Web 需要知道新租户存在（auth middleware 路由匹配）。

**选项**：
- A：PKGM-Manager -> PKGM-Web Webhook
- B：共享 DB（PKGM-Web 读 PKGM-Manager 的租户表）
- C：事件总线
- D：PKGM-Web 轮询 PKGM-Manager API

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-017：Phase 0 单机资源估算（新增）

**状态**：⏳ 待讨论  
**优先级**：🟡 P1  
**归属**：跨项目  
**依赖**：无

**背景**：Oracle 估算 Phase 0 单机至少需要 16 GB RAM + 4 vCPU。

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-024：Temporal Worker 适配层设计（新增）

**状态**：⏳ 待讨论  
**优先级**：🔴 P0  
**归属**：PKGM-Wiki  
**依赖**：adr-000

**背景**：adr-000 确定 LLM 调用执行模型后，需进一步决定 Temporal Activity 的代码组织方式 -- 如何将现有 SKILL.md 定义的工作流映射到 Temporal Activity 实现。

**选项**：
- A：每个 Activity 委托给 SKILL.md（保留 Agent 工作流语义）
- B：重构为 Python 函数（直接在 Worker 内实现，性能优先）
- C：混合模式（核心逻辑用 Python，LLM 密集步骤委托 SKILL.md）

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-005：Logseq 兼容层（合并 adr-027 投影生成）

**状态**：⏳ 待讨论  
**优先级**：🟢 P2  
**归属**：跨项目（PKGM-Web + PKGM-Wiki）  
**依赖**：无

**范围**：本议题合并原 adr-027（Logseq 投影生成策略）。讨论范围包括：
- Logseq 兼容层实现位置（Web 端 vs Wiki 端 vs 手动导出）
- `.logseq/` 投影生成策略（子目录 vs 同目录不同扩展名 vs 独立分支）

**选项**：
- A：PKGM-Web 端转换 + `.logseq/` 子目录投影
- B：PKGM-Wiki 端生成 + 同目录不同扩展名
- C：用户手动导出 + 独立分支

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-020：OKF 互操作与知识库导出规范（新增）

**状态**：⏳ 待讨论  
**优先级**：🟡 P1  
**归属**：跨项目（PKGM-Wiki 生成 + PKGM-Web 渲染）  
**依赖**：无

**背景**：Google 于 2026-06 发布开放知识格式（OKF）v0.1，以"Markdown + YAML frontmatter + 目录树"为载体的厂商中立标准，正在成为 AI Agent 消费知识库的通用格式。PKGM-Wiki 的 schema（12 实体类型 + 15 关系 + 完整溯源链）比 OKF 丰富得多，但无法导出为 OKF 格式供外部 Agent 消费。

**核心问题**：PKGM 是否支持 OKF 格式导出？如何将 rich schema 投影为 OKF minimal bundle？

**OKF 关键设计**：
- 仅 `type` 字段强制，其他字段由 producer 自定义且 consumer 必须保留
- 保留文件名 `index.md`（目录索引）和 `log.md`（变更日志）
- 用 inline markdown link 表达关系（禁止 frontmatter `links:` 字段）
- 消费者必须容忍 broken link（指向不存在的文件不是错误）
- 三原则：低约束、生产消费解耦、纯格式标准

**选项**：
- **A：完整 OKF 互操作** -- 双向导入导出，PKGM 可消费外部 OKF bundle，也可导出为 OKF
- **B：仅导出投影（推荐）** -- PKGM -> OKF 单向导出，rich schema 投影为 minimal bundle（保留核心字段，关系转为 inline link）
- **C：不支持 OKF** -- 保持封闭，不提供 OKF 导出能力

**影响范围**：
- PKGM-Wiki：需实现 schema 投影层（R01-R15 关系 -> inline markdown link，source_type/confidence 等字段保留或丢弃策略）
- PKGM-Web：需生成 `index.md` / `log.md` 保留文件名，渲染层支持 OKF 消费契约（容忍断链、保留未知字段）

**调研依据**：OKF v0.1 SPEC（GitHub: GoogleCloudPlatform/knowledge-catalog）、Obsidian/Foam/Logseq/Dataview 等 8 种规范对比、PKGM-Wiki schema V2.0 现状评估

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-029：块级建模与块级引用（新增）

**状态**：⏳ 待讨论  
**优先级**：🟢 P2  
**归属**：PKGM-Wiki  
**依赖**：无

**背景**：PKGM-Wiki 当前的图节点是文档级的（一个 .md = 一个节点）。Roam Research / Logseq 支持块级建模（一个段落/标题 = 一个可引用节点），通过 `block_uuid` 实现细粒度引用。PKGM-Wiki ADR-003 决策 E 明确"正文结构自由，最少约束" -- 引入块级建模是定位级决策。

**核心问题**：PKGM 是否从文档级图谱升级为块级图谱？

**选项**：
- **A：块级建模** -- 为每个 heading/段落生成 block_uuid，支持 `[[doc#block]]` 块级引用，Indexer 维护块级链接表
- **B：维持文档级 + heading 锚点（推荐）** -- 用 `[[doc#heading]]` 标准锚点实现粗粒度引用，不引入 block_uuid，保持 ADR-003 最少约束原则
- **C：不做** -- 维持纯文档级图谱，heading 级引用由渲染层处理

**影响范围**：
- 选项 A：需修改 schema.yaml（新增 block 实体类型）、Indexer（块级解析 + 块级链接表）、ADR-003（正文结构约束）
- 选项 B：仅需 Indexer 支持 heading 锚点解析，不改 schema
- 选项 C：无改动

**调研依据**：Roam Research（Datomic datoms + Datalog）、Logseq（DataScript + SQLite，path-refs 因存储过高被删除）、Obsidian Bases、ADR-003 决策 E

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### adr-030：可插拔编译后端架构（新增）

**状态**：⏳ 待讨论  
**优先级**：🟡 P1  
**归属**：PKGM-Wiki  
**依赖**：无（逻辑上关联 adr-000/007/024，但可并行讨论）

**背景**：PKGM 当前管线（ingest → extract → link → wiki-gen）只产出一个 markdown 格式。随着文档规模扩大和检索需求多样化，需要支持多个 LLM 编译后端，把同一份分析结果编译成不同形态的知识表示（块级摘要、本体对齐 KG、QA 对等），服务于不同检索场景。用户核心想法：「管线应该可以灵活添加不同的 LLM 编译后端」。

**核心问题**：PKGM 管线是否应支持多个可插拔 LLM 编译后端？后端注册、增量编译、缓存键如何设计？

**选项**：
- **A：三层架构（推荐）** -- Backend Registry（工厂注册模式）+ Pipeline DAG（Haystack 式）+ Incremental Engine（Skyframe 式 SkyKey/SkyValue），支持 wiki-gen / block-summary / ontology-kg / qa-pairs / 自定义后端
- **B：仅扩展现有 wiki-gen** -- 不引入注册表，直接在 wiki-gen 模板系统中追加新模板（如 `block-summary.md`、`kg-entity.md`）
- **C：不做** -- 保持单一后端，块级摘要/KG 编译通过独立脚本实现，不与管线集成

**关键设计要点**：
- 复合缓存键：`SHA256(source_hash ∥ backend_name ∥ strategy_ver ∥ model_id ∥ template_ver ∥ schema_ver)`
- 三层 disambiguation：alias → embedding(0.88) → LLM borderline
- 四层缓存：L1 内存 LRU → L2 SQLite → L3 MinIO（v3.0 规划）→ L4 Redis（可选）
- Chunking：Recursive Markdown-aware, 512 tokens, 64 overlap（PKGM 文档最稳默认）

**影响范围**：
- 选项 A：需新增 `CompileBackend` 抽象基类 + `03_Engine/backends/` 注册目录 + 升级 ADR-008 缓存键
- 选项 B：仅修改 `pkgm-wiki-gen` SKILL.md 和 `templates/`
- 选项 C：无改动

**调研依据**：Haystack 2.x Pipeline DAG、Bazel Skyframe 增量编译、GraphRAG 6 阶段管线、GitHub 8 个开源项目注册模式（vllm/pytorch/pandera/ray/sglang）、PKGM-Wiki 16 个扩展点分析

**讨论记录**：（待填写）  
**结论**：（待填写）  
**ADR 文件**：（待创建）

---

### Wave 3-4 其余议题

adr-003, adr-004, adr-009, adr-025, adr-026, adr-028, adr-018, adr-019 详情见 §2.2 议题总览表，讨论时再展开。

---

## 5. 讨论状态看板

| 状态 | 数量 | 议题 |
|------|------|------|
| ⏳ 待讨论 | 22 | adr-000, 001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 016, 017, 018, 019, 020, 024, 025, 026, 028, 029, 030 |
| 🔄 讨论中 | 0 | - |
| ✅ 已决定 | 0 | - |
| 🚫 已阻塞 | 0 | - |

---

## 6. 讨论规则

1. **每个议题讨论流程**：
   - 呈现背景和选项（引用调研文档）
   - 逐个分析选项优劣
   - 用户决策或要求补充信息
   - 写入 ADR 文件
   - 更新本文档状态

2. **阻塞规则**：
   - adr-000 未决定前，不讨论其他议题
   - 依赖项未决定时，被依赖项标记为 🚫 已阻塞

3. **ADR 文件格式**：
   - 遵循 PKGM-Wiki 已有 ADR 的质量标准
   - 包含：背景、决策、选项分析、影响、替代方案、修订历史

4. **编号规则**（双轨制）：
   - PKGM-Wiki 新议题：续接已有 `adr-001`~`adr-023`，从 `adr-024` 起编号，归档至 `PKGM-Wiki/docs/adr/`
   - 跨项目 / PKGM-Web / PKGM-Manager 议题：使用全局编号 `adr-000`~`adr-020`，归档至对应项目的 `docs/adr/`
   - 跨项目议题的 ADR 文件归档位置由议题归属决定（见各议题详情）
   - 当前 PKGM-Wiki 新议题已至 adr-030，全局编号已至 adr-020

---

## 7. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-07-17 | v1.0 | 创建讨论计划，基于 Oracle 审查建议整理 18 个议题 |
| 2026-07-17 | v1.1 | 修复编号冲突：PKGM-Wiki 议题改用 adr-024~028 续接已有 adr-001~023；拆分 adr-000（执行模型）与 adr-024（适配层设计）；adr-005 合并 adr-027；统一 Wave 命名避免优先级歧义；看板列出 19 个议题编号 |
| 2026-07-17 | v1.2 | 新增 2 个议题：adr-020（OKF 互操作与知识库导出规范，P1，基于 OKF v0.1 调研）、adr-029（块级建模与块级引用，P2，基于 Roam/Logseq 块级建模调研）；看板更新为 21 个议题 |
| 2026-07-18 | v1.3 | 新增 adr-030（可插拔编译后端架构，P1，基于 Haystack+Skyframe+GraphRAG 调研 + PKGM 16 个扩展点分析），看板更新为 22 个议题；新增调研 11-compilation-backend |

---

*本文档是 ADR 讨论的总跟踪表，每轮讨论后更新。*