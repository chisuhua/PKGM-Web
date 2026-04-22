#!/usr/bin/env node
/**
 * PKGM Indexer — 单实例多用户文件监控 + FTS5 索引
 *
 * 架构: 单一 chokidar glob 监控所有用户目录，按文件路径路由到对应用户 DB
 * 环境变量:
 *   PKGM_USERS_DIR  — 用户根目录 (默认: /workspace/project/PKGM/users)
 *   WEB_HOST        — Next.js 主机 (默认: 127.0.0.1)
 *   WEB_PORT        — Next.js 端口 (默认: 3001)
 */

const chokidar = require('chokidar');
const Database = require('better-sqlite3');
const matter = require('gray-matter');
const { Jieba } = require('@node-rs/jieba');
const fs = require('fs');
const path = require('path');
const http = require('http');

const USERS_ROOT = process.env.PKGM_USERS_DIR || '/workspace/project/PKGM/users';
const WEB_HOST = process.env.WEB_HOST || '127.0.0.1';
const WEB_PORT = parseInt(process.env.WEB_PORT, 10) || 3001;
const jieba = new Jieba();

// ============================================================
// DB 连接缓存（单实例多用户，按需创建）
// ============================================================
const dbCache = new Map();

function getUserDB(username) {
    if (!dbCache.has(username)) {
        const dbPath = path.join(USERS_ROOT, username, 'meta', 'index.db');
        // 初始化/确保表结构存在（幂等操作）
        const init = new Database(dbPath);
        init.exec(`
            PRAGMA journal_mode = DELETE;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 5000;
            CREATE TABLE IF NOT EXISTS documents (
                path TEXT PRIMARY KEY,
                title TEXT,
                content TEXT,
                content_seg TEXT,
                tags TEXT,
                type TEXT,
                status TEXT,
                created TEXT,
                modified TEXT
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
                path UNINDEXED, title, content_seg, tags UNINDEXED, type UNINDEXED,
                tokenize='porter'
            );
        `);
        init.close();
        // 后续访问：OPEN 不创建新连接，检测并转换非 WAL DB
        const db = new Database(dbPath, { timeout: 5000 });
        const mode = db.pragma('journal_mode', { simple: true });
        if (mode !== 'wal') {
            db.pragma('journal_mode = DELETE');
        }
        db.pragma('synchronous = NORMAL');
        db.pragma('busy_timeout = 5000');

        // 预编译语句
        db._upsert = db.prepare(`
            INSERT INTO documents (path, title, content, content_seg, tags, type, status, created, modified)
            VALUES (@path, @title, @content, @content_seg, @tags, @type, @status, @created, @modified)
            ON CONFLICT(path) DO UPDATE SET
                title=excluded.title,
                content=excluded.content,
                content_seg=excluded.content_seg,
                tags=excluded.tags,
                type=excluded.type,
                status=excluded.status,
                created=excluded.created,
                modified=excluded.modified
        `);
        db._delete = db.prepare('DELETE FROM documents WHERE path = ?');
        db._fts_upsert = db.prepare(`
            INSERT OR REPLACE INTO documents_fts(path, title, content_seg, tags, type)
            VALUES (@path, @title, @content_seg, @tags, @type)
        `);
        db._fts_delete = db.prepare('DELETE FROM documents_fts WHERE path = ?');

        // 迁移：检查 FTS 表是否存在，不存在则创建
        try {
            db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
                path UNINDEXED, title, content_seg, tags UNINDEXED, type UNINDEXED,
                tokenize='unicode61 remove_diacritics 1'
            )`);
        } catch (e) { /* 忽略 */ }

        dbCache.set(username, db);
    }
    return dbCache.get(username);
}

// ============================================================
// 文件解析 + 中文分词
// ============================================================
function parseAndSegment(filePath) {
    const { data, content } = matter.read(filePath);
    const plain = content.replace(/[#*`]/g, ' ').substring(0, 10000);
    return {
        path: filePath,
        title: data.title || '',
        content: content.substring(0, 10000),
        content_seg: jieba.cut(plain, true).join(' '),
        tags: (data.tags || []).join(','),
        type: data.type || 'daily',
        status: data.status || 'completed',
        created: data.created || new Date().toISOString(),
        modified: fs.statSync(filePath).mtime.toISOString()
    };
}

