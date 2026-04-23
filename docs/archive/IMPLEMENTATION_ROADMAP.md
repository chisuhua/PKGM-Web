# PKGM-Web 实施路线文档 v1.0

**版本**: V1.0
**创建日期**: 2026-04-16
**基于**: 
- 轻量级 AI 文档中心架构 v2.0
- DevMate 架构评审
- 多租户隔离架构方案（A3）
- 实施路线文档（A2）
**状态**: 待讨论确认

---

## 1. 项目概述

### 1.1 定位

PKGM-Web 是 PKGM（Personal Knowledge Graph Manager）的**展示层**，负责：
- 渲染 AI Agent 生成的 Markdown 文档（日报、任务、知识图谱）
- 提供全文搜索能力
- 实时推送文档更新（SSE）
- **多租户隔离**：每个用户独立目录 + 独立 SQLite

### 1.2 核心技术栈

| 层级 | 技术选型 | 选型理由 |
|------|---------|---------|
| 前端框架 | **Next.js** | SSR/ISR + MDX + SSE 原生支持 |
| 数据库 | **SQLite + FTS5** | 零依赖、WAL 模式、高性能全文搜索 |
| 中文分词 | **@node-rs/jieba** | Rust 绑定，性能优于 jieba-wasm |
| 文件监控 | **chokidar + inotify** | 事件驱动，CPU 友好 |
| 实时推送 | **SSE (Server-Sent Events)** | 轻量、双向复用、长连接 |
| 原子写入 | **临时文件 + fsync + 重命名** | 解决文件锁/脏读风险 |
| 多租户隔离 | **物理隔离** | 用户独立目录 + 独立 SQLite |

### 1.3 架构哲学

> **文件系统是唯一数据源，SQLite 只是索引缓存，任何时刻可通过文件重新生成索引。**

```
┌─────────────────────────────────────────────────────────────────┐
│                         数据流向                                 │
│                                                                 │
│  OpenClaw容器(生成MD)                                           │
│         ↓ 原子写入                                               │
│  /data/openclaw/users/{username}/content/**/*.md                 │
│         ↓ inotify add事件                                        │
│  Indexer-{username} (防抖200ms + 分词 + WAL写入)                 │
│         ↓ SSE推送 / HTTP回调                                      │
│  Next.js (统一服务, Middleware切换用户上下文)                     │
│         ↓                                                        │
│  浏览器 (实时更新)                                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 多租户目录结构

### 2.1 目录架构（物理隔离）

```
/data/openclaw/
├── users/
│   ├── alice/                    # 用户 alice
│   │   ├── content/
│   │   │   ├── daily/           # Cron 生成，命名：YYYY-MM-DD-[主题].md
│   │   │   ├── uploads/         # 用户上传，UUID 前缀
│   │   │   └── tasks/           # 探索任务，包含元数据
│   │   ├── assets/              # 图片/附件
│   │   └── meta/
│   │       ├── index.db         # SQLite 主库（WAL 模式）
│   │       ├── index.db-shm     # WAL 共享内存
│   │       └── index.db-wal     # WAL 预写日志
│   ├── bob/                     # 用户 bob
│   │   └── ...
│   └── carol/                   # 用户 carol
│       └── ...
└── system/                      # 全局配置（可选）
    └── users.db                 # 仅存储用户名（极简认证）
```

### 2.2 隔离策略

| 隔离层级 | 方案 | 优势 |
|---------|------|------|
| 文件系统 | 用户独立目录 | Docker Volume 天然隔离 |
| SQLite | 用户独立数据库 | 故障不扩散，可单独备份 |
| Web 服务 | 统一入口 + Middleware | 运维简单 |
| Indexer | 每个用户独立进程 | 资源隔离，代码零改动 |

---

## 3. Frontmatter 元数据规范

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

## 4. 核心模块设计

### 4.1 存储层：原子写入协议

**问题**：OpenClaw 流式写入时，Indexer 可能读到不完整内容。

**方案**：
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

### 4.2 索引服务 (Indexer)

#### 4.2.1 防抖与批处理

```javascript
const pending = new Map();
let batchTimer = null;

