import { NextResponse } from 'next/server';
import { metrics } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

export async function GET() {
    const m = metrics.getMetrics();
    const uptime = metrics.getUptime();

    let output = '';

    output += `# HELP pkgm_uptime_seconds Service uptime in seconds\n`;
    output += `# TYPE pkgm_uptime_seconds gauge\n`;
    output += `pkgm_uptime_seconds ${uptime}\n\n`;

    for (const [name, value] of Object.entries(m)) {
        const labels = value.labels
            ? `{${Object.entries(value.labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
            : '';

        output += `# HELP ${name} Auto-collected metric\n`;
        output += `# TYPE ${name} ${value.type}\n`;
        output += `${name}${labels} ${value.value}\n\n`;
    }

    return new Response(output, {
        headers: { 'Content-Type': 'text/plain; version=0.0.4' },
    });
}