# PKGM-Web MVP 计划 V2.0

**版本**: V2.0
**创建日期**: 2026-04-16
**状态**: 待确认
**基于**: CTO 审查反馈（2026-04-16）

---

## 核心目标

**验证多租户架构可行性**，而非仅验证单用户功能。MVP 代码即生产代码基础，不做"先单用户再重写"。

---

## MVP 范围

### 必须包含

| 功能 | 实现方式 | 验收标准 |
|------|---------|---------|
| PKGM-Manager 引导 | 手动 `openclaw agents add` | Agent 在线，可执行创建指令 |
| 多租户代码 | 写多用户代码，配 1 个用户 | 环境变量控制用户数 |
| Indexer 扫描 | chokidar 多目录 watch | 3 秒内入库 |
| 前端渲染 | Next.js + react-markdown | 列表 + 详情 |
| FTS5 搜索 | @node-rs/jieba + FTS5 | 中文关键词准确返回 |
| SSE 推送 | Indexer → HTTP POST → Next.js | 修改文件 3 秒内浏览器刷新 |
| Nginx 路径代理 | 正则捕获 + Header 传递 | /docs/alice/ → X-User-ID: alice |
| 错误恢复 | Indexer 崩溃后自动重启 | systemd/docker restart 策略 |

### MVP 不包含

| 功能 | 原因 | 后续迭代 |
|------|------|---------|
| Web 注册页 | 先用 PKGM-Manager 对话创建 | Phase 2 |
| JWT 认证 | MVP 内网直连 | Phase 2 |
| SSL 证书 | MVP 内网直连 | Phase 2 |
| Mermaid 渲染 | 先跑通基础 Markdown | Phase 2 |
| 完整 Nginx 限速 | 先用基础代理 | Phase 2 |

---

## Phase 0：基础设施验证（1 天）

### 目标

验证 NAS 可访问、OpenClaw 可写入、PKGM-Manager 可引导。

### 步骤

#### 1. NAS 挂载验证

```bash
# 在 OpenClaw 容器内验证
docker exec openclaw ls -la /workspace/project/
# 预期：能看到项目目录

# 测试写入
echo "# 测试" > /workspace/project/PKGM/users/alice/content/daily/test-01.md
cat /workspace/project/PKGM/users/alice/content/daily/test-01.md
```

#### 2. PKGM-Manager 引导

```bash
# Step 1: 创建目录
mkdir -p /workspace/project/PKGM/manager/{skills,templates,logs}

# Step 2: 写入 SOUL.md
cat > /workspace/project/PKGM/manager/SOUL.md << 'EOF'
你是 PKGM 系统管理员，负责管理所有用户 Agent 的生命周期。
核心能力：创建用户 Agent、管理会话、查询状态。
EOF

# Step 3: 注册 Agent
openclaw agents add pkgm-manager \
  --workspace "/workspace/project/PKGM/manager/"

# Step 4: 重启 Gateway
openclaw gateway restart

# Step 5: 验证
# 在 OpenClaw 会话中：
# 指令："查看系统状态"
# 预期：返回系统状态报告
```

#### 3. JWT_SECRET 预生成

```bash
export JWT_SECRET=$(openssl rand -base64 32)
echo "JWT_SECRET=$JWT_SECRET" > /workspace/project/PKGM-Web/.env
chmod 600 /workspace/project/PKGM-Web/.env
```

#### 4. .gitignore 初始化

```bash
cat > /workspace/project/PKGM-Web/.gitignore << 'EOF'
.env
.env.*
node_modules/
.next/
*.db
*.db-shm
*.db-wal
*.pem
users/
manager/logs/
EOF
```

### 验收清单

- [ ] OpenClaw 容器内 `/workspace/project/PKGM/users/` 可访问（NAS 映射确认）
- [ ] 手动创建的文件对 OpenClaw 可见
- [ ] PKGM-Manager Agent 在线（`agents_list` 可见）
- [ ] PKGM-Manager 可响应"查看系统状态"指令
- [ ] `.env` 文件已生成（JWT_SECRET）
- [ ] `.gitignore` 已创建

---

## Phase 1：Indexer 多用户版（1-2 天）

### 目标

实现多用户扫描的 Indexer（**单实例多用户**），代码即生产代码。

### 步骤

#### 1. 初始化项目

```bash
mkdir -p /workspace/project/PKGM-Web/indexer
cd /workspace/project/PKGM-Web/indexer
npm init -y
npm install chokidar better-sqlite3 gray-matter @node-rs/jieba
```

#### 2. 创建单实例多用户 Indexer

