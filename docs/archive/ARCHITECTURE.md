# PKGM-Web 架构提案 v5.0

**版本**: V5.0
**创建日期**: 2026-04-16
**最后更新**: 2026-04-16
**基于**: 
- 轻量级 AI 文档中心架构 v2.0
- DevMate 架构评审
- 多租户隔离架构方案（A3）
- 实施路线文档（A2）
- PKGM-Manager Agent 管理方案
- 完整回滚与灾难恢复方案
- PKGM-Manager 引导流程 + JWT_SECRET 管理
**状态**: 待确认

---

## 1. 项目概述

### 1.1 定位

PKGM-Web 是 PKGM（Personal Knowledge Graph Manager）的**展示层**，负责：
- 渲染 AI Agent 生成的 Markdown 文档（日报、任务、知识图谱）
- 提供全文搜索能力
- 实时推送文档更新（SSE）
- **多租户隔离**：每个用户独立目录 + 独立 Agent + 独立 SQLite

### 1.2 核心技术栈

| 层级 | 技术选型 | 选型理由 |
|------|---------|---------|
| 前端框架 | **Next.js** | SSR/ISR + MDX + SSE 原生支持 |
| 数据库 | **SQLite + FTS5** | 零依赖、WAL 模式、高性能全文搜索 |
| 中文分词 | **@node-rs/jieba** | Rust 绑定，性能优于 jieba-wasm |
| 文件监控 | **chokidar + inotify** | 事件驱动，CPU 友好 |
| 实时推送 | **SSE (Server-Sent Events)** | 轻量、双向复用、长连接 |
| 原子写入 | **临时文件 + fsync + 重命名** | 解决文件锁/脏读风险 |
| 多租户隔离 | **物理隔离** | 用户独立目录 + 独立 Agent |

### 1.3 架构哲学

> **文件系统是唯一数据源，SQLite 只是索引缓存，任何时刻可通过文件重新生成索引。**

### 1.4 多租户隔离

**策略**：物理隔离 — 每个用户独立目录 + 独立 Agent + 独立 SQLite

**核心理念**：
- 每个用户有独立的 Agent 实例（通过 OpenClaw 多 Agent 支持）
- 每个 Agent 绑定独立的工作目录（agent-workspace）
- 每个 Agent 写入独立的内容目录（content）
- PKGM-Web 通过路径/用户名隔离展示内容

**数据流向**：
```
用户 alice → OpenClaw Agent-A → /workspace/project/PKGM/users/alice/content/
         ↓ 原子写入
         ↓ inotify add事件
                                                       ┌→ /workspace/project/PKGM/users/alice/meta/index.db
用户 bob   → OpenClaw Agent-B → /workspace/project/PKGM/users/bob/content/  → Indexer (单实例)
         ↓ 原子写入                                                        ↓ HTTP POST
         ↓ inotify add事件                                            ┌→ /workspace/project/PKGM/users/bob/meta/index.db
                                                                       ↓
Next.js (统一服务, Middleware切换用户上下文)
         ↓ SSE推送
浏览器 (实时更新)
```

---

## 2. 目录结构

### 2.1 多用户目录架构

```
/workspace/project/PKGM/users/
├── alice/                    # 用户 alice
│   ├── agent-workspace/      # Agent 工作目录（独立 workspace）
│   ├── content/              # PKGM 内容目录
│   │   ├── daily/           # Cron生成，命名：YYYY-MM-DD-[主题].md
│   │   ├── uploads/         # 用户上传，UUID前缀
│   │   └── tasks/           # 探索任务，包含元数据
│   ├── assets/              # 图片/附件
│   └── meta/
│       ├── index.db         # SQLite主库（WAL模式）
│       ├── index.db-shm     # WAL共享内存
│       └── index.db-wal     # WAL预写日志
├── bob/                     # 用户 bob
│   └── ...                  # 同上结构
└── carol/                   # 用户 carol
    └── ...                  # 同上结构
```

---

## 3. 用户注册与初始化流程

### 3.1 注册流程

