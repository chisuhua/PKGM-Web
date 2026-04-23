/**
 * API: GET /api/users
 * 返回当前认证用户的信息（不是所有用户列表）
 */
import { NextRequest, NextResponse } from 'next/server';

const INDEXER_HOST = process.env.INDEXER_HOST || '127.0.0.1';
const INDEXER_PORT = process.env.INDEXER_PORT || '3004';

export const dynamic = 'force-dynamic';

async function indexerGet(path: string) {
    const res = await fetch(`http://${INDEXER_HOST}:${INDEXER_PORT}${path}`, {
        next: { revalidate: 0 }
    });
    if (!res.ok) throw new Error(`Indexer API error: ${res.status}`);
    return res.json();
}

export async function GET(req: NextRequest) {
    const username = req.headers.get('x-authenticated-user');

    if (!username) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const docs = await indexerGet(`/docs/${encodeURIComponent(username)}`);
        return NextResponse.json({ username, docs });
    } catch (err: unknown) {
        return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
}