```javascript
// indexer/index.js
const chokidar = require('chokidar');
const Database = require('better-sqlite3');
const matter = require('gray-matter');
const { Jieba } = require('@node-rs/jieba');
const fs = require('fs');
const path = require('path');
const http = require('http');

const USERS_ROOT = process.env.PKGM_USERS_DIR || '/workspace/project/PKGM/users';
const WEB_HOST = process.env.WEB_HOST || '127.0.0.1';
const WEB_PORT = process.env.WEB_PORT || '3001';
const jieba = new Jieba();

// DB 连接缓存（单实例多用户）
const dbCache = new Map();
function getUserDB(username) {
    if (!dbCache.has(username)) {
        const dbPath = path.join(USERS_ROOT, username, 'meta', 'index.db');
        if (!fs.existsSync(dbPath)) {
            fs.mkdirSync(path.dirname(dbPath), { recursive: true });
            const init = new Database(dbPath);
            init.exec(`
                CREATE TABLE IF NOT EXISTS documents (
                    path TEXT PRIMARY KEY,
                    title TEXT,
                    content_seg TEXT,
                    tags TEXT,
                    type TEXT,
                    modified TEXT
                );
            `);
            init.pragma('journal_mode = WAL');
            init.close();
        }
        dbCache.set(username, new Database(dbPath, { timeout: 5000 }));
        dbCache.get(username).pragma('journal_mode = WAL');
    }
    return dbCache.get(username);
}

// 分词 + 解析
function parseAndSegment(filePath) {
    const { data, content } = matter.read(filePath);
    const plain = content.replace(/[#*`]/g, ' ').substring(0, 10000);
    return {
        path: filePath,
        title: data.title || '',
        content_seg: jieba.cut(plain, true).join(' '),
        tags: (data.tags || []).join(','),
        type: data.type || 'daily',
        modified: new Date().toISOString()
    };
}

// 从文件路径提取用户名
function extractUser(filePath) {
    const match = filePath.match(/^\/?workspace\/project\/PKGM\/users\/([^\/]+)/);
    return match ? match[1] : null;
}

// 通知 Next.js
function notifyWeb(username, event) {
    const payload = JSON.stringify({ username, event, timestamp: Date.now() });
    const req = http.request({ hostname: WEB_HOST, port: WEB_PORT, path: '/api/events', method: 'POST',
        headers: { 'Content-Type': 'application/json' } }, () => {});
    req.on('error', () => {});
    req.write(payload);
    req.end();
}

// 单实例全局 watch
const pending = new Map();
let batchTimer = null;

const flush = () => {
    if (pending.size === 0) return;

    // 按用户分组
    const byUser = new Map();
    for (const [p, action] of pending.entries()) {
        const user = extractUser(p);
        if (!user) continue;
        if (!byUser.has(user)) byUser.set(user, []);
        byUser.get(user).push([p, action]);
    }
    pending.clear();

    // 按用户分别事务写入
    for (const [user, items] of byUser.entries()) {
        const db = getUserDB(user);
        const stmt = db.prepare(`
            INSERT INTO documents VALUES (@path, @title, @content_seg, @tags, @type, @modified)
            ON CONFLICT(path) DO UPDATE SET
                title=excluded.title, content_seg=excluded.content_seg,
                tags=excluded.tags, type=excluded.type, modified=excluded.modified
        `);
        const delStmt = db.prepare('DELETE FROM documents WHERE path = ?');

        const tx = db.transaction((rows) => {
            for (const [p, action] of rows) {
                if (action === 'delete') {
                    delStmt.run(p);
                    console.log(`[${user}] Deleted: ${p}`);
                } else {
                    const row = parseAndSegment(p);
                    stmt.run(row);
                }
            }
        });

        tx(items);
        notifyWeb(user, 'update');
        console.log(`[${user}] Batch: ${items.length} files`);
    }
};

chokidar.watch(`${USERS_ROOT}/*/content/**/*.md`, {
    ignored: /(^|[\/\\])\../,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
}).on('add', (p) => { pending.set(p, 'upsert'); clearTimeout(batchTimer); batchTimer = setTimeout(flush, 200); })
  .on('change', (p) => { pending.set(p, 'upsert'); clearTimeout(batchTimer); batchTimer = setTimeout(flush, 200); })
  .on('unlink', (p) => { pending.set(p, 'delete'); clearTimeout(batchTimer); batchTimer = setTimeout(flush, 200); });

