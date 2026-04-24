import { createClient } from 'redis';

export interface IndexerEvent {
    username: string;
    event: 'update';
    timestamp: number;
}

export type EventCallback = (event: IndexerEvent) => void;

export interface SSEBroker {
    publish(event: IndexerEvent): Promise<void>;
    subscribe(username: string, callback: EventCallback): () => void;
    close(): Promise<void>;
}

// ============================================================
// 内存实现（单实例）
// ============================================================
class InMemoryBroker implements SSEBroker {
    private subscribers = new Map<string, Set<EventCallback>>();

    async publish(event: IndexerEvent): Promise<void> {
        const cbs = this.subscribers.get(event.username) || new Set();
        cbs.forEach(cb => {
            try { cb(event); } catch (e) { console.error('SSE callback error:', e); }
        });
        const globalCbs = this.subscribers.get('*') || new Set();
        globalCbs.forEach(cb => {
            try { cb(event); } catch (e) { console.error('SSE global callback error:', e); }
        });
    }

    subscribe(username: string, callback: EventCallback): () => void {
        if (!this.subscribers.has(username)) {
            this.subscribers.set(username, new Set());
        }
        this.subscribers.get(username)!.add(callback);

        return () => {
            const cbs = this.subscribers.get(username);
            if (cbs) cbs.delete(callback);
        };
    }

    async close(): Promise<void> {
        this.subscribers.clear();
    }
}

// ============================================================
// Redis 实现（多实例）
// ============================================================
class RedisBroker implements SSEBroker {
    private pubClient: ReturnType<typeof createClient>;
    private subClient: ReturnType<typeof createClient>;
    private localCallbacks = new Map<string, Set<EventCallback>>();
    private redisChannels = new Set<string>();

    constructor(redisUrl: string) {
        this.pubClient = createClient({ url: redisUrl });
        this.subClient = createClient({ url: redisUrl });

        this.subClient.on('error', (err) => console.error('Redis subscriber error:', err));
        this.subClient.on('message', (channel, message) => {
            const event: IndexerEvent = JSON.parse(message);
            const cbs = this.localCallbacks.get(channel) || new Set();
            cbs.forEach(cb => {
                try { cb(event); } catch (e) { console.error('SSE Redis callback error:', e); }
            });
        });

        this.pubClient.connect().catch(console.error);
        this.subClient.connect().catch(console.error);
    }

    async publish(event: IndexerEvent): Promise<void> {
        const channel = `pkgm:sse:${event.username}`;
        await this.pubClient.publish(channel, JSON.stringify(event));
    }

    subscribe(username: string, callback: EventCallback): () => void {
        const channel = `pkgm:sse:${username}`;

        if (!this.localCallbacks.has(channel)) {
            this.localCallbacks.set(channel, new Set());
        }
        this.localCallbacks.get(channel)!.add(callback);

        if (!this.redisChannels.has(channel)) {
            this.redisChannels.add(channel);
            this.subClient.subscribe(channel).catch(console.error);
        }

        return () => {
            const cbs = this.localCallbacks.get(channel);
            if (cbs) cbs.delete(callback);
        };
    }

    async close(): Promise<void> {
        await this.pubClient.quit();
        await this.subClient.quit();
    }
}

// ============================================================
// 工厂函数
// ============================================================
let brokerInstance: SSEBroker | null = null;

export function getSSEBroker(): SSEBroker {
    if (brokerInstance) return brokerInstance;

    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
        brokerInstance = new RedisBroker(redisUrl);
        console.log('[SSE] Using Redis broker');
    } else {
        brokerInstance = new InMemoryBroker();
        console.log('[SSE] Using in-memory broker');
    }

    return brokerInstance;
}