// ============================================================
// 从文件路径提取用户名
// ============================================================
function extractUser(filePath) {
    const match = filePath.match(new RegExp(`^${USERS_ROOT}/([^/]+)`));
    return match ? match[1] : null;
}

// ============================================================
// 通知 Next.js（HTTP 回调触发 SSE）
// ============================================================
function notifyWeb(username, event) {
    const payload = JSON.stringify({ username, event, timestamp: Date.now() });
    const req = http.request({
        hostname: WEB_HOST,
        port: WEB_PORT,
        path: '/api/events',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, () => {});
    req.on('error', () => {});
    req.write(payload);
    req.end();
}

// ============================================================
// 全局防抖 + 按用户分组批处理
// ============================================================
const pending = new Map();
let batchTimer = null;

function flush() {
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
        try {
            const db = getUserDB(user);

            const tx = db.transaction((rows) => {
                for (const [p, action] of rows) {
                    if (action === 'delete') {
                        db._delete.run(p);
                        db._fts_delete.run(p);
                        console.log(`  [${user}] Deleted: ${p}`);
                    } else {
                        // 检查 status: writing → 跳过
                        try {
                            const row = parseAndSegment(p);
                            if (row.status === 'writing') {
                                console.log(`  [${user}] Skip (writing): ${p}`);
                                continue;
                            }
                            db._upsert.run(row);
                            db._fts_upsert.run(row);
                        } catch (err) {
                            console.error(`  [${user}] Parse error: ${p}`, err.message);
                        }
                    }
                }
            });

            tx(items);
            // 强制 checkpoint 确保 NFS 写入
            db.pragma('wal_checkpoint(FULL)');
            notifyWeb(user, 'update');
            console.log(`[${user}] Batch: ${items.length} files → indexed`);
        } catch (err) {
            console.error(`[${user}] Error:`, err.message);
        }
    }
}

// ============================================================
// 启动 — 发现用户 + 逐目录 watch
// ============================================================
function discoverUsers() {
    if (!fs.existsSync(USERS_ROOT)) return [];
    return fs.readdirSync(USERS_ROOT).filter(d => {
        const p = path.join(USERS_ROOT, d);
        return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'content'));
    });
}

function watchUser(username) {
    const contentDir = path.join(USERS_ROOT, username, 'content');
    console.log(`[Indexer] Watching user: ${username} → ${contentDir}`);

    chokidar.watch(contentDir, {
        ignored: /(^|[\/\\])\../,  // 忽略隐藏文件
        ignoreInitial: false,
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100
        }
    })
        .on('add', (p) => {
            if (!p.endsWith('.md')) return;
            pending.set(p, 'upsert');
            clearTimeout(batchTimer);
            batchTimer = setTimeout(flush, 200);
        })
        .on('change', (p) => {
            if (!p.endsWith('.md')) return;
            pending.set(p, 'upsert');
            clearTimeout(batchTimer);
            batchTimer = setTimeout(flush, 200);
        })
        .on('unlink', (p) => {
            if (!p.endsWith('.md')) return;
            pending.set(p, 'delete');
            clearTimeout(batchTimer);
            batchTimer = setTimeout(flush, 200);
        })
        .on('ready', () => {
            console.log(`[Indexer] ${username}: scan complete`);
        })
        .on('error', (err) => {
            console.error(`[Indexer] ${username}: watch error:`, err.message);
        });
}

const users = discoverUsers();
console.log(`[Indexer] Starting, discovered ${users.length} user(s): ${users.join(', ') || 'none'}`);
console.log(`[Indexer] Users root: ${USERS_ROOT}`);
console.log(`[Indexer] Web callback: http://${WEB_HOST}:${WEB_PORT}/api/events`);