chokidar.watch('/data/user/content/**/*.md', {
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

function handleFileEvent(path) {
    pending.set(path, { action: 'upsert', time: Date.now() });
    clearTimeout(batchTimer);
    batchTimer = setTimeout(flushBatch, 200);
}

function flushBatch() {
    if (pending.size === 0) return;
    const batch = Array.from(pending.entries());
    pending.clear();

    // 事务批量写入
    const insertMany = db.transaction((rows) => {
        for (const row of rows) insert.run(row);
    });
    insertMany(batch.map(([path]) => parseAndSegment(path)));

    // HTTP 回调 Next.js
    notifyNextjs({ type: 'batch-update', count: batch.length });
}
```

#### 4.2.2 中文分词 + FTS5

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

#### 4.2.3 文件删除：硬删策略

```javascript
function handleDelete(path) {
    // 硬删：文件已删除，DB记录无保留意义
    db.prepare('DELETE FROM documents WHERE path = ?').run(path);
}
```

---

### 4.3 SQLite 并发安全

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `journal_mode` | WAL | 写操作不阻塞读 |
| `timeout` | 5000ms | 忙等待5秒 |
| `synchronous` | NORMAL | 平衡安全与性能 |
| Next.js 连接 | readonly | 强制只读 |

---

### 4.4 SSE 推送闭环

**方案**：Indexer 通过**内部 HTTP 回调** Next.js 的 POST 端点。

```
Indexer-{username}              Next.js
       │                            │
       │  写入SQLite                 │
       │  ↓                          │
       │  HTTP POST /api/notify      │
       │ { username, type, count }   │
       │ ──────────────────────────→│
       │                            │ SSE推送浏览器
```

---

### 4.5 Web 服务：Middleware 多租户切换

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    
    // 从路径获取用户名：/docs/alice/...
    const match = pathname.match(/^\/docs\/([^/]+)/);
    if (!match) return NextResponse.next();
    
    const username = match[1];
    if (!isValidUser(username)) {
        return new NextResponse('User not found', { status: 404 });
    }
    
    // 注入用户上下文
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-id', username);
    requestHeaders.set('x-user-path', `/data/openclaw/users/${username}`);
    
    return NextResponse.next({ request: { headers: requestHeaders } });
}

// lib/db.ts - 动态连接对应用户的数据库
export function getUserDB(request: Request) {
    const userPath = request.headers.get('x-user-path') || process.env.USER_PATH;
    return new Database(`${userPath}/meta/index.db`, {
        readonly: true,
        timeout: 3000
    });
}
```

---

## 5. 实施路线

### Phase 0: 基础设施验证 (Day 0)

**目标**：确保宿主机目录权限、Docker 挂载、Nginx 通路无误

```bash
# 1. 目录结构创建
sudo mkdir -p /data/openclaw/users/{alice,bob,carol}/{content/{daily,uploads,tasks},assets,meta}
sudo chown -R $USER:$USER /data/openclaw
sudo chmod -R 755 /data/openclaw

# 2. Docker Volume 挂载测试
touch /data/openclaw/users/alice/content/test.md && rm /data/openclaw/users/alice/content/test.md

# 3. Nginx 预配置
sudo tee /etc/nginx/sites-available/doc-center << 'EOF'
server {
    listen 80;
    server_name _;
    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
    }
    location /docs/ {
        proxy_pass http://127.0.0.1:3001/;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/doc-center /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**验收**：
```bash
curl http://localhost/api/health    # 应返回 OpenClaw 响应
curl -I http://localhost/docs/      # 应返回 502（Next.js 未启动）
```

---

### Phase 1: 数据骨架 (Day 1-2)

**目标**：OpenClaw 能原子写入，Indexer 能监听并入库

#### Day 1: OpenClaw 原子写入改造

```python
# /opt/openclaw/utils/atomic_writer.py
import os, tempfile, sys

def atomic_write_md(filepath, frontmatter, content):
    full_content = f"---\n{frontmatter}---\n\n{content}"
    dir_name = os.path.dirname(filepath)
    os.makedirs(dir_name, exist_ok=True)
    
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix='.writing')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(full_content)
            f.flush()
            os.fsync(fd)
        os.rename(tmp_path, filepath)  # 触发 Inotify ADD 事件
        print(f"ATOMIC_WRITE_SUCCESS:{filepath}")
    except Exception as e:
        os.remove(tmp_path)
        raise
```

**验证**：
```bash
python3 atomic_writer.py /data/openclaw/users/alice/content/daily/test.md "title: Test" "Hello"
ls -la /data/openclaw/users/alice/content/daily/  # 应瞬间完成，无 .writing 残留
```

#### Day 2: Indexer 基础版（MVP）

```javascript
// /opt/doc-service/indexer-basic.js
const chokidar = require('chokidar');
const Database = require('better-sqlite3');
const matter = require('gray-matter');

const DB_PATH = process.env.DB_PATH || '/data/openclaw/users/alice/meta/index.db';
const db = new Database(DB_PATH);

db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
        path TEXT PRIMARY KEY,
        title TEXT,
        content TEXT,
        type TEXT,
        created TEXT,
        modified TEXT
    );
