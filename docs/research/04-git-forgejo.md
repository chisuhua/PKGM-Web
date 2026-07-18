# Forgejo/Gitea 多租户 Git 仓库调研报告 — 2026-07-17

## 概述

为 PKGM 多租户系统选择 Git 仓库服务——每个租户拥有独立的 Git 仓库，内容由 PKGM 管线生成，用户可通过 Logseq/Obsidian 本地编辑后同步。

## Forgejo vs Gitea

| 维度 | Forgejo | Gitea |
|------|---------|-------|
| 起源 | 2022 年从 Gitea 分叉 | 原始项目（从 Gogs 分叉） |
| 治理 | Codeberg e.V. 非营利 | Gitea Ltd. 公司主导 |
| 当前版本 | v16.0.0 (2026-07-16) | v1.27.0 (2026-07-13) |
| 近半年提交 | ~1,171 (默认分支) | ~1,012 (默认分支) |
| LTS | v15 (支持到 2027-07-15) | 无明确 LTS |
| 外部 JWT | ✅ v16 Authorized Integrations | ❌ |

**推荐：新部署选 Forgejo，已运行 Gitea 不必迁移。**

## 租户仓库模型

### 推荐：组织级隔离 + 每租户 Private Repo

```
Forgejo Instance
└── organization: pkgm-tenants
    ├── tenant-{immutable-id-1}  (private)
    ├── tenant-{immutable-id-2}  (private)
    └── ...
```

**关键设计**：
- 租户 ID 不可变（UUID），避免改名导致路径变化
- 仓库名 = `tenant-{id}`，不暴露用户名
- 所有仓库放在同一组织下，简化权限管理

### 模板仓库结构

```text
.gitea/template         # 标记为模板（隐藏文件，不进入生成仓库）
README.md               # ${REPO_NAME} 等变量展开
00_Raw_Sources/.gitkeep
01_Wiki/.gitkeep
02_System/.gitkeep
03_Engine/.gitkeep
```

**注意**：模板不包含 webhook、deploy key、真实文件。

## Provisioning API 流程

```bash
# 1. 从模板创建仓库
POST /api/v1/repos/pkgm-system/pkgm-tenant-template/generate
{ "owner": "pkgm-tenants", "name": "tenant-01JABCXYZ",
  "private": true, "git_content": true, "webhooks": false }

# 2. 添加协作者
PUT /api/v1/repos/pkgm-tenants/tenant-01JABCXYZ/collaborators/{username}
{ "permission": "write" }

# 3. 注入 Deploy Key
POST /api/v1/repos/pkgm-tenants/tenant-01JABCXYZ/keys
{ "title": "pkgm-pipeline", "key": "ssh-ed25519 AAAA...",
  "read_only": false }

# 4. 创建 Push Webhook
POST /api/v1/repos/pkgm-tenants/tenant-01JABCXYZ/hooks
{ "type": "forgejo", "events": ["push"], "branch_filter": "refs/heads/main",
  "config": { "url": "...", "content_type": "json", "secret": "..." } }
```

## Webhook 可靠性

**关键发现**：Forgejo/Gitea 的 webhook 投递**没有自动重试语义**。

- 每个事件只发一次 HTTP 请求
- 只有 2xx 算成功
- 失败只记录日志，不重新入队
- 未投递任务在重启时重新加载（`is_delivered=false`）

### PKGM 推荐架构

```
Forgejo Push → Webhook Gateway → Outbox (持久化) → Pipeline Queue
                ↑ HMAC 验证       ↑ 去重键：repo+ref+after
```

Webhook 接收端**立即返回 202**，不做耗时操作。Pipeline 失败时从 Outbox 重消费。

## Git LFS

| 内容 | 存储方式 |
|------|---------|
| Markdown / YAML / JSON | Git 直接管理 |
| 图片 / PDF / 大型附件 | **Git LFS** |
| LFS 后端 | MinIO/S3 对象存储 |

## SSH Deploy Key 策略

| 主体 | 密钥方式 | 权限 |
|------|---------|------|
| PKGM Pipeline | 每租户独立 Deploy Key（ed25519） | `read_only: false`（需要 push）|
| 人类用户 | 个人 Forgejo SSH Key + Collaborator | `write` 或 `read` |

**每租户独立 Key**：泄露影响范围最小，删除租户可精确撤销。

## 规模估算

| 租户数 | 资源建议 |
|--------|---------|
| 100 (低频) | 2 vCPU, 2-4 GB RAM, SQLite 可用 |
| 500 | 4 vCPU, 4-8 GB RAM, PostgreSQL |
| 1000 | 4-8 vCPU, 8-16 GB RAM, PostgreSQL + Redis |

1000 个 Markdown 仓库在单机合理，前提是：
- 大文件进 LFS
- 关闭 Issues/PR/Wiki/Packages/Actions
- webhook 快速返回

## HA 演进路径

```
单机本地 SSD → Docker 单节点 → 外部 PostgreSQL + S3 LFS → Redis
    → 共享 Git POSIX 存储 → 双 Forgejo 节点
```

不要直接从单机 SQLite 跳到多节点 NFS。

## Forgejo v16 Authorized Integrations

Forgejo v16 支持外部 JWT 直接访问 Forgejo API/Git：

```
PKGM Manager → 签发短期 JWT → Forgejo API
    ↑ iss, aud, exp, JWKS 签名
```

适合后台 pipeline 服务间调用，但不适合代表人类用户提交。