console.log(`Indexer started, watching: ${USERS_ROOT}/*/content/**/*.md`);
```

### 验收清单

- [x] 启动日志显示 `discovered 1 user(s): alice`
- [x] 创建 `test.md` → 3 秒内 Indexer 日志显示 `[alice] Batch: 1 files → indexed`
- [x] `sqlite3 ... "SELECT COUNT(*) FROM documents;"` 返回 ≥ 1
- [x] 删除 `test.md` → 3 秒内记录被硬删
- [x] 中文内容分词字段不为空：`SELECT content_seg FROM documents WHERE content_seg != '';`
- [x] 停止后重启：自动扫描现有文件并入库（`ignoreInitial: false` + 4 files 批量入库）
- [x] 新增用户目录 → 下次启动自动发现（`discoverUsers()` 读取目录）

---

## Phase 2：前端多用户版（1-2 天）

### 目标

前端通过环境变量获取用户路径，支持多租户展示。

### 步骤

#### 1. 初始化项目

```bash
mkdir -p /workspace/project/PKGM-Web/web
cd /workspace/project/PKGM-Web/web
npx create-next-app@latest . --typescript --tailwind --app --no-turbopack
npm install better-sqlite3 react-markdown remark-gfm jose
```

#### 2. 数据库连接（环境变量注入）

```typescript
// web/lib/db.ts
import Database from 'better-sqlite3';

export function getUserDB(username: string) {
    const usersDir = process.env.PKGM_USERS_DIR || '/workspace/project/PKGM/users';
    const dbPath = `${usersDir}/${username}/meta/index.db`;
    return new Database(dbPath, {
        readonly: true,
        timeout: 3000,
        fileMustExist: true
    });
}

export function listUsers() {
    const usersDir = process.env.PKGM_USERS_DIR || '/workspace/project/PKGM/users';
    return require('fs').readdirSync(usersDir).filter(d =>
        require('fs').statSync(`${usersDir}/${d}`).isDirectory()
    );
}

export function getDocuments(username: string) {
    const db = getUserDB(username);
    return db.prepare('SELECT path, title, type, modified FROM documents ORDER BY modified DESC').all();
}
```

#### 3. 用户列表页

```typescript
// web/app/page.tsx
import { listUsers, getDocuments } from '@/lib/db';
import Link from 'next/link';

export default function Home() {
    const users = listUsers();
    return (
        <main className="max-w-4xl mx-auto p-8">
            <h1 className="text-3xl font-bold mb-6">PKGM 文档中心</h1>
            {users.map(username => {
                const docs = getDocuments(username);
                return (
                    <section key={username} className="mb-8">
                        <h2 className="text-xl font-semibold mb-2">{username}</h2>
                        {docs.map((d: any) => (
                            <Link key={d.path} href={`/docs/${username}?path=${encodeURIComponent(d.path)}`}
                                  className="block p-4 border rounded mb-2 hover:bg-gray-50">
                                <h3>{d.title}</h3>
                                <span className="text-sm text-gray-500">{d.type} • {d.modified}</span>
                            </Link>
                        ))}
                    </section>
                );
            })}
        </main>
    );
}
```

#### 4. SSE + 自动刷新

```typescript
// web/app/api/events/route.ts
const clients = new Set<ReadableStreamDefaultController>();

export async function GET() {
    const stream = new ReadableStream({
        start(controller) {
            clients.add(controller);
            const heartbeat = setInterval(() => {
                controller.enqueue(new TextEncoder().encode(':ping\n\n'));
            }, 30000);
            const cleanup = () => { clearInterval(heartbeat); clients.delete(controller); };
            // 清理逻辑（简化版）
        }
    });
    return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
    });
}

export async function POST(req: Request) {
    const data = await req.json();
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    const encoded = new TextEncoder().encode(msg);
    clients.forEach(c => { try { c.enqueue(encoded); } catch(e) { clients.delete(c); } });
    return Response.json({ sent: clients.size });
}
```

### 验收清单

- [x] 访问 `:3001` 看到用户列表 + 文档（Indexer HTTP API on 3004）
- [x] 点击文档 → 渲染 Markdown 内容
- [x] Indexer 写入新文件 → 3 秒内前端自动刷新
- [x] `process.env.PKGM_USERS_DIR` 控制用户目录（默认 `/workspace/project/PKGM/users`）
- [x] 新增用户目录 → 前端自动展示（Indexer discoverUsers）

---

## Phase 3：搜索 + Nginx 路径代理（2 天）

### 目标

实现 FTS5 中文搜索，验证 Nginx 多租户路径代理。

### 步骤

#### 1. 搜索 API

```typescript
// web/app/api/search/route.ts
import { getUserDB } from '@/lib/db';
import { Jieba } from '@node-rs/jieba';