```
用户通过 PKGM-Web 注册（或 PKGM-Manager 对话创建）
    ↓
1. 验证用户名唯一性
2. 调用 PKGM-Manager 创建 Agent（§3.3）
    ├── 创建用户目录结构
    │   ├── /workspace/project/PKGM/users/{username}/
    │   │   ├── agent-workspace/
    │   │   ├── content/{daily,uploads,tasks}/
    │   │   ├── assets/
    │   │   └── meta/
    ├── 注册 Agent 配置（gateway config.patch）
    └── 重启 Gateway 使配置生效
3. 初始化 SQLite 数据库
    ├── 创建空 index.db
    └── 初始化 FTS5 虚拟表结构
4. 单实例 Indexer 自动发现新用户
    ├── chokidar 逐目录 watch（discoverUsers 发现用户列表）
    └── 新目录自动纳入监控，无需重启
    ↓
用户开始使用，Agent 自动写入 content/
```

### 3.2 注册 API 设计

```typescript
// app/api/register/route.ts
export async function POST(req: Request) {
    const { username, password, role } = await req.json();
    
    // 1. 验证用户名唯一性
    if (await userExists(username)) {
        return NextResponse.json({ error: 'Username exists' }, { status: 409 });
    }
    
    // 2. 创建目录结构
    await createUserDirectories(username);
    
    // 3. 调用 PKGM-Manager 创建 Agent
    const result = await sessions_send({
        agentId: "pkgm-manager",
        message: `创建新用户 Agent，名字：${username}，角色：${role || "通用助手"}`,
        timeoutSeconds: 300
    });
    
    if (result.status !== 'success') {
        return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
    }
    
    // 4. 存储密码哈希
    await saveUser(username, await hashPassword(password));
    
    // 5. 初始化 SQLite
    await initializeDatabase(username);
    
    // 6. 自动登录（签发 JWT）
    const token = await createToken(username);
    return NextResponse.json({ success: true, username }, {
        headers: { 'Set-Cookie': `pkgm-session=${token}; HttpOnly; Secure; Path=/; Max-Age=86400` }
    });
}

async function createUserDirectories(username: string) {
    const base = `/workspace/project/PKGM/users/${username}`;
    await fs.mkdir(`${base}/agent-workspace`, { recursive: true });
    await fs.mkdir(`${base}/content/daily`, { recursive: true });
    await fs.mkdir(`${base}/content/uploads`, { recursive: true });
    await fs.mkdir(`${base}/content/tasks`, { recursive: true });
    await fs.mkdir(`${base}/assets`, { recursive: true });
    await fs.mkdir(`${base}/meta`, { recursive: true });
}
```

### 3.3 PKGM-Manager（用户 Agent 管理）

**定位**：专用 Agent，负责所有用户 Agent 的生命周期管理。

```
用户 ──对话──→ PKGM-Manager ──执行──→ OpenClaw 系统
                (专用管理 Agent)        (配置/会话/Agent)
```

#### 3.3.1 PKGM-Manager 工作目录

```
/workspace/project/PKGM/manager/
├── SOUL.md              # Agent 身份定义
├── skills/
│   ├── create-agent/    # 创建用户 Agent 技能
│   │   ├── SKILL.md
│   │   └── scripts/create-user.sh
│   ├── manage-session/  # 会话管理技能
│   │   └── SKILL.md
│   ├── query-status/    # 状态查询技能
│   │   └── SKILL.md
│   └── delete-agent/    # 删除 Agent 技能
│       └── SKILL.md
├── templates/
│   ├── SOUL_TEMPLATE.md # 新用户 Agent 的 SOUL.md 模板
│   └── AGENT_CONFIG.md  # Agent 配置模板
└── logs/
    └── actions.jsonl    # 操作审计日志
```

#### 3.3.2 核心能力

| 能力 | 示例指令 | 执行动作 |
|------|---------|---------|
| **创建用户 Agent** | "创建 Agent alice" | 创建目录 → 写 SOUL.md → 注册配置 → 重启 Gateway |
| **删除用户 Agent** | "删除 Agent bob" | 注销配置 → 清理目录 → 停止会话 |
| **管理会话** | "为 alice 创建新会话" | `sessions_spawn` → 返回 sessionId |
| **查询状态** | "查看 alice 的状态" | 检查目录/DB/Indexer/Agent 健康度 |
| **重启 Agent** | "重启 alice 的 Agent" | 重新 spawn 会话 |

#### 3.3.3 创建 Agent 流程

