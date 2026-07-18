# PKGM 三项目关系梳理与改造建议（基于调研结论）

> 生成日期：2026-07-17
> 上下文：在 6 篇调研文档（docs/research/01-06.md）的基础上，重新审视 PKGM-Manager、PKGM-Wiki、PKGM-Web 三个项目的边界与协作关系

---

## 1. 现有三项目职责回顾

| 项目 | 当前职责 | 关键资产 |
|------|---------|----------|
| **PKGM-Manager** | 多租户用户/Agent 创建 | `create-agent` 技能 + `init_user_wiki.sh` + 用户目录模板 |
| **PKGM-Wiki** | 知识管线 6 阶段执行 | `pkgm-pipeline` 等 9 个 SKILL.md + `atomic_write.js` + scripts |
| **PKGM-Web** | 多租户展示（仅渲染） | Next.js + Indexer + JWT 登录 + SSE |

### 当前协作流（自顶向下）

```
用户注册流程：
  [管理员触发] → create-agent 技能 → mkdir + init_user_wiki.sh + SOUL.md → OpenClaw 注册
                                                                        ↓
知识生产流程：
  [用户对话] → 用户专属 Agent → pkgm-pipeline → atomic_write → content/app/wiki/
                                                                        ↓
展示流程：
  [chokidar 监控] → Indexer → SQLite FTS5 → Next.js 渲染 + SSE 推送
```

---

## 2. 三项目与新架构组件的映射关系

新调研引入了 6 个组件：**Keycloak、MinIO、Temporal、Forgejo、Qdrant、（Logseq via Git）**。把这些组件映射到现有项目，需要先回答一个问题：

> **它们应该作为新的子项目，还是嵌入到现有项目里？**

### 建议的映射表

| 新组件 | 推荐归属 | 替换/扩展现有项目 | 理由 |
|--------|---------|------------------|------|
| **Keycloak Organizations** | 新独立服务（基础设施层） | 替换现有 PKGM-Web 的 `lib/auth.ts` 和 `middleware.ts` 的 JWT | 外部服务，避免重复造轮子；JWT claim 注入用 Protocol Mapper |
| **MinIO** | 新独立服务 | 替换现有 `meta/index.db` 之外的所有文件存储 | 文件即数据源——但 MinIO 比 NFS 更适合大文件/多租户 |
| **Temporal** | 新独立服务 + 改造 PKGM-Wiki | 现有 PKGM-Wiki 的 6 阶段脚本封装成 Activity | 保持 PKGM-Wiki 作为"技能脚本"身份（业务逻辑层），Temporal 作为执行引擎 |
| **Forgejo** | 新独立服务 | 当前 Git 操作由 Agent 直接做（无统一 Git 仓库） | 加入 Git 服务后，用户能用 Logseq 本地编辑 |
| **Qdrant** | 扩展 PKGM-Web | 当前已有 SQLite FTS5，加 Qdrant 提供语义搜索 | FTS5（关键字）+ Qdrant（语义）双引擎并存 |
| **Logseq Sync** | 通过 Forgejo Git | 无现有对应物 | 由 Forgejo Git 解决，无需额外组件 |

---

## 3. 新的协作架构（融合后）