`);

chokidar.watch(process.env.WATCH_PATH || '/data/openclaw/users/alice/content/**/*.md', {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
}).on('add', (filePath) => {
    const { data, content } = matter.read(filePath);
    db.prepare(`INSERT OR REPLACE INTO documents VALUES (?, ?, ?, ?, ?, ?)`).run(
        filePath, data.title || '', content.substring(0, 5000),
        data.type || 'daily', data.created || new Date().toISOString(),
        new Date().toISOString()
    );
    console.log(`[ADD] ${filePath}`);
}).on('unlink', (filePath) => {
    db.prepare('DELETE FROM documents WHERE path = ?').run(filePath);
});

console.log(`[Indexer] Watching ${process.env.WATCH_PATH}...`);
```

**部署**：
```bash
# systemd service
sudo tee /etc/systemd/system/doc-indexer@.service << 'EOF'
[Unit]
Description=Doc Indexer Service %i
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/doc-service
ExecStart=/usr/bin/node indexer-basic.js
Restart=always
Environment="NODE_ENV=production"
EnvironmentFile=/etc/default/doc-indexer-%i

[Install]
WantedBy=multi-user.target
EOF

# 启动 alice 的 Indexer
sudo systemctl enable doc-indexer@alice
sudo systemctl start doc-indexer@alice
```

**验收**：
```bash
# 创建测试文件
echo -e "---\ntitle: 测试文档\ntype: daily\n---\n\n这是内容" > /data/openclaw/users/alice/content/daily/test.md

# 查看日志
sudo journalctl -u doc-indexer@alice -f

# 验证 SQLite
sqlite3 /data/openclaw/users/alice/meta/index.db "SELECT title, type FROM documents;"
# 应输出：测试文档|daily
```

---

### Phase 2: 前端 MVP (Day 3-4)

**目标**：Next.js 基础展示，无实时更新，手动刷新可见

#### Day 3: Next.js 项目初始化

```bash
mkdir -p /opt/doc-web && cd /opt/doc-web
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --no-turbopack
npm install better-sqlite3 gray-matter react-markdown remark-gfm
```

**核心文件**：