```
用户指令: "帮我创建一个新的 Agent，名字叫 alice。
          1. 工作区路径设为 /workspace/project/PKGM/users/alice/agent-workspace
          2. 写一个 SOUL.md，设定是资深代码审查员
          3. 注册配置并确认启动"
                    ↓
PKGM-Manager: 解析意图 → create-agent 技能
                    ↓
步骤 1: 验证用户名唯一性
  exec: test -d /workspace/project/PKGM/users/alice && echo "EXISTS" || echo "OK"
                    ↓
步骤 2: 创建目录结构
  mkdir -p /workspace/project/PKGM/users/alice/{agent-workspace,content/{daily,uploads,tasks},assets,meta}
                    ↓
步骤 3: 生成 SOUL.md
  使用 templates/SOUL_TEMPLATE.md，注入用户名和角色设定
  写入 /workspace/project/PKGM/users/alice/agent-workspace/SOUL.md
                    ↓
步骤 4: 注册 Agent 配置
  gateway config.patch agents.entries.pkgm-alice
                    ↓
步骤 5: 重启 Gateway（使配置生效）
  gateway restart
                    ↓
步骤 6: 验证 Agent 已启动
  sessions_list → 检查 pkgm-alice 是否在线
                    ↓
步骤 7: 初始化 SQLite
  创建空 index.db + FTS5 表结构
  （Indexer 单实例自动发现新目录，无需手动启动）
                    ↓
PKGM-Manager: "Agent alice 创建成功。工作区：/workspace/project/PKGM/users/alice/。Agent 已在线。"
```

#### 3.3.4 技能详细实现

##### 技能 1: create-agent

**触发条件**：包含 "创建 Agent"/"创建用户"/"new user" 等关键词

| 步骤 | 操作 | 验证 |
|------|------|------|
| 1 | 验证用户名格式（字母数字+下划线） | 正则 `^[a-zA-Z0-9_]+$` |
| 2 | 验证唯一性（检查目录是否存在） | `test -d /workspace/project/PKGM/users/{username}` |
| 3 | 创建目录结构 | 6 个目录 |
| 4 | 生成 SOUL.md | 使用模板 + 注入用户名/角色 |
| 5 | 生成 System Prompt | 使用模板 + 注入用户名 |
| 6 | 注册 Agent 配置 | `gateway config.patch agents.entries.pkgm-{username}` |
| 7 | 重启 Gateway | `gateway restart` |
| 8 | 验证 Agent 在线 | `agents_list` 过滤 |
| 9 | 初始化 SQLite | 创建空 index.db + FTS5 表（Indexer 自动发现） |
| 10 | 写入审计日志 | `logs/actions.jsonl` |

##### 技能 2: manage-session

**触发条件**：包含 "创建会话"/"新会话"/"session" 等关键词

| 步骤 | 操作 | 输出 |
|------|------|------|
| 1 | 识别用户（从指令提取用户名） | username |
| 2 | 验证用户存在 | 目录检查 |
| 3 | `sessions_spawn` 创建会话 | sessionId |
| 4 | 返回 sessionId 给调用方 | Web 端用于交互 |
| 5 | 写入审计日志 | actions.jsonl |

```typescript
sessions_spawn({
  agentId: "pkgm-{username}",
  runtime: "subagent",
  mode: "session",
  label: "pkmg-{username}-{date}",
  task: "欢迎回来，{username}。你的工作目录是 /workspace/project/PKGM/users/{username}/",
  cwd: "/workspace/project/PKGM/users/{username}/agent-workspace"
})
```

##### 技能 3: query-status

**触发条件**：包含 "查看状态"/"status"/"健康检查" 等关键词

| 检查项 | 方法 | 状态 |
|--------|------|------|
| 目录存在 | `test -d` | ✅/❌ |
| Agent 在线 | `sessions_list` 过滤 label | 在线/离线 |
| Indexer 运行 | `docker ps` 过滤 | running/exited |
| SQLite 记录数 | `SELECT COUNT(*)` | 整数 |
| 磁盘使用 | `du -sh` | 大小 |
| 最后活动 | content/ 最新文件 mtime | 时间戳 |

**输出格式**：
```
用户: {username}
├── 目录: ✅
├── Agent: ✅ 在线 (label: pkmg-alice)
├── Indexer: ✅ running
├── SQLite: ✅ 123 条记录
├── 磁盘: 15MB
└── 最后活动: 2026-04-16 14:30
```

##### 技能 4: delete-agent

**触发条件**：包含 "删除 Agent"/"delete user" 等关键词

⚠️ **危险操作！必须二次确认**。

