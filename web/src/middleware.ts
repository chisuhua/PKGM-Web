import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from './lib/auth';

const PUBLIC_PATHS = [
    '/login',
    '/api/login',
    '/api/logout',
    '/_next',
    '/favicon.ico'
];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
        return NextResponse.next();
    }

    const token = request.cookies.get('pkgm-token')?.value
        || request.headers.get('authorization')?.replace('Bearer ', '');

    if (!token) {
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.redirect(new URL('/login', request.url));
    }

    const username = await verifyToken(token);
    if (!username) {
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
        }
        const response = NextResponse.redirect(new URL('/login', request.url));
        response.cookies.delete('pkgm-token');
        return response;
    }

    if (pathname.startsWith('/docs/')) {
        const docsMatch = pathname.match(/^\/docs\/([^/]+)/);
        if (docsMatch && docsMatch[1] !== username) {
            if (pathname.startsWith('/api/')) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            return NextResponse.redirect(new URL('/', request.url));
        }
    }

    const response = NextResponse.next();
    response.headers.set('x-authenticated-user', username);
    return response;
}

export const config = {
    matcher: ['/((?!_next/static|_next/image).*)']
};