const jieba = new Jieba();

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const username = searchParams.get('user');
    const query = searchParams.get('q');
    
    if (!username || !query) {
        return Response.json({ error: 'Missing params' }, { status: 400 });
    }
    
    const db = getUserDB(username);
    const userSeg = jieba.cut(query, true).join(' ');
    
    const results = db.prepare(`
        SELECT path, title, snippet(documents, 2, '<mark>', '</mark>', '...', 32) as snippet
        FROM documents WHERE content_seg MATCH @query ORDER BY rank LIMIT 20
    `).all({ query: userSeg });
    
    return Response.json(results);
}
```

#### 2. Nginx 基础代理

```nginx
server {
    listen 80;
    server_name localhost;

    location /docs/ {
        proxy_pass http://127.0.0.1:3001/;
        # 验证路径重写：/docs/alice/x → /x
    }
}
```

### 验收清单

- [ ] 搜索"市场分析" → 返回含该词的中文文档
- [ ] 搜索结果高亮正确（`<mark>` 标签）
- [ ] Nginx `/docs/alice/test` → Next.js 收到 `/test`
- [ ] Nginx 传递 `X-User-ID: alice` 头

---

## Phase 4：Docker 化 + 恢复验证（1 天）

### 目标

容器化部署，验证服务重启恢复。

### 步骤

#### 1. Docker Compose

```yaml
# docker-compose.yml
version: '3.8'
services:
  pkgm-web:
    build: ./web
    ports: ["127.0.0.1:3001:3001"]
    volumes: ["/mnt/nas/project/PKGM/users:/workspace/project/PKGM/users:ro"]
    env_file: ./.env
    environment:
      - PKGM_USERS_DIR=/workspace/project/PKGM/users
      - INDEXER_PORT=3004
    restart: unless-stopped

  pkgm-indexer:
    build: ./indexer
    volumes: ["/mnt/nas/project/PKGM/users:/workspace/project/PKGM/users:rw"]
    env_file: ./.env
    environment:
      - PKGM_USERS_DIR=/workspace/project/PKGM/users
      - INDEXER_PORT=3004
      - WEB_HOST=pkgm-web
      - WEB_PORT=3001
    ports: ["127.0.0.1:3004:3004"]
    restart: unless-stopped
```

#### 2. 重启恢复验证

```bash
# 停止 Indexer
docker compose stop pkgm-indexer

# 创建 3 个测试文件
for i in 1 2 3; do
    echo "---\ntitle: Recovery Test $i\n---\n内容" > /mnt/nas/project/PKGM/users/alice/content/daily/recovery-$i.md
done

# 启动 Indexer
docker compose start pkgm-indexer

# 等待 5 秒后验证
sleep 5
docker exec pkgm-indexer sqlite3 /workspace/project/PKGM/users/alice/meta/index.db "SELECT COUNT(*) FROM documents;"
# 预期：≥ 3（含之前 + 新建的）
```

### 验收清单

- [x] `docker compose up -d` 全服务启动
- [x] 停止 Indexer → 创建文件 → 重启 → 自动扫描入库
- [x] `docker compose logs pkgm-indexer` 显示用户发现日志
- [x] 前端持续可用（Indexer 重启不影响 Web）

---

## 总时间线

| 阶段 | 内容 | 预计 | 关键验证点 |
|------|------|------|-----------|
| **Phase 0** | 基础设施 + PKGM-Manager 引导 | 1 天 | PKGM-Manager 可对话 |
| **Phase 1** | Indexer 多用户版 | 1-2 天 | 3 秒入库 + 重启恢复 |
| **Phase 2** | 前端多用户版 + SSE | 1-2 天 | 环境变量路径 + 自动刷新 |
| **Phase 3** | 搜索 + Nginx 代理 | 2 天 | 中文搜索 + 路径重写 |
| **Phase 4** | Docker 化 + 恢复 | 1 天 | 重启自动恢复 |
| **总计** | | **7-10 天** | 含 30% 缓冲 |

---

## 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Indexer 架构 | 单实例多用户扫描 | 运维简单，代码不改只加配置 |
| 路径管理 | 环境变量注入 | MVP 与生产代码一致 |
| PKGM-Manager | 手动引导，自动执行 | 先验证流程，后续自动化 |
| 认证 | MVP 无认证 | 内网直连，Phase 2 加 JWT |
| 数据库 | 每用户独立 SQLite | 故障隔离，备份简单 |

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| NAS 挂载权限问题 | 中 | 高 | Phase 0 优先验证 |
| better-sqlite3 编译失败 | 低 | 中 | 预编译 binary，备 Docker build |
| SSE Nginx 缓冲问题 | 中 | 中 | Phase 3 验证，备用轮询方案 |
| Indexer 内存泄漏 | 低 | 中 | restart: unless-stopped + 内存限制 |

---

*本文档已整合 CTO 审查反馈。*
*版本: V2.0 | 2026-04-16*