| 步骤 | 操作 |
|------|------|
| 1 | 识别用户，验证存在 |
| 2 | 检查是否有活跃会话 |
| 3 | **二次确认**：输出删除影响，要求用户输入用户名确认 |
| 4 | 停止活跃会话 |
| 5 | 注销 Agent 配置（`gateway config.patch` 删除 entry） |
| 6 | 重启 Gateway |
| 7 | 删除目录（`rm -rf /workspace/project/PKGM/users/{username}`） |
| 8 | 清理 users.db |
| 9 | 写入审计日志 |

**确认输出**：
```
⚠️ 警告：此操作将永久删除用户 {username} 的所有数据：
- Agent 配置（不可恢复）
- 内容目录（所有文档）
- SQLite 数据库
- 会话记录

请输入用户名确认：{username}
```

#### 3.3.5 审计日志格式

```jsonl
// logs/actions.jsonl
{"timestamp": "2026-04-16T15:12:00Z", "action": "create-agent", "username": "alice", "status": "success", "details": {"workspace": "/workspace/project/PKGM/users/alice/agent-workspace", "agentId": "pkgm-alice"}}
{"timestamp": "2026-04-16T15:15:00Z", "action": "create-session", "username": "alice", "sessionId": "session-abc123", "status": "success"}
{"timestamp": "2026-04-16T15:20:00Z", "action": "query-status", "username": "alice", "status": "success", "details": {"agentOnline": true, "indexerRunning": true, "docCount": 123}}
{"timestamp": "2026-04-16T15:25:00Z", "action": "delete-agent", "username": "bob", "status": "success", "confirmed": true}
```

#### 3.3.6 PKGM-Manager 配置

```yaml
# OpenClaw config 中添加
agents:
  entries:
    pkgm-manager:
      name: "PKGM-Manager"
      workspace: "/workspace/project/PKGM/manager/"
      systemPrompt: |
        你是 PKGM（Personal Knowledge Graph Manager）系统管理员。
        你的职责是管理所有用户 Agent 的生命周期。

        **核心能力**：
        1. 创建用户 Agent（目录 + SOUL.md + 配置注册）
        2. 管理用户 Agent 会话
        3. 查询系统状态
        4. 执行系统维护

        **执行纪律**：
        - 创建 Agent 必须验证用户名唯一性
        - 所有操作完成后必须验证结果
        - 危险操作（删除）需要二次确认
```

#### 3.3.7 PKGM-Web 集成

PKGM-Web 的注册流程改为调用 PKGM-Manager：

```typescript
// app/api/register/route.ts
export async function POST(req: Request) {
    const { username, password, role } = await req.json();
    
    // 调用 PKGM-Manager 创建 Agent
    const result = await sessions_send({
        agentId: "pkgm-manager",
        message: `创建新用户 Agent，名字: ${username}，角色: ${role || "通用助手"}，工作区: /workspace/project/PKGM/users/${username}/agent-workspace`,
        timeoutSeconds: 300
    });
    
    if (result.status === 'success') {
        // 存储密码哈希
        await saveUser(username, await hashPassword(password));
        
        // 自动登录
        const token = await createToken(username);
        return NextResponse.json({ success: true }, {
            headers: { 'Set-Cookie': `pkgm-session=${token}; HttpOnly; Secure; Path=/; Max-Age=86400` }
        });
    }
}
```

### 3.4 System Prompt 模板

每个用户 Agent 启动时注入的 System Prompt（通过 `templates/` 生成）：

```
你是用户 {username} 的专属 AI 助手。

你的工作目录：/workspace/project/PKGM/users/{username}/agent-workspace/
内容输出目录：/workspace/project/PKGM/users/{username}/content/

**角色**: {role}

**写入规则**：
- 生成的 Markdown 文件必须写入 content/ 目录
- 使用原子写入（临时文件 + fsync + rename）
- 必须包含 Frontmatter 元数据（title, type, status）
- status: 生成中为 "writing"，完成后改为 "completed"
```

---

## 4. 核心模块设计

### 4.1 存储层：原子写入协议

**问题**：OpenClaw 流式写入时，Indexer 可能读到不完整内容。

**方案**：OpenClaw 生成文件时：
1. 写入临时文件（同目录，保证原子重命名）
2. `fsync()` 强制刷盘
3. Linux `rename()` 原子替换

```python
# 伪代码示例
def atomic_write(filepath, content):
    dir_name = os.path.dirname(filepath)
    fd, temp_path = tempfile.mkstemp(dir=dir_name, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(content)
            f.flush()
            os.fsync(fd)
        os.rename(temp_path, filepath)  # Linux原子操作
    except:
        os.remove(temp_path)
        raise
```

