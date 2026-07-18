# 设计

## 1. 新建 `PKGM-Manager/docs/README.md`

Manager 文档索引只引用 `docs/README.md` 中与本项目相关的部分，不从零创建完整索引——遵循"一份事实"原则。

```markdown
# PKGM-Manager 文档索引

> **创建日期**：2026-07-18
> **状态**：维护中

本文档是 PKGM-Manager 控制面（Control Plane）的文档索引。

---

## 1. 架构文档

| 文档 | 说明 | 状态 |
|------|------|------|
| [architecture/architecture.md](./architecture/architecture.md) | 控制面架构设计 | 设计中 |

## 2. ADR 文档

PKGM-Manager 的 ADR 议题（adr-006~010）在 [PKGM 文档索引](../docs/README.md) §3.2 中定义，待讨论后创建。

当前 Manager 相关的 ADR 议题：
- adr-006（Provider 抽象层，🔴 P0）
- adr-007（租户注册表，🔴 P0）
- adr-008（跨系统事务，🔴 P0）
- adr-009（审计日志，🟡 P1）
- adr-010（create-agent 迁移，🔴 P0）

详见：[ADR 讨论计划](../docs/adr-discussion-plan.md)

## 3. 文档维护

新增/修改文档时，请同时更新 [PKGM 文档索引](../docs/README.md) 中的对应条目。

---

*本文档为 PKGM-Manager 控制面的文档入口。*
```

## 2. 修改 `docs/README.md` —— 新增维护契约

在第 6 节"文档维护"之后、附录之前新增（附录由 Change cleanup-pending-adr 添加，§7 须在附录之前）：

```markdown
## 7. 文档维护流程

### 新增/修改 ADR 议题时，必须同步更新

1. **本项目**的 `README.md`（docs/ 或 docs/adr/）
2. **PKGM 文档总索引** `docs/README.md` 的 §3 ADR 议题列表
3. **ADR 讨论计划** `docs/adr-discussion-plan.md` 的议题总览表

### 审核检查点

每次提交涉及 ADR 的修改前，运行：

```bash
# 检查三项目的 README 是否一致引用
grep -c "adr-0" docs/README.md PKGM-Wiki/docs/adr/README.md
# 确保 docs/adr-discussion-plan.md 的议题总览已同步
```

### 废弃文档

- 文件顶部添加 Deprecated 标记 + 替代文档路径
- 引用方全部更新为新路径
- 至少保留一个 Git 版本周期后再删除
```

## 3. 修改 `PKGM-Wiki/docs/adr/README.md` —— 新增维护契约

在第 5 节"文档维护"后新增第 6 节：

```markdown
## 6. 跨项目文档同步

本索引的更新必须与以下文件保持同步：

- **PKGM 文档总索引** `docs/README.md` §3.3（PKGM-Wiki 议题列表）
- **ADR 讨论计划** `docs/adr-discussion-plan.md` §2.2（议题总览表）
- **全栈架构文档** `docs/architecture/fullstack-architecture.md`（如涉及架构变更）

新增 ADR 议题时，优先在上述文件中同步，确保三项目文档一致。
```