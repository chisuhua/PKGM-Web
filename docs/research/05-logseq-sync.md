# Logseq 云端同步方案调研报告 — 2026-07-17

## 概述

调研用户通过 Logseq 本地编辑 PKGM 生成的内容并同步回服务端的方案。

## 三个同步方案对比

| 维度 | A: Git 同步（推荐） | B: 原生 DB Sync | C: WebDAV/S3 插件 |
|------|-------------------|----------------|-------------------|
| **数据模型** | Markdown 文件 | DB Graph / SQLite | 页面对象 |
| **YAML 兼容** | ⚠️ Logseq 不完全支持 YAML Frontmatter | ❌ 需要 DB bridge | ⚠️ 插件重构可能丢失字段 |
| **冲突处理** | ✅ Git 三方合并 | ✅ t-before + checksum | ❌ 简单时间戳比较 |
| **桌面体验** | ✅ 内置 auto-commit | ✅ 原生 | ✅ 插件安装 |
| **移动端** | ⚠️ 需外部 Git client | ⚠️ 需自定义客户端适配 | ❌ 移动端不支持插件 |
| **Web** | ⚠️ 需 PKGM Git API | ✅ DB Web 可行 | ❌ |
| **终端用户安装** | 中 | 中 | 低 |
| **运维复杂度** | 低（复用 Forgejo） | 高（Node Adapter + SQLite） | 低 |
| **并发编辑** | ✅ 三方合并 | ✅ 最强（tx log） | ❌ 静默覆盖风险 |

## ✅ 推荐方案：Git 作为主要同步层

### 架构

```
PKGM Pipeline → Forgejo (租户 Private Repo)
     ↑               ↓ Git Clone/Push
     |          用户本地 Logseq
     |          (内置 Auto Commit)
     |
     └─── Push Webhook → PKGM Webhook Gateway → Pipeline Queue
```

### Logseq 内置 Git 的实际能力

Logseq OG Electron 版本内置了以下自动化：

```clojure
git init --separate-git-dir=<~/.logseq/git/.../.git>
git add --ignore-errors ./*
git commit -m "Auto saved by Logseq"
```

**但只负责 init/add/commit，不负责 pull/push。**

### 推荐的端到端 Git 流程

**用户桌面端**：
1. PKGM 创建租户 Forgejo Repo
2. 用户 `git clone` 到本地
3. 用 Logseq 打开该目录，开启 Git auto-commit
4. 配置 SSH key / credential
5. 由后台 agent 或 hook 执行 `git pull --rebase && git push`

**PKGM Pipeline 写入**（防止冲突）：
```
git fetch origin
git checkout main
git pull --rebase  # 优先保留人工编辑
# 应用 PKGM 生成的变更
git add && git commit
git push
```

**冲突处理原则**：
- ❌ 禁止 `git push --force`
- ❌ 禁止 `git reset --hard`
- ❌ 禁止 mtime 判断"谁更新"
- ✅ 冲突时生成 `.conflict.md` 或写入冲突队列
- ✅ 文件顶部追加 `## AI Updates` 区域，不覆盖人工内容

## ⚠️ 关键兼容性问题：YAML Frontmatter

Logseq **不完全支持标准 YAML Frontmatter**。当前源码中仍有：

```clojure
;; TODO support markdown YAML front matter
```

Logseq 属性是 `property:: value` 格式（行内），不是 `---` 区块。

### PKGM 需要做 Frontmatter 转换

```yaml
# PKGM 原始
---
title: "文档"
type: "daily"
tags: ["tag1", "tag2"]
status: "completed"
---
```

```markdown
# Logseq 兼容格式
title:: 文档
type:: daily
tags:: tag1, tag2
status:: completed
```

### 三种处理策略

| 方案 | 复杂度 | 安全性 |
|------|--------|--------|
| **1. 转换：PKGM Frontmatter → Logseq 属性** | 中 | ⚠️ 双向转换可能丢失 |
| **2. 分离：原始文件与 Logseq 投影分离** | 高 | ✅ 最安全 |
| **3. 迁移：PKGM 改用 Logseq DB graph** | 极高 | ❌ 与文件系统即数据源冲突 |

## ❌ C: WebDAV/S3 插件不推荐

当前候选插件 `logseq-super-sync` 的问题：
- 冲突检测基于时间戳（不是三方合并）
- WebDAV 默认 `overwrite: true`（静默覆盖）
- S3 不启用版本控制则直接覆盖
- 移动端不支持插件
- `listFiles()` 只筛选 `.zip`，页面备份不可见

## B: Logseq 原生 DB Sync（备选）

### 实际架构

当前社区自托管方案使用 **Logseq 官方 deps/db-sync Node Adapter**，**不是 CouchDB**：

```
Logseq Desktop/Mobile
    | WebSocket + HTTP
Logseq db-sync Node Adapter
    ├── index.sqlite
    ├── graphs/<graph-id>/*.sqlite
    └── assets/
```

### 多租户改造代价

如果采用 DB Sync，需要：
1. 增加 `tenant_id → user_id → graph_id` 映射
2. JWT 中包含 `tenant_id`
3. PKGM ↔ DB Bridge（Pipeline 生成的 Markdown 需通过 transaction API 写入 DB）
4. Web 编辑器不能绕过 DB Sync 直接改 Markdown（否则两条并发写路径冲突）

### CouchDB 作为备选

如果选择 CouchDB per-database 方案：
- 每个租户独立 database（`tenant_<uuid>`）
- Database security object 做隔离
- 需要 Sync Gateway 代理（隐藏真实库名）

**代价**：大量小 database 的 shard/replica/compat 管理复杂。

## 总结：推荐策略

| 平台 | 方案 |
|------|------|
| **桌面用户** | Git（Forgejo Repo + Logseq Auto Commit + Hook Push） |
| **Web 浏览** | PKGM Git Gateway（commit API + conflict preview） |
| **移动端** | 外部 Git Client 或 PKGM Web 编辑 |
| **实时协同**（未来） | Logseq DB Sync（需 Bridge 改造）|