```
┌──────────────────────────────────────────────────────────────────────┐
│                 基础设施层 (新，独立部署)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Keycloak   │  │   MinIO     │  │  Temporal   │  │   Forgejo   │  │
│  │ (Auth/Org)  │  │ (对象存储)   │  │ (管线引擎)   │  │ (Git 服务)  │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
│                          ┌─────────────┐                              │
│                          │   Qdrant    │                              │
│                          │ (语义搜索)   │                              │
│                          └─────────────┘                              │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          控制面 (Management Plane)                     │
│                        PKGM-Manager (扩展)                           │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │
│  │ create-tenant    │  │ delete-tenant    │  │ manage-quota     │    │
│  │ (扩展 create-    │  │                  │  │ (新增)           │    │
│  │  -agent)         │  │                  │  │                  │    │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘    │
│         │                       │                                      │
│         ▼                       ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  Provider 抽象层 (新)                                       │     │
│  │   - KeycloakProvider (org/identity)                         │     │
│  │   - MinIOProvider (bucket/prefix)                           │     │
│  │   - ForgejoProvider (repo creation, deploy key)             │     │
│  │   - TemporalProvider (workflow start, signal)               │     │
│  │   - QdrantProvider (collection management)                  │     │
│  └─────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    业务逻辑层 (Business Logic Plane)                   │
│                       PKGM-Wiki (不变 + 适配)                         │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │
│  │ pkgm-pipeline    │  │ pkgm-wiki-gen    │  │ pkgm-architect   │    │
│  │ (封装为 Activity)│  │                  │  │ (审核 Signal)    │    │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘    │
│                                                                      │
│  保持现状：6 阶段管线技能，调用 LLM，写 Markdown                       │
│  新增适配层：与 Forgejo Repo 交互（push/pull），与 MinIO 交互（素材）   │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      展示面 (Presentation Plane)                      │
│                     PKGM-Web (重写认证 + 增加搜索)                     │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │
│  │  NextAuth v5     │  │  Indexer         │  │  RAG Search UI   │    │
│  │ (替换 jose 自签) │  │ (保留 + 扩展)     │  │ (新)             │    │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘    │
│                                                                      │
│  双引擎索引：SQLite FTS5 (关键字) + Qdrant (语义)                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. 关键改造点（按项目拆解）

### 4.1 PKGM-Manager：从「用户目录管理器」升级为「多云 Provider 协调器」

#### 当前状态
- `create-agent` 技能：mkdir + init_user_wiki.sh + 注册到 OpenClaw
- 完全本地操作，没有外部依赖

#### 改造目标
- 引入 **Provider 抽象层**，把每个外部系统封装成可调用的接口
- `create-tenant` 技能调用所有 Provider 完成跨系统资源创建

#### 具体改造点

| 步骤 | 当前 | 改造后 |
|------|------|--------|
| Step 2 | `test -d users/{username}` | + 检查 Keycloak Organization 是否已存在 |
| Step 3 | mkdir 本地目录 | + MinIO 创建 prefix（`pkgm-data/{username}/`）|
| Step 3.5 | init_user_wiki.sh | + Forgejo 从模板生成 Repo |
| Step 4 | 写 SOUL.md | 改为 **注入到 Forgejo Repo**（Agent 直接从 Repo 读 SOUL.md）|
| Step 5 | 注册到 OpenClaw | 不变 |
| Step 6 | 重启 Gateway | 不变 |
| **新增 Step 7** | — | + Qdrant 准备（不动，仅记录 tenant_id 到 metadata）|
| **新增 Step 8** | — | + 生成 Forgejo Deploy Key，注入 Repo |
| **新增 Step 9** | — | + 创建 Forgejo Webhook → pkgm-web Gateway |

#### 删除项
- ❌ 删除本地 `meta/index.db` 的创建步骤（交给 Indexer 启动时自动创建）
- ❌ 不再单独管理 `agent-workspace/SOUL.md`（由 Forgejo Repo 替代）

---

### 4.2 PKGM-Wiki：保持「技能脚本」身份，Pipeline 接入 Temporal

#### 当前状态
- 9 个 SKILL.md（`pkgm-pipeline`, `pkgm-extract`, `pkgm-link`, `pkgm-wiki-gen`, `pkgm-lint` 等）
- 每个技能由 Agent 在对话中触发，**没有持久化执行状态**
- 共享磁盘 `users/{username}/` 目录

#### 改造目标
- 保持 PKGM-Wiki 内部技能不变
- **新增 Temporal Adapter 层**（在 PKGM-Wiki 内，作为 Worker 注册 Activity）
- 管线输出从"本地 Git commit"改为"push 到 Forgejo Repo"

#### 具体改造点

```python
# 伪代码：Temporal Adapter（在 PKGM-Wiki 内新增）
# 文件: PKGM-Wiki/scripts/temporal_worker.py

