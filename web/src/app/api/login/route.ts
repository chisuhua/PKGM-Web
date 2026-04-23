import { NextRequest, NextResponse } from 'next/server';
import { createToken } from '@/lib/auth';

const INDEXER_HOST = process.env.INDEXER_HOST || '127.0.0.1';
const INDEXER_PORT = process.env.INDEXER_PORT || '3004';

export async function POST(req: NextRequest) {
    try {
        const { username } = await req.json();

        if (!username || typeof username !== 'string') {
            return NextResponse.json({ success: false, error: 'Username required' }, { status: 400 });
        }

        const res = await fetch(`http://${INDEXER_HOST}:${INDEXER_PORT}/users`);
        const users: string[] = await res.json();

        if (!users.includes(username)) {
            return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
        }

        const token = await createToken(username);

        const response = NextResponse.json({ success: true, username });
        response.cookies.set({
            name: 'pkgm-token',
            value: token,
            httpOnly: true,
            path: '/',
            maxAge: 86400,
            sameSite: 'lax'
        });

        return response;
    } catch (err) {
        return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
    }
}