import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';

const clients = new Set<ReadableStreamDefaultController>();

export async function POST(req: NextRequest) {
    const indexerSecret = req.headers.get('x-indexer-secret');
    if (indexerSecret !== process.env.INDEXER_SECRET) {
        return new Response('Forbidden', { status: 403 });
    }

    try {
        const data = await req.json();
        const msg = `data: ${JSON.stringify(data)}\n\n`;
        const encoded = new TextEncoder().encode(msg);
        clients.forEach(c => {
            try { c.enqueue(encoded); } catch { clients.delete(c); }
        });
        return new Response(JSON.stringify({ sent: clients.size }), {
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

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            clients.add(controller);
            let closed = false;

            const heartbeat = setInterval(() => {
                if (closed) { clearInterval(heartbeat); return; }
                try {
                    controller.enqueue(encoder.encode(': ping\n\n'));
                } catch {
                    closed = true;
                    clearInterval(heartbeat);
                    clients.delete(controller);
                }
            }, 25000);

            req.signal.addEventListener('abort', () => {
                closed = true;
                clearInterval(heartbeat);
                clients.delete(controller);
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
