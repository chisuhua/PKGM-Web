/**
 * API: GET /api/doc?user=...&path=...
 * 返回单篇文档（从 Indexer HTTP API 获取）
 */
import { NextRequest, NextResponse } from 'next/server';

const INDEXER_HOST = process.env.INDEXER_HOST || '127.0.0.1';
const INDEXER_PORT = process.env.INDEXER_PORT || '3004';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const username = req.nextUrl.searchParams.get('user');
    const docPath = req.nextUrl.searchParams.get('path');

    if (!username || !docPath) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }

    try {
        const res = await fetch(
            `http://${INDEXER_HOST}:${INDEXER_PORT}/doc/${encodeURIComponent(username)}?path=${encodeURIComponent(docPath)}`,
            { next: { revalidate: 0 } }
        );
        if (res.status === 404) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        if (!res.ok) return NextResponse.json({ error: 'Indexer error' }, { status: 500 });
        const doc = await res.json();
        return NextResponse.json(doc);
    } catch (err: unknown) {
        return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
}
