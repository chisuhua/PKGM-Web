'use client';

/**
 * PKGM-Web 数据库连接层（客户端版）
 *
 * 由于 Next.js 在 Docker 中以 standalone 模式运行，
 * better-sqlite3 在构建时无法编译，改用 HTTP API 调用 Indexer 读取 DB。
 * 实际上每个用户的 DB 由 Next.js 直接读取（Node.js runtime）。
 */

export interface Doc {
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

export interface UserDocs {
    username: string;
    docs: Doc[];
}

export async function listUsersAndDocs(): Promise<UserDocs[]> {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error('Failed to load users');
    return res.json();
}

export async function getDoc(username: string, docPath: string): Promise<Doc> {
    const res = await fetch(`/api/doc?user=${encodeURIComponent(username)}&path=${encodeURIComponent(docPath)}`);
    if (!res.ok) throw new Error('Doc not found');
    return res.json();
}

export async function searchDocs(username: string, query: string): Promise<Doc[]> {
    const res = await fetch(`/api/search?user=${encodeURIComponent(username)}&q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed');
    return res.json();
}