users.forEach(watchUser);

// ============================================================
// HTTP API 服务器（供 Next.js 查询 DB）
// ============================================================
function startHttpServer() {
    const port = parseInt(process.env.INDEXER_PORT, 10) || 3004;

    const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        const url = new URL(req.url, `http://localhost:${port}`);
        const pathname = url.pathname;

        // GET /users
        if (req.method === 'GET' && pathname === '/users') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(discoverUsers()));
            return;
        }

        // GET /docs/:username
        const docsMatch = pathname.match(/^\/docs\/([^/]+)$/);
        if (req.method === 'GET' && docsMatch) {
            const username = docsMatch[1];
            try {
                const db = getUserDB(username);
                const docs = db.prepare(`SELECT path, title, content, content_seg, tags, type, status, created, modified FROM documents ORDER BY modified DESC LIMIT 100`).all();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(docs));
            } catch {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'DB error' }));
            }
            return;
        }

        // GET /doc/:username?path=...
        const docMatch = pathname.match(/^\/doc\/([^/]+)$/);
        if (req.method === 'GET' && docMatch) {
            const username = docMatch[1];
            const docPath = url.searchParams.get('path');
            if (!docPath) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing path' })); return; }
            try {
                const doc = getUserDB(username).prepare('SELECT * FROM documents WHERE path = ?').get(docPath);
                if (!doc) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(doc));
            } catch {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'DB error' }));
            }
            return;
        }

        // GET /search/:username?q=...
        const searchMatch = pathname.match(/^\/search\/([^/]+)$/);
        if (req.method === 'GET' && searchMatch) {
            const username = searchMatch[1];
            const query = url.searchParams.get('q');
            if (!query) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing q' })); return; }
            try {
                const db = getUserDB(username);
                // 尝试 FTS5 MATCH，失败则用 LIKE fallback
                let results;
                try {
                    // Use prefix wildcard (*) to handle Porter stemmer case mismatch
                    // e.g. 'recover' -> 'recover*' matches both 'recover' and 'recovery'
                    const seg = jieba.cut(query, true).map(t => t + '*').join(' ');
                    // FTS5: search the FTS virtual table, not the base documents table
                    results = db.prepare(`
                        SELECT 
                            fts.path, 
                            fts.title, 
                            snippet(documents_fts, 2, '<mark>', '</mark>', '...', 32) as snippet, 
                            fts.type
                        FROM documents_fts fts
                        WHERE documents_fts MATCH ?
                        ORDER BY bm25(documents_fts)
                        LIMIT 20
                    `).all(seg);
                } catch (e1) {
                    console.log(`[Indexer] FTS5 match failed, using LIKE: ${e1.message}`);
                    // LIKE fallback: manually inject <mark> around matched query terms
                    const likePat = `%${query}%`;
                    const raw = db.prepare(`SELECT path, title, content, type, modified FROM documents WHERE title LIKE ? OR content LIKE ? LIMIT 20`).all(likePat, likePat);
                    // highlight helper: wrap each occurrence of query (case-insensitive) in <mark>
                    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    results = raw.map(r => ({ ...r, snippet: r.content ? r.content.replace(new RegExp(esc(query), 'gi'), m => `<mark>${m}</mark>`).slice(0, 200) : '' }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(results));
            } catch (e2) {
                console.error(`[Indexer] Search error:`, e2.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Search error' }));
            }
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(port, () => {
        console.log(`[Indexer] HTTP API: http://localhost:${port}`);
    });
    server.on('error', (err) => {
        console.error(`[Indexer] HTTP server error:`, err.message);
    });
}

startHttpServer();

// 优雅退出
process.on('SIGINT', () => {
    console.log('[Indexer] Shutting down...');
    for (const [user, db] of dbCache.entries()) {
        console.log(`  Closing DB for ${user}`);
        db.close();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('[Indexer] Shutting down...');
    for (const [user, db] of dbCache.entries()) {
        db.close();
    }
    process.exit(0);
});
