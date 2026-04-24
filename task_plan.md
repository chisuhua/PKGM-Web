# PKGM P2 修改实施计划

**创建日期**: 2026-04-24
**状态**: 进行中
**优先级**: P2-2 > P2-3 > P2-1

---

## 目标

按照评审建议，实施三个 P2 问题的修改：

### P2-2: 统一 Frontmatter 规范引用 ✅
- 修改 PKGM-Manager/docs/ARCHITECTURE.md - 简化 Frontmatter 章节
- 修改 PKGM-Web/docs/ARCHITECTURE.md - 简化 Frontmatter 章节
- 修改 PKGM-Wiki/docs/ARCHITECTURE.md - 添加权威来源声明

### P2-3: 监控和可观测性 (修正版)
- Web: 新增 `/api/health` 端点
- Web: 新增 `/api/metrics` 端点
- Indexer: 新增 `/metrics` 端点（不修改现有日志格式）

### P2-1: SSE 多实例 Redis Pub/Sub
- 新建 `web/src/lib/sse-broker.ts`
- 修改 `web/src/app/api/events/route.ts`
- 修改 `docker-compose.yml` 添加 Redis 服务
- 更新文档

---

## 实施进度

### Phase 1: P2-2 文档统一 (预计 0.5 天)
- [ ] 1.1 修改 PKGM-Manager Frontmatter 章节
- [ ] 1.2 修改 PKGM-Web Frontmatter 章节
- [ ] 1.3 修改 PKGM-Wiki 添加权威来源声明

### Phase 2: P2-3 Web 可观测性 (预计 0.5 天)
- [ ] 2.1 新建 `web/src/app/api/health/route.ts`
- [ ] 2.2 新建 `web/src/lib/metrics.ts`
- [ ] 2.3 新建 `web/src/app/api/metrics/route.ts`
- [ ] 2.4 更新文档

### Phase 3: P2-3 Indexer 可观测性 (预计 0.5 天)
- [ ] 3.1 在 `indexer/index.js` 添加 `/metrics` 端点
- [ ] 3.2 更新文档

### Phase 4: P2-1 SSE Redis Pub/Sub (预计 1-2 天)
- [ ] 4.1 确认 redis npm 依赖
- [ ] 4.2 新建 `web/src/lib/sse-broker.ts`
- [ ] 4.3 修改 `web/src/app/api/events/route.ts`
- [ ] 4.4 修改 `docker-compose.yml` 添加 Redis
- [ ] 4.5 更新文档

---

## 决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-04-24 | P2-3 日志不改为 JSON | 保持 console.log 兼容性 |
| 2026-04-24 | Indexer /health 已存在 | 跳过，仅添加 /metrics |

---

## 错误记录

| 错误 | 阶段 | 解决 |
|------|------|------|
| (无) | - | - |