**Indexer 策略**：监听 `add` 事件（新文件），而非 `change`（修改）。

---

### 4.2 Frontmatter 元数据规范

```yaml
---
title: "市场分析报告"
created: "2026-04-15T08:00:00Z"
type: "daily"           # daily | upload | task
tags: ["AI分析", "市场"]
status: "completed"     # writing | completed
source: "cron"          # cron | user-upload | explore-task
version: 1
---
```

**状态机规则**：
| status | Indexer 行为 | 说明 |
|--------|-------------|------|
| `writing` | **跳过**（不索引） | 流式生成中，可能不完整 |
| `completed` | **索引** | 生成完毕，可安全读取 |
| 缺失 | **索引**（向后兼容） | 旧文件默认索引 |

---

### 4.3 索引服务 (Indexer)

#### 4.3.1 防抖与批处理

```javascript
const pendingUpdates = new Map();
let batchTimer = null;

// 单实例多用户：发现用户 + 逐目录 watch
function discoverUsers() {
    if (!fs.existsSync(USERS_ROOT)) return [];
    return fs.readdirSync(USERS_ROOT).filter(d => {
        const p = path.join(USERS_ROOT, d);
        return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'content'));
    });
}

function watchUser(username) {
    const contentDir = path.join(USERS_ROOT, username, 'content');
    chokidar.watch(contentDir, {
        ignored: /(^|[\/\\])\../,  // 忽略隐藏文件（含.tmp）
        persistent: true,
        ignoreInitial: false,
        awaitWriteFinish: {
            stabilityThreshold: 300,  // 文件300ms无变化才触发
            pollInterval: 100
        }
    }).on('add', handleFileEvent)
      .on('change', handleFileEvent)
      .on('unlink', handleDelete);
}

// 启动所有已有用户
discoverUsers().forEach(watchUser);

function handleFileEvent(path) {
    pendingUpdates.set(path, { action: 'upsert', time: Date.now() });
    clearTimeout(batchTimer);
    batchTimer = setTimeout(flushBatch, 200);
}

function flushBatch() {
    if (pendingUpdates.size === 0) return;
    
    // 按用户分组（单实例多用户：不同用户的 DB 不同）
    const byUser = new Map();
    for (const [path, info] of pendingUpdates.entries()) {
        const match = path.match(new RegExp(`^${USERS_ROOT}/([^/]+)`));
        if (!match) continue;
        const user = match[1];
        if (!byUser.has(user)) byUser.set(user, []);
        byUser.get(user).push([path, info]);
    }
    pendingUpdates.clear();

    // 按用户分别事务写入
    for (const [user, rows] of byUser.entries()) {
        const db = getUserDB(`/workspace/project/PKGM/users/${user}/meta/index.db`);
        const insertMany = db.transaction((items) => {
            for (const [path] of items) insert.run(parseAndSegment(path));
        });
        insertMany(rows);
    }

    // 合并推送SSE
    notifyClients({ type: 'batch-update', count: pendingUpdates.size });
}
```

#### 4.3.2 文件删除：硬删策略

```javascript
function handleDelete(path) {
    // 硬删：文件已删除，DB记录无保留意义
    db.prepare('DELETE FROM documents WHERE path = ?').run(path);
}
```

**理由**：文件系统删除不可逆，保留 DB 记录无意义。

#### 4.3.3 中文分词 + FTS5

```javascript
const jieba = new Jieba();

function parseAndSegment(filePath) {
    const { data, content } = matter.read(filePath);
    const plainText = removeMarkdown(content);
    const segmented = jieba.cut(plainText, true).join(' ');

    return {
        path: filePath,
        title: data.title,
        content: plainText.substring(0, 10000),
        content_seg: segmented,  // 分词后用于FTS
        tags: (data.tags || []).join(','),
        type: data.type,
        created: data.created,
        modified: fs.statSync(filePath).mtime.toISOString()
    };
}
```

**FTS5 虚拟表**：
```sql
CREATE VIRTUAL TABLE documents USING fts5(
    path UNINDEXED,
    title,
    content_seg,
    tags UNINDEXED,
    tokenize='porter'
);
```

---

### 4.4 SQLite 并发安全

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `journal_mode` | WAL | 写操作不阻塞读 |
| `timeout` | 5000ms | 忙等待5秒 |
| `synchronous` | NORMAL | 平衡安全与性能 |
| Next.js 连接 | readonly | 强制只读 |