```typescript
// lib/db.ts
import Database from 'better-sqlite3';
import { cache } from 'react';

export function getDocuments(userPath: string) {
    const db = new Database(`${userPath}/meta/index.db`, {
        readonly: true, timeout: 3000
    });
    return db.prepare('SELECT path, title, type, modified FROM documents ORDER BY modified DESC').all();
}

export function getDocument(userPath: string, path: string) {
    const db = new Database(`${userPath}/meta/index.db`, { readonly: true });
    return db.prepare('SELECT * FROM documents WHERE path = ?').get(path);
}

// app/page.tsx
import { getDocuments } from '@/lib/db';

export default function Home({ params }: { params: { username: string } }) {
    const docs = getDocuments(`/data/openclaw/users/${params.username}`);
    return (
        <main className="max-w-4xl mx-auto p-8">
            <h1>文档中心 - {params.username}</h1>
            <div className="space-y-4">
                {docs.map((doc: any) => (
                    <a key={doc.path} href={`/docs/${params.username}/doc?path=${encodeURIComponent(doc.path)}`}
                       className="block p-4 border rounded hover:bg-gray-50">
                        <h2>{doc.title}</h2>
                        <span className="text-sm text-gray-500">{doc.type} • {new Date(doc.modified).toLocaleString()}</span>
                    </a>
                ))}
            </div>
        </main>
    );
}
```

#### Day 4: 构建与部署

```bash
# next.config.js
const nextConfig = {
    output: 'standalone',
    experimental: { serverComponentsExternalPackages: ['better-sqlite3'] }
}

# systemd
sudo tee /etc/systemd/system/doc-web.service << 'EOF'
[Unit]
Description=Doc Web Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/doc-web
ExecStart=/usr/bin/npm start
Restart=always
Environment="PORT=3001"

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable doc-web && sudo systemctl start doc-web
```

**验收**：
```bash
curl http://localhost:3001/docs/alice/  # 应看到 HTML 文档列表
```

---

### Phase 3: 实时化与智能优化 (Day 5-6)

**目标**：防抖 + SSE + 中文分词 + 多租户

#### Day 5: Indexer 增强版（多租户）

```javascript
// /opt/doc-service/indexer-advanced.js
const chokidar = require('chokidar');
const Database = require('better-sqlite3');
const matter = require('gray-matter');
const { Jieba } = require('@node-rs/jieba');
const http = require('http');
const jieba = new Jieba();

const USER_ID = process.env.USER_ID;
const DB_PATH = process.env.DB_PATH;
const WATCH_PATH = process.env.WATCH_PATH;
const WEB_HOST = process.env.WEB_HOST || '127.0.0.1';
const WEB_PORT = process.env.WEB_PORT || '3001';

const db = new Database(DB_PATH, { timeout: 5000 });
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents USING fts5(
        path UNINDEXED, title, content_seg, tags UNINDEXED,
        type UNINDEXED, modified UNINDEXED, tokenize='porter'
    );
`);

const pending = new Map();
let batchTimer = null;

