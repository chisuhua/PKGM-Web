/**
 * 基础指标收集 — 内存存储，通过 /api/metrics 端点暴露
 *
 * 指标类型:
 * - counter: 累加计数器
 * - gauge: 当前值
 * - histogram: 延迟分布（count + sum）
 */

interface MetricValue {
    type: 'counter' | 'gauge' | 'histogram';
    value: number;
    labels?: Record<string, string>;
}

class MetricsRegistry {
    private metrics = new Map<string, MetricValue>();
    private startTime = Date.now();

    increment(name: string, labels?: Record<string, string>) {
        const key = this.keyOf(name, labels);
        const existing = this.metrics.get(key);
        if (existing) {
            existing.value += 1;
        } else {
            this.metrics.set(key, { type: 'counter', value: 1, labels });
        }
    }

    setGauge(name: string, value: number, labels?: Record<string, string>) {
        const key = this.keyOf(name, labels);
        this.metrics.set(key, { type: 'gauge', value, labels });
    }

    observe(name: string, durationMs: number, labels?: Record<string, string>) {
        const key = this.keyOf(name, labels);
        const existing = this.metrics.get(key);
        if (existing && existing.type === 'histogram') {
            existing.value += durationMs;
        } else {
            this.metrics.set(key, { type: 'histogram', value: durationMs, labels });
        }
    }

    getMetrics(): Record<string, MetricValue> {
        return Object.fromEntries(this.metrics);
    }

    getUptime(): number {
        return Math.floor((Date.now() - this.startTime) / 1000);
    }

    private keyOf(name: string, labels?: Record<string, string>): string {
        if (!labels) return name;
        const labelStr = Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
        return `${name}{${labelStr}}`;
    }
}

// 单例
export const metrics = new MetricsRegistry();

export const MetricNames = {
    apiRequestsTotal: 'pkgm_http_requests_total',
    apiRequestDurationMs: 'pkgm_http_request_duration_ms_total',
    apiErrorsTotal: 'pkgm_http_errors_total',
    sseConnections: 'pkgm_sse_connections',
    sseEventsPublished: 'pkgm_sse_events_published_total',
    docsIndexed: 'pkgm_docs_indexed',
    docsByType: 'pkgm_docs_by_type',
} as const;