```javascript
// Indexer 写连接（单实例，根据文件路径路由到对应用户 DB）
function getUserDB(filePath: string) {
    // 从文件路径提取用户名: /workspace/project/PKGM/users/{username}/content/...
    const match = filePath.match(/^\/workspace\/project\/PKGM\/users\/([^/]+)/);
    if (!match) throw new Error(`Unknown user path: ${filePath}`);
    const username = match[1];
    return new Database(`/workspace/project/PKGM/users/${username}/meta/index.db`, {
        timeout: 5000,
        verbose: process.env.DEBUG ? console.log : null
    });
}

// Next.js 只读连接（通过 Middleware 获取用户路径）
export function getDB(userPath: string) {
    return new Database(`${userPath}/meta/index.db`, {
        readonly: true,
        timeout: 3000,
        fileMustExist: true
    });
}
```

---

### 4.5 SSE 推送闭环

**方案**：Indexer 通过**内部 HTTP 回调** Next.js 的 POST 端点。

```
Indexer (单实例)                   Next.js
       │                               │
       │  写入 /workspace/project/PKGM/  │
       │  users/{user}/meta/index.db    │
       │  ↓                             │
       │  HTTP POST /api/notify         │
       │  { username, type, count }     │
       │ ─────────────────────────────→│
       │                               │ SSE推送浏览器
```

---

### 4.6 搜索 Ranking 优化

**方案**：按 `type` 字段加权。

```sql
SELECT
    path,
    title,
    snippet(documents, 2, '<mark>', '</mark>', '...', 32) as snippet
FROM documents
WHERE content_seg MATCH @query
ORDER BY
    CASE type
        WHEN 'daily' THEN 1   -- 日报优先
        WHEN 'task' THEN 2
        WHEN 'upload' THEN 3
    END,
    rank
LIMIT 20
```

---

### 4.7 Markdown 渲染一致性

**核心原则**：前端统一渲染引擎，OpenClaw 只生成标准 GFM Markdown。

| 项目 | 决策 |
|------|------|
| 渲染引擎 | 前端统一使用 `unified + remark` 链 |
| Mermaid | 服务端渲染（SSG），客户端无负担 |
| OpenClaw | 只生成标准 GFM Markdown，不依赖渲染引擎 |
| 一致性保障 | 前端唯一渲染源，OpenClaw 不维护渲染代码 |

#### 4.7.1 统一 remark 插件链

```typescript
// lib/markdown.ts - 前端唯一渲染引擎
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'      // 表格、任务列表、删除线
import remarkMath from 'remark-math'    // LaTeX 公式
import remarkEmoji from 'remark-emoji'  // 表情支持
import remarkRehype from 'remark-rehype'
import rehypeShiki from '@shikijs/rehype'  // 代码高亮
import rehypeKatex from 'rehype-katex'     // 公式渲染
import rehypeRaw from 'rehype-raw'         // Mermaid 等 HTML
import rehypeStringify from 'rehype-stringify'

export const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkEmoji)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeShiki, { theme: 'github-dark' })
    .use(rehypeKatex)
    .use(rehypeRaw)
    .use(rehypeStringify)
```

#### 4.7.2 Mermaid 服务端渲染（SSG）

**优势**：
- 避免客户端加载 `mermaid.js`（~1MB）
- 首屏渲染快
- SEO 友好

```typescript
// 在 SSR/SSG 阶段将 ```mermaid 代码块渲染为 SVG
// 客户端直接获取渲染后的 SVG 图片，无需 JavaScript 执行
```

#### 4.7.3 OpenClaw 侧要求

OpenClaw 只需输出标准格式：
- CommonMark + GFM（GitHub Flavored Markdown）
- 表格使用标准 `|---|---|` 语法
- 代码块带语言标识（```python）
- Mermaid 代码块使用 ```mermaid 标识

---

### 4.8 认证与公网接入

**背景**：PKGM-Web 需要从公网访问，用户通过 Web 注册创建账号。

**方案**：Next.js 自建 JWT Session 认证。

#### 4.8.1 认证流程

```
公网用户 → Nginx (HTTPS) → PKGM-Web Next.js
                                ↓
                        /api/auth/login
                                ↓
                        bcrypt 验证密码
                                ↓
                        签发 JWT (httpOnly cookie)
                                ↓
                        后续请求携带 cookie → 验证 → 注入用户上下文
