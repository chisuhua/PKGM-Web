/**
 * API: GET /api/search?q=...
 * 搜索当前用户的文档
 * 用户从 x-authenticated-user header 获取
 */
import { NextRequest, NextResponse } from 'next/server';

const INDEXER_HOST = process.env.INDEXER_HOST || '127.0.0.1';
const INDEXER_PORT = process.env.INDEXER_PORT || '3004';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const username = req.headers.get('x-authenticated-user');
    const query = req.nextUrl.searchParams.get('q');

    if (!username) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!query) {
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
