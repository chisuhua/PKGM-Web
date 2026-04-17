import { NextRequest } from 'next/server';

// SSE 客户端集合（多实例部署时需替换为 Redis Pub/Sub）
const clients = new Set<ReadableStreamDefaultController>();

/**
 * Indexer 回调端点
 * POST /api/events — 触发 SSE 推送
 */
export async function POST(req: NextRequest) {
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

/**
 * SSE 客户端订阅端点
 * GET /api/events — 浏览器 SSE 连接
 */
export async function GET(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            clients.add(controller);
            let closed = false;

            // 心跳保持连接
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

            // 客户端断开时清理
            req.signal.addEventListener('abort', () => {
                closed = true;
                clearInterval(heartbeat);
                clients.delete(controller);
            });
        },
        cancel() {
            // ReadableStream 被取消时清理
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