```

#### 4.8.2 注册流程（与 §3 整合）

```
用户访问 /register
    ↓
1. 验证用户名唯一性
2. 调用 PKGM-Manager 创建 Agent（§3.3）
3. 初始化 SQLite（创建空 index.db + FTS5 表）
4. 存储密码哈希（bcrypt 12 轮）
5. 自动登录（签发 JWT）
6. Indexer 自动发现新用户目录（无需手动操作）
```

#### 4.8.3 认证核心代码

```typescript
// lib/auth.ts
import { compare, hash } from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export async function hashPassword(password: string) {
    return hash(password, 12);  // 12 轮 bcrypt
}

export async function verifyPassword(password: string, hash: string) {
    return compare(password, hash);
}

export async function createToken(username: string) {
    return new SignJWT({ username })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('24h')
        .sign(SECRET);
}

export async function verifyToken(token: string) {
    try {
        const { payload } = await jwtVerify(token, SECRET);
        return payload.username as string;
    } catch {
        return null;
    }
}
```

#### 4.8.4 Middleware 拦截

```typescript
// middleware.ts
export async function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    
    // 登录页/注册页/静态资源放行
    if (pathname.startsWith('/login') || pathname.startsWith('/register') || pathname.startsWith('/_next')) {
        return NextResponse.next();
    }
    
    // 验证 JWT
    const token = request.cookies.get('pkgm-session')?.value;
    const username = token ? await verifyToken(token) : null;
    
    if (!username) {
        return NextResponse.redirect(new URL('/login', request.url));
    }
    
    // 注入用户上下文
    const headers = new Headers(request.headers);
    headers.set('x-pkgm-user', username);
    return NextResponse.next({ request: { headers } });
}
```

#### 4.8.5 用户存储

```sql
-- users.db（独立于用户内容数据库）
CREATE TABLE users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_login TEXT,
    is_active INTEGER DEFAULT 1
);
```

#### 4.8.6 安全加固

| 项目 | 措施 |
|------|------|
| 密码存储 | bcrypt 12 轮，不存明文 |
| Session | JWT httpOnly cookie，24h 过期 |
| 登录限速 | Nginx 限流 1r/s，防暴力破解 |
| HTTPS | 强制 SSL + HSTS 头 |
| 失败锁定 | 5 次失败后锁定 15 分钟 |

#### 4.8.7 Nginx 路径分发与代理

**设计原则**：Nginx 负责路径分发和限速，认证由 Next.js JWT 处理。

```nginx
server {
    listen 443 ssl http2;
    server_name docs.your-domain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # 强制 HTTPS
    add_header Strict-Transport-Security "max-age=63072000" always;

    # 登录端点（限速防暴力破解）
    location /api/auth/login {
        proxy_pass http://pkgm-web;
        limit_req zone=login_limit burst=3 nodelay;
    }

    # SSE 长连接（不缓冲，24h 超时）
    location ~ ^/docs/([^/]+)/api/notify {
        proxy_pass http://pkgm-web;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        limit_conn addr 5;
    }

    # 用户路径隔离（Nginx 正则捕获用户名 → Header 传递）
    # URL: /docs/alice/... → X-User-ID: alice, X-User-Path: /workspace/project/PKGM/users/alice
    # proxy_pass 结尾有 /，Nginx 会自动重写路径：/docs/alice/x → /x
    location ~ ^/docs/([^/]+)/ {
        set $user $1;

        proxy_pass http://pkgm-web/;  # 结尾 / 触发路径重写
        proxy_http_version 1.1;
        proxy_set_header X-User-ID $user;
        proxy_set_header X-User-Path /workspace/project/PKGM/users/$user;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 登录页/静态资源（放行）
    location /login {
        proxy_pass http://pkgm-web;
    }

    location /register {
        proxy_pass http://pkgm-web;
    }

    location /_next/ {
        proxy_pass http://pkgm-web;
    }

    # 搜索 API（限速）
    location ~ ^/docs/([^/]+)/api/search {
        set $user $1;
        proxy_pass http://pkgm-web/;
        proxy_set_header X-User-ID $user;
        limit_req zone=search_limit burst=10 nodelay;
    }
}

# 限速区域
limit_req_zone $binary_remote_addr zone=login_limit:10m rate=1r/s;
limit_req_zone $binary_remote_addr zone=search_limit:10m rate=5r/s;
limit_conn_zone $binary_remote_addr zone=addr:10m;
```

**路径重写说明**：

```
用户请求: /docs/alice/content/daily/2026-04-16.md
         ↓ Nginx regex 捕获
    $user = alice
         ↓ proxy_pass 结尾 / 重写
    发送给 Next.js: /content/daily/2026-04-16.md
         ↓ Headers
    X-User-ID: alice
    X-User-Path: /workspace/project/PKGM/users/alice
```

**Next.js Middleware 职责**：
```typescript
// 1. 从 cookie 验证 JWT
const username = await verifyToken(cookie);
// 2. 校验 JWT 用户名与 X-User-ID 匹配
if (username !== request.headers.get('x-user-id')) {
    return new NextResponse('Forbidden', { status: 403 });
}
```

---

## 5. 资源隔离

**Indexer（单实例共享）**：
```yaml
# docker-compose.yml
pkgm-indexer:
    deploy:
        resources:
            limits:
                cpus: '1.0'
                memory: 512M
```

**Systemd 方案**：
```ini
# /etc/systemd/system/pkgm-indexer.service
[Service]
CPUQuota=100%
MemoryLimit=512M
TasksMax=100
```

**Agent 隔离（每用户独立）**：每个用户的 Agent 通过 OpenClaw 多 Agent 机制隔离，拥有独立 workspace 和会话。

**目的**：Indexer 大量扫描时不影响 OpenClaw 性能。

---

## 6. 备份策略

**WAL 模式需同时备份 3 个文件**：

```bash
for user_dir in /workspace/project/PKGM/users/*/; do
    username=$(basename "$user_dir")
    mkdir -p "/backup/$DATE/users/$username"
    
    # SQLite WAL 模式需备份 3 个文件
    cp "$user_dir/meta/index.db"* "/backup/$DATE/users/$username/" 2>/dev/null
    
    # 源文件备份（这才是黄金数据）
    rsync -avz "$user_dir/content/" "/backup/$DATE/users/$username/content/"
done

# 或使用 SQLite .backup 命令（原子）
sqlite3 "$user_dir/meta/index.db" "VACUUM INTO '/backup/$DATE/users/$username/index.db'"

# 保留最近 7 天
find /backup -type d -mtime +7 -exec rm -rf {} \;
```

---

## 7. 关键风险应对

| 风险点 | 严重性 | 终版方案 | 状态 |
|--------|--------|---------|------|
| 文件锁/脏读 | 🔴 高 | 原子写入 + awaitWriteFinish | ✅ |
| 防抖Indexer高频写入 | 🟡 中 | 200ms批处理 + 事务 | ✅ |
| SQLite并发Busy | 🟡 中 | WAL + 5s timeout + 只读池 | ✅ |
| 中文搜索失效 | 🔴 高 | @node-rs/jieba预分词 | ✅ |
| 资源争抢 | 🟡 中 | Indexer CPUQuota 100% + MemoryLimit 512M | ✅ |
| SSE推送闭环 | 🟡 中 | Indexer → HTTP POST Next.js | ✅ |
| Frontmatter状态机 | 🟡 中 | writing跳过，completed索引 | ✅ |
| WAL备份完整性 | 🟢 低 | 同时备份 .db + .wal + .shm | ✅ |
| Markdown不一致 | 🟡 中 | 前端统一remark链 + Mermaid SSG | ✅ |
| 公网暴力破解 | 🟡 中 | bcrypt + JWT + Nginx限流 + 失败锁定 | ✅ |

---

## 8. 开发验收清单

| 阶段 | 验收标准 |
|------|---------|
| **Phase 0** | 目录权限正常，Nginx 通路 |
| **Phase 1** | Indexer 入库成功，无 .writing 残留 |
| **Phase 2** | Next.js 列表页正常，Markdown 渲染正确 |
| **Phase 3** | SSE 实时更新，中文分词有效 |
| **Phase 4** | 资源限制生效，备份脚本正常 |

---

## 9. 待讨论事项

> **所有架构讨论已完成**，文档可直接作为开发基准。

---

## 10. 下一步

- [ ] 确认架构文档，进入实施阶段
- [ ] 从 Phase 0 开始执行（基础设施验证）
- [ ] 按 IMPLEMENTATION_ROADMAP.md 逐步推进

---

*本文档由 DevMate 整合架构评审 + 多租户方案（A3）+ PKGM-Manager Agent 管理方案生成。*
*版本: V5.0 | 2026-04-16*