function flushBatch() {
    if (pending.size === 0) return;
    const batch = Array.from(pending.entries());
    pending.clear();

    const insert = db.prepare(`
        INSERT INTO documents(path, title, content_seg, tags, type, modified)
        VALUES(@path, @title, @content_seg, @tags, @type, @modified)
        ON CONFLICT(path) DO UPDATE SET
            title=excluded.title, content_seg=excluded.content_seg,
            tags=excluded.tags, type=excluded.type, modified=excluded.modified
    `);

    const rows = [];
    for (const [path, action] of batch) {
        if (action === 'delete') {
            db.prepare('DELETE FROM documents WHERE path = ?').run(path);
        } else {
            const { data, content } = matter.read(path);
            const plain = content.replace(/[#*`]/g, ' ').substring(0, 10000);
            const segmented = jieba.cut(plain, true).join(' ');
            rows.push({
                path, title: data.title || '',
                content_seg: segmented,
                tags: (data.tags || []).join(','),
                type: data.type || 'daily',
                modified: new Date().toISOString()
            });
        }
    }

    if (rows.length > 0) {
        const tx = db.transaction((r) => r.forEach(r => insert.run(r)));
        tx(rows);
    }

    // 通知 Next.js
    const payload = JSON.stringify({ username: USER_ID, type: 'update', count: batch.size });
    const req = http.request({ hostname: WEB_HOST, port: WEB_PORT, path: '/api/notify', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, () => {});
    req.on('error', () => {});
    req.write(payload);
    req.end();

    console.log(`[${USER_ID}] Batch: ${batch.size} files`);
}

chokidar.watch(WATCH_PATH, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
}).on('add', (p) => { pending.set(p, 'upsert'); clearTimeout(batchTimer); batchTimer = setTimeout(flushBatch, 200); })
  .on('change', (p) => { pending.set(p, 'upsert'); clearTimeout(batchTimer); batchTimer = setTimeout(flushBatch, 200); })
  .on('unlink', (p) => { pending.set(p, 'delete'); clearTimeout(batchTimer); batchTimer = setTimeout(flushBatch, 200); });

console.log(`[Indexer-${USER_ID}] Started with Jieba+WAL`);
```

#### Day 6: SSE 实时推送

```typescript
// app/api/notify/route.ts
const clients = new Set<ReadableStreamDefaultController>();

export async function POST(req: Request) {
    const data = await req.json();
    const encoder = new TextEncoder();
    clients.forEach(client => {
        try { client.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch (e) { clients.delete(client); }
    });
    return NextResponse.json({ sent: clients.size });
}

export async function GET() {
    const stream = new ReadableStream({
        start(controller) {
            clients.add(controller);
            const heartbeat = setInterval(() => {
                controller.enqueue(new TextEncoder().encode(':ping\n\n'));
            }, 30000);
            const cleanup = () => { clearInterval(heartbeat); clients.delete(controller); };
            req.signal.addEventListener('abort', cleanup);
        }
    });
    return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
    });
}

// hooks/useRealtime.ts
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function useRealtime(username: string) {
    const router = useRouter();
    useEffect(() => {
        const es = new EventSource(`/docs/${username}/api/notify`);
        es.onmessage = (e) => {
            if (e.data === ':ping') return;
            router.refresh();
        };
        return () => es.close();
    }, [router, username]);
}
```

**验收**：
```bash
# 重启 Indexer
sudo systemctl restart doc-indexer@alice

# 创建新文件
echo -e "---\ntitle: 实时测试\n---\n\n中文分词测试内容" > /data/openclaw/users/alice/content/daily/realtime-test.md

# 3秒内浏览器应自动刷新

# 验证分词
sqlite3 /data/openclaw/users/alice/meta/index.db "SELECT content_seg FROM documents WHERE title='实时测试';"
# 应看到空格分隔的中文
```

---

### Phase 4: 生产加固 (Day 7)

**目标**：资源限制、备份、Nginx 优化

#### 4.1 Systemd 资源限制

```bash
sudo systemctl edit doc-indexer@alice --force --full
# 添加：
[Service]
CPUQuota=50%
MemoryLimit=256M
TasksMax=50
```

#### 4.2 SQLite WAL 持续化

```bash
# 确保 WAL 不会无限增长
sqlite3 /data/openclaw/users/alice/meta/index.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

#### 4.3 Nginx 生产配置

```nginx
upstream docweb {
    server 127.0.0.1:3001;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # SSE 长连接
    location ~ ^/docs/([^/]+)/api/notify {
        proxy_pass http://docweb;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
    }

    # 文档服务
    location ~ ^/docs/([^/]+)(/.*)?$ {
        proxy_pass http://docweb;
        proxy_http_version 1.1;
        proxy_set_header X-User-ID $1;
    }

    # 静态资源
    location /assets/ {
        alias /data/openclaw/assets/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

#### 4.4 备份脚本

```bash
#!/bin/bash
# /opt/backup/backup.sh
DATE=$(date +%Y%m%d)
BACKUP_DIR="/backup/$DATE"
mkdir -p $BACKUP_DIR

# 备份所有用户的 SQLite（WAL 模式需备份 3 个文件）
for user_dir in /data/openclaw/users/*/; do
    username=$(basename "$user_dir")
    mkdir -p "$BACKUP_DIR/users/$username"
    cp "$user_dir/meta/index.db"* "$BACKUP_DIR/users/$username/" 2>/dev/null
    rsync -avz "$user_dir/content/" "$BACKUP_DIR/users/$username/content/"
done

# 保留最近 7 天
find /backup -type d -mtime +7 -exec rm -rf {} \;

echo "Backup completed: $BACKUP_DIR"

# crontab
echo "0 3 * * * /opt/backup/backup.sh" | crontab -
```

**验收**：
```bash
# 压力测试
for i in {1..100}; do
    echo "---\ntitle: 压力测试 $i\n---\n内容" > /data/openclaw/users/alice/content/daily/stress_$i.md
    sleep 0.1
done

# 检查资源
top -p $(pgrep -d',' -f "doc-indexer")

# 检查一致性
sqlite3 /data/openclaw/users/alice/meta/index.db "SELECT COUNT(*) FROM documents WHERE path LIKE '%stress_%';"
# 应返回 100
```

---

## 6. 多用户管理

### 6.1 添加新用户

```bash
#!/bin/bash
# /opt/doc-center/add-user.sh
USERNAME=$1

if [ -z "$USERNAME" ]; then
    echo "Usage: $0 <username>"
    exit 1
fi

# 创建目录结构
mkdir -p /data/openclaw/users/$USERNAME/{content/{daily,uploads,tasks},assets,meta}
chown -R $USER:$USER /data/openclaw/users/$USERNAME

# 初始化 SQLite（创建空索引）
sqlite3 /data/openclaw/users/$USERNAME/meta/index.db "SELECT 1;"

# 创建 Indexer systemd link
sudo ln -sf /etc/systemd/system/doc-indexer@.service /etc/systemd/system/multi-user.target.wants/doc-indexer@$USERNAME.service

# 启动 Indexer
sudo systemctl start doc-indexer@$USERNAME

echo "User $USERNAME created successfully"
```

### 6.2 Nginx Basic Auth（可选）

```bash
# 安装
sudo apt-get install apache2-utils

# 添加用户
sudo htpasswd -c /etc/nginx/.htpasswd $USERNAME

# Nginx 配置
auth_basic "Doc Center";
auth_basic_user_file /etc/nginx/.htpasswd;
```

---

## 7. 回滚策略

| 阶段 | 回滚命令 | 数据影响 |
|------|---------|---------|
| Phase 1 | `sudo systemctl stop doc-indexer@alice; rm /data/openclaw/users/alice/meta/index.db` | 仅索引丢失，文件安全 |
| Phase 2 | `sudo systemctl stop doc-web; pm2 delete doc-web` | 前端停止，数据无影响 |
| Phase 3 | `sudo systemctl stop doc-indexer@alice; cp indexer-basic.js indexer.js; sudo systemctl start doc-indexer@alice` | 回退到无分词版，数据保留 |

**灾难恢复**：
```bash
# 从文件重建索引
rm /data/openclaw/users/alice/meta/index.db
sudo systemctl restart doc-indexer@alice  # 自动全量扫描
```

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

| # | 问题 | 优先级 |
|---|------|--------|
| 1 | 认证方式：Basic Auth / 子域名 / 其他 | 🟡 中 |
| 2 | OpenClaw 多用户容器部署方式 | 🔴 高 |
| 3 | 知识图谱 Markdown 特殊渲染（Mermaid） | 🟡 中 |

---

## 10. 下一步

- [ ] 确认认证方式
- [ ] 确认 OpenClaw 多用户部署方案
- [ ] 制定详细任务分配（Day 0-7）

---

*本文档由 DevMate 整合 A2（实施路线）+ A3（多租户）+ 架构评审生成，待讨论确认后生效。*
*版本: V1.0 | 2026-04-16*
