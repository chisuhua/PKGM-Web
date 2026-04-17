/**
 * PKGM-Web JWT 认证
 */

import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || 'dev-secret-change-in-production'
);

export async function createToken(username: string): Promise<string> {
    return new SignJWT({ username })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('24h')
        .sign(SECRET);
}

export async function verifyToken(token: string): Promise<string | null> {
    try {
        const { payload } = await jwtVerify(token, SECRET);
        return payload.username as string;
    } catch {
        return null;
    }
}