@activity.defn
async def ingest_activity(input: IngestInput) -> IngestOutput:
    """委托给现有 pkgm-ingest 技能"""
    subprocess.run(["pkgm-ingest", input.user, input.file])
    return read_output(input.user, "ingest")

@activity.defn
async def extract_activity(input: ExtractInput) -> ExtractOutput:
    """委托给现有 pkgm-extract 技能"""
    subprocess.run(["pkgm-extract", input.user, input.draft])
    return read_output(input.user, "extract")

@workflow.defn
class PkgmPipelineWorkflow:
    @workflow.run
    async def run(self, input):
        # 顺序调用现有 6 个 Phase（每个 Phase 一个 Activity）
        ingest = await workflow.execute_activity(ingest_activity, ...)
        extract = await workflow.execute_activity(extract_activity, ...)
        link = await workflow.execute_activity(link_activity, ...)
        wiki_gen = await workflow.execute_activity(wiki_gen_activity, ...)
        # wiki_gen 完成后等待人工审核 Signal
        await workflow.wait_condition(lambda: self.approved is not None, 
                                      timeout=timedelta(hours=24))
        lint = await workflow.execute_activity(lint_activity, ...)
        report = await workflow.execute_activity(report_activity, ...)
        return report
```

#### 不变的部分
- ✅ SKILL.md 文件（Agent 仍可手动触发）
- ✅ atomic_write.js（文件写入仍走该机制）
- ✅ LLM 调用逻辑
- ✅ 缓存机制（`03_Engine/cache/`）

#### 改变的协作模式
- **之前**：Agent 触发 → 6 阶段同步执行 → 失败全丢
- **之后**：Temporal 调度 → 6 阶段 Activity → 失败可断点续传 → LLM 自动重试 → 审核 Signal

---

### 4.3 PKGM-Web：从「单进程多租户渲染」升级为「前端 + 索引 + 网关」

#### 当前状态
- Next.js 单一进程 + jose JWT + Middleware
- Node.js Indexer 监控所有用户目录
- SSE 实时推送

#### 改造目标
- **认证**：jose 自签 JWT → NextAuth.js v5 + Keycloak OIDC
- **搜索**：增加 Qdrant 语义搜索 API（保留现有 SQLite FTS5）
- **新增 Webhook Gateway**：接收 Forgejo/MinIO Webhook
- **新增 RAG UI**：让用户做范围问答

#### 具体改造点

| 模块 | 当前 | 改造后 |
|------|------|--------|
| 认证 | `lib/auth.ts` 自签 HS256 | NextAuth.js v5 + Keycloak OIDC Provider |
| Middleware | 自写 username 校验 | 改读 `tenant_id` claim，路径改为 `/docs/{tenant_id}/` |
| 索引器 | `indexer/index.js` 单进程 | 不变（保留 SQLite FTS5 用于关键字搜索）|
| 搜索 API | 仅 `/api/search` (FTS5) | 新增 `/api/rag/search` (Qdrant) + 保留旧的 |
| SSE | 已有 | 不变 |
| **新增 API** | — | `/api/webhooks/forgejo` 接收 Push |
| **新增 API** | — | `/api/webhooks/minio` 接收对象事件 |
| **新增 UI** | — | 范围问答界面（domain/tags 过滤）|

#### 关键决策：保留 SQLite FTS5

FTS5（关键字全文搜索）和 Qdrant（语义搜索）解决不同问题：
- FTS5：精确匹配英文/数字/部分中文
- Qdrant：语义相似度、中文友好

**建议两者并存**，前端提供切换 Tab：

```
┌─────────────────────────────────────┐
│ [关键字] [语义]                       │
├─────────────────────────────────────┤
│ 搜索框: [_____________]              │
│ 范围: domain=D01, confidence>3       │
└─────────────────────────────────────┘
```

---

## 5. 三项目的协作流（改造后）

### 5.1 用户注册流程

```
管理员触发 create-tenant
    │
    ├─→ KeycloakProvider: create Organization + 用户
    │
    ├─→ MinIOProvider: 验证 prefix 不存在
    │
    ├─→ ForgejoProvider: 从模板生成 Repo + 注入 Deploy Key + 创建 Webhook
    │
    ├─→ 文件系统: mkdir users/{tenant_id}/
    │
    └─→ OpenClaw Gateway: 注册 Agent（保留现有逻辑）
```

### 5.2 用户上传文档流程

```
用户浏览器 → PKGM-Web 上传 API
    │
    ├─→ MinIO Provider: 生成 Presigned PUT URL（5 分钟过期）
    │
    └─→ 浏览器直传 MinIO
            │
            ▼ (MinIO 异步 webhook)
    pkgm-web /api/webhooks/minio
            │
            ├─→ 启动 Temporal Workflow: PkgmUploadWorkflow
            │       └─→ ingest → extract → link → wiki-gen
            │       └─→ wiki-gen 后等待审核 Signal
            │
            └─→ pkgm-web 通知用户："管线已启动，workflow ID = xxx"
```

### 5.3 用户本地编辑流程（Logseq 桌面）

```
用户 git clone Forgejo Repo
    │
    ▼
Logseq 打开本地目录（auto-commit 启用）
    │
    ▼ (用户编辑)
Logseq 提交本地 commit
    │
    ▼ (post-commit hook)
git fetch && git rebase
git push origin main
    │
    ▼ (Forgejo 异步 webhook)
pkgm-web /api/webhooks/forgejo
    │
    ├─→ 验证 HMAC + 幂等键 (repo+ref+after)
    │
    ├─→ 启动 Temporal Workflow: PkgmReindexWorkflow
    │       └─→ 仅扫描变更的文件 → 更新 Indexer FTS5 + Qdrant
    │
    └─→ SSE 推送给在线浏览器："文档已更新"
```

### 5.4 用户问答流程

```
用户浏览器 → /api/rag/search?q=...
    │
    ▼
Qdrant Query (BGE-M3 嵌入 + 检索)
    │
    ├─→ tenant_id filter (强制)
    ├─→ 可选: domain filter, confidence range
    ├─→ Hybrid: dense + sparse + ColBERT 精排
    │
    ▼
返回 Top-K Markdown 文档
    │
    ▼ (前端 LLM 包装)
    │
用户看到带引用来源的回答
```

---

## 6. 与现有 PKGM 三项目的具体衔接点

### 6.1 PKGM-Manager 改造代码示例（伪代码）

```python
# manager/skills/create-tenant/SKILL.md 描述
# 实现位于 manager/scripts/create_tenant.py

class TenantProvider(Protocol):
    def setup(self, tenant_id: str) -> Result: ...

class KeycloakProvider:
    def setup(self, tenant_id: str):
        # 调用 Keycloak Admin API
        requests.post(f"{KEYCLOAK}/admin/realms/pkgm/organizations",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"name": tenant_id, "domains": [{"name": f"{tenant_id}.example.com"}]})

class MinIOProvider:
    def setup(self, tenant_id: str):
        # 仅校验 prefix 不存在（实际数据由 Pipeline 写入）
        requests.head(f"{MINIO}/pkgm-data/{tenant_id}/",
            auth=aws_auth)  # 404 = OK

