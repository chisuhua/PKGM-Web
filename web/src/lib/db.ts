/**
 * PKGM-Web 数据库连接层
 *
 * 注意：Next.js API Routes 已改为通过 Indexer HTTP API (/api/users, /api/doc, /api/search)
 * 获取数据，不再直接读取 SQLite。本文件保留用于类型定义。
 */

export interface Document {
    path: string;
    title: string;
    content: string;
    content_seg: string;
    tags: string;
    type: string;
    status: string;
    created: string;
    modified: string;
}

// 不再直接使用 — 通过 HTTP API 调用 Indexer
export type { Document as Doc };
