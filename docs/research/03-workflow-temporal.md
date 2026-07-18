# Temporal 工作流引擎调研报告 — 2026-07-17

## 概述

Temporal.io 用于编排 PKGM 的 6 阶段管线（ingest → extract → link → wiki-gen → lint → report）在 multi-tenant 环境下的执行。

## 多租户隔离模型

### 四种官方模式

| 模式 | 隔离级别 | 防 Noisy-Neighbor | 规模上限 | PKGM 推荐 |
|------|---------|-------------------|---------|-----------|
| **1. 每租户 Task Queue**（Pattern 1） | Task Queue 级 | 强 | 数千 | ✅ **推荐** |
| 2. 单 TQ + Fairness Key | 概率加权 | 权重节流 | 数千 | 备选 |
| 3. 共享 Workflow TQ + 分离 Activity TQ | Activity 级 | Activity 级 | 数千 | 备选 |
| 4. 每租户 Namespace | 完整 | 完整 | < 10K | ❌ 过重 |

### 推荐：单 Namespace + `task-queue: pkgm-{username}`

```python
# 一个 Worker 进程轮询所有租户 Task Queue
workers = []
for tenant_id in assigned_tenants:
    task_queue = f"pkgm-{tenant_id}"
    w = Worker(client, task_queue=task_queue,
               workflows=[PkgmPipelineWorkflow],
               activities=[ingest, extract, link, wiki_gen, lint, report])
    workers.append(w)
```

**容量规划**：单 Worker 承载约 250 租户，1000 租户需 4 Worker Pods。

## PKGM 6 阶段管线建模

### Workflow = 6 阶段顺序编排，每阶段 1 个 Activity

```python
@workflow.defn
class PkgmPipelineWorkflow:
    @workflow.run
    async def run(self, input):
        # Phase 1: ingest (文件操作, 快速)
        ingest_result = await execute_activity(ingest, input,
            start_to_close_timeout=timedelta(minutes=2))

        # Phase 2-4: LLM 调用 (10-60s)
        for phase, fn in [("extract", extract), ("link", link), ("wiki_gen", wiki_gen)]:
            result = await execute_activity(fn, input,
                start_to_close_timeout=timedelta(minutes=3),
                retry_policy=LLM_RETRY)

        # Phase 5: lint (快速)
        lint_result = await execute_activity(lint, input,
            start_to_close_timeout=timedelta(seconds=30))

        # Phase 6: report
        report_result = await execute_activity(report, input)
```

### LLM 重试策略

```python
LLM_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=10),      # 避免 429
    backoff_coefficient=3.0,                       # 10s → 30s → 90s → 270s
    maximum_interval=timedelta(minutes=5),
    maximum_attempts=20,
    non_retryable_error_types=["ValidationError"],
)
```

**关键规则**：禁用 OpenAI/Anthropic provider-side retry（`max_retries=0`），让 Temporal 接管。

## Human-in-the-Loop 审核

### Signal + Query + wait_condition 标准模式

```python
@workflow.signal
def approve(self, note: str):
    self._approval = True

@workflow.signal
def reject(self, note: str):
    self._approval = False

@workflow.query
def pending_review(self) -> dict:
    return {"phase": self._current_phase, "preview": self._current_preview}

# 等待审核（24h 超时自动失败）
await workflow.wait_condition(lambda: self._approval is not None,
                              timeout=timedelta(hours=24))
```

**关键洞察**：`wait_condition` 不占线程——Temporal 存进 Event History，恢复时重放。

## SDK 选择

| SDK | 并发上限 | 内存 | PKGM 推荐度 |
|-----|---------|------|------------|
| **Python** | 100 | 中 | ✅ **首选**（与 PKGM-Wiki 同语言）|
| Go | 1000 | 最小 | ⚠️ 性能敏感时 |
| TypeScript | 40 | 较大 | ❌ |

## 部署路径

| 阶段 | 规模 | 部署方式 | 成本 |
|------|------|---------|------|
| Phase 0 | < 10 用户 | `temporal server start-dev` (Docker) | $0 |
| Phase 1 | 10-100 | Docker Compose + PostgreSQL | < $50/月 |
| Phase 2 | 100-1000 | K8s Helm + PostgreSQL + 4 Worker Pods | $300-600/月 |
| Phase 3 | 1000+ | K8s + Cassandra 3-node + Worker 自动扩缩 | $1,500+/月 |

## Temporal vs 替代方案

| 需求 | Temporal | Inngest | BullMQ |
|------|----------|---------|--------|
| 6 阶段断点续传 | ✅ Event History | ✅ Step State | ❌ |
| 多租户速率隔离 | ✅ (TQ Fairness) | ⚠️ (Concurrency Keys) | ❌ |
| 7 天审核等待 | ✅ Workflow 持久休眠 | ✅ Sleep | ❌ |
| Signal 审核推送 | ✅ 一流 API | ⚠️ 有限 | ❌ |
| Web UI Debug | ✅ 全功能 | ✅ | ⚠️ |

## PKGM 渐进式采纳

```
Phase 0(1周): 包成单一 Activity，验证 Temporal 可用
Phase 1(3周): 拆 6 个独立 Activity + retry policy
Phase 2(2周): 引入每租户 Task Queue
Phase 3(2周): HITL signal/query 审核
Phase 4(按需): K8s 部署
```