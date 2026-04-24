import { NextResponse } from 'next/server';

const startTime = Date.now();

export const dynamic = 'force-dynamic';

export async function GET() {
    const health = {
        status: 'healthy',
        service: 'pkgm-web',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
        checks: {
            indexer: 'unknown',
        },
    };

    const indexerHost = process.env.INDEXER_HOST || '127.0.0.1';
    const indexerPort = process.env.INDEXER_PORT || '3004';

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const res = await fetch(`http://${indexerHost}:${indexerPort}/health`, {
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (res.ok) {
            health.checks.indexer = 'healthy';
        } else {
            health.checks.indexer = 'degraded';
        }
    } catch {
        health.checks.indexer = 'unhealthy';
        health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    return NextResponse.json(health, { status: statusCode });
}