import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getSSEBroker } from '@/lib/sse-broker';
import type { IndexerEvent } from '@/lib/sse-broker';

const broker = getSSEBroker();

export async function POST(req: NextRequest) {
    const indexerSecret = req.headers.get('x-indexer-secret');
    if (indexerSecret !== process.env.INDEXER_SECRET) {
        return new Response('Forbidden', { status: 403 });
    }

    try {
        const data = await req.json();
        const event: IndexerEvent = {
            username: data.username,
            event: data.event || 'update',
            timestamp: Date.now(),
        };
        await broker.publish(event);
        return new Response(JSON.stringify({ sent: 'ok' }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch {
        return new Response('bad request', { status: 400 });
    }
}

export async function GET(req: NextRequest) {
    const token = req.cookies.get('pkgm-token')?.value
        || req.headers.get('authorization')?.replace('Bearer ', '');

    if (!token || !(await verifyToken(token))) {
        return new Response('Unauthorized', { status: 401 });
    }

    const username = await verifyToken(token);
    if (!username) {
        return new Response('Invalid token', { status: 401 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            let closed = false;

            const unsubscribe = broker.subscribe(username, (event: IndexerEvent) => {
                if (closed) return;
                try {
                    const msg = `data: ${JSON.stringify(event)}\n\n`;
                    controller.enqueue(encoder.encode(msg));
                } catch {
                    closed = true;
                    unsubscribe();
                }
            });

            const heartbeat = setInterval(() => {
                if (closed) { clearInterval(heartbeat); return; }
                try {
                    controller.enqueue(encoder.encode(': ping\n\n'));
                } catch {
                    closed = true;
                    clearInterval(heartbeat);
                    unsubscribe();
                }
            }, 25000);

            req.signal.addEventListener('abort', () => {
                closed = true;
                clearInterval(heartbeat);
                unsubscribe();
            });
        },
        cancel() {
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    });
}