/**
 * API: GET /api/search?q=...
 * 通过 X-User-ID header 指定用户（Nginx 注入）
 */
import { NextRequest, NextResponse } from 'next/server';

const INDEXER_HOST = process.env.INDEXER_HOST || '127.0.0.1';
const INDEXER_PORT = process.env.INDEXER_PORT || '3004';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    // 优先从 Nginx X-User-ID header 获取用户名（多租户标准做法）
    const username = req.headers.get('x-user-id') || req.nextUrl.searchParams.get('user');
    const query = req.nextUrl.searchParams.get('q');

    if (!username || !query) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }

    try {
        const res = await fetch(
            `http://${INDEXER_HOST}:${INDEXER_PORT}/search/${encodeURIComponent(username)}?q=${encodeURIComponent(query)}`,
            { next: { revalidate: 0 } }
        );
        if (!res.ok) return NextResponse.json({ error: 'Search error' }, { status: 500 });
        const results = await res.json();
        return NextResponse.json(results);
    } catch (err: unknown) {
        return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
}