class ForgejoProvider:
    def setup(self, tenant_id: str):
        # 1. 从模板生成 Repo
        repo = requests.post(f"{FORGEJO}/api/v1/repos/pkgm-system/tenant-template/generate",
            json={"owner": "pkgm-tenants", "name": f"tenant-{tenant_id}", "private": True})
        # 2. 生成 Deploy Key
        keypair = subprocess.run(["ssh-keygen", "-t", "ed25519", "-f", f"/secrets/{tenant_id}"], capture_output=True)
        # 3. 注入
        requests.post(f"{FORGEJO}/api/v1/repos/pkgm-tenants/tenant-{tenant_id}/keys",
            json={"title": "pkgm-pipeline", "key": read_pub_key, "read_only": False})
        # 4. 创建 Webhook
        requests.post(f"{FORGEJO}/api/v1/repos/pkgm-tenants/tenant-{tenant_id}/hooks",
            json={"type": "forgejo", "events": ["push"], 
                  "config": {"url": WEBHOOK_URL, "secret": gen_secret()}})

# 主流程
def create_tenant(tenant_id: str):
    # 1. Keycloak
    KeycloakProvider().setup(tenant_id)
    # 2. MinIO
    MinIOProvider().setup(tenant_id)
    # 3. Forgejo
    ForgejoProvider().setup(tenant_id)
    # 4. 本地目录（兼容现有架构）
    subprocess.run(["bash", "init_user_wiki.sh", tenant_id])
    # 5. OpenClaw Agent
    subprocess.run(["openclaw", "agents", "add", f"pkgm-{tenant_id}"])
```

### 6.2 PKGM-Wiki 改造最小改动

```python
# 新增: PKGM-Wiki/scripts/temporal_worker.py
# 该文件注册 6 个 Activity，分别委托给现有 6 个 SKILL.md 的脚本

# 其余 PKGM-Wiki 文件**完全不变**
# - SKILL.md 不变（Agent 仍可手动触发）
# - atomic_write.js 不变
# - pipeline 内部逻辑不变
```

### 6.3 PKGM-Web 改造要点

```typescript
// web/src/lib/auth.ts - 替换为 NextAuth v5
// web/src/middleware.ts - 读取 tenant_id 而非 username
// web/src/app/api/webhooks/forgejo/route.ts - 新增
// web/src/app/api/webhooks/minio/route.ts - 新增
// web/src/app/api/rag/search/route.ts - 新增 Qdrant 集成
```

---

## 7. 改造成本估算

| 项目 | 改动量 | 主要工作 | 风险 |
|------|--------|---------|------|
| **PKGM-Manager** | 中（新增 1 个技能 + Provider 层） | 引入 Keycloak/MinIO/Forgejo API 调用 | Provider 失败的部分回滚 |
| **PKGM-Wiki** | 极小（新增 1 个 Python 文件） | Temporal Worker + 6 个 Activity 适配 | 保持 SKILL.md 兼容 |
| **PKGM-Web** | 大（认证重构 + 新增 Webhook + RAG） | NextAuth v5 替换自签 JWT | 期间需要双模式运行 |

---

## 8. 三项目的关系本质不变

**重要观察**：即使引入了 6 个新基础设施组件，**三项目的协作边界依然成立**：

| 维度 | 不变 |
|------|------|
| 控制面 | PKGM-Manager 仍负责租户生命周期 |
| 业务逻辑 | PKGM-Wiki 仍负责知识生产（LLM 调用、图谱） |
| 展示面 | PKGM-Web 仍负责渲染和搜索 |
| 数据源 | 仍以「文件系统/Markdown」为唯一权威 |

**新增的部分**：
- 6 个基础设施是「执行容器」，不是「逻辑载体」
- 它们替换了原本「单机本地」的某些能力，但不接管业务逻辑

---

## 9. 一句话总结

> **PKGM-Manager 升级为多云 Provider 协调器；PKGM-Wiki 加 Temporal Adapter 获得持久化执行能力；PKGM-Web 引入 NextAuth v5 + Qdrant + Webhook Gateway 补齐认证和搜索能力。三项目协作边界不变，控制面/业务逻辑/展示面的分层依然成立。**