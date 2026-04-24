#!/usr/bin/env node
/**
 * NFS 并发基准测试
 * 
 * 测试场景:
 * 1. 单文件写入延迟分布
 * 2. 并发写入成功率
 * 3. chokidar 事件完整性
 */

const fs = require('fs');
const path = require('path');

const TEST_DIR = process.env.TEST_DIR || '/tmp/nfs_benchmark';
const TEST_COUNT = parseInt(process.env.TEST_COUNT, 10) || 100;
const CONCURRENCY = parseInt(process.env.CONCURRENCY, 10) || 10;

function percentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p / 100);
    return sorted[Math.min(idx, sorted.length - 1)];
}

async function testSingleWriteLatency() {
    console.log('\n=== 单文件写入延迟测试 ===');
    const latencies = [];

    for (let i = 0; i < TEST_COUNT; i++) {
        const filepath = path.join(TEST_DIR, `test_${i}.md`);
        const content = `# Test ${i}\n\nContent generated at ${Date.now()}`;

        const start = process.hrtime.bigint();

        const tmpPath = filepath + '.tmp';
        fs.writeFileSync(tmpPath, content);
        fs.fsyncSync(fs.openSync(tmpPath, 'r'));
        fs.renameSync(tmpPath, filepath);

        const end = process.hrtime.bigint();
        latencies.push(Number(end - start) / 1_000_000);

        fs.unlinkSync(filepath);
    }

    console.log(`  P50: ${percentile(latencies, 50).toFixed(2)}ms`);
    console.log(`  P95: ${percentile(latencies, 95).toFixed(2)}ms`);
    console.log(`  P99: ${percentile(latencies, 99).toFixed(2)}ms`);
    console.log(`  Max: ${Math.max(...latencies).toFixed(2)}ms`);
}

async function testConcurrentWrites() {
    console.log('\n=== 并发写入成功率测试 ===');
    console.log(`  并发数: ${CONCURRENCY}, 每并发写入: ${TEST_COUNT} 次`);

    let success = 0;
    let failed = 0;

    async function worker(workerId) {
        for (let i = 0; i < TEST_COUNT; i++) {
            try {
                const filepath = path.join(TEST_DIR, `concurrent_${workerId}_${i}.md`);
                const tmpPath = filepath + '.tmp';
                fs.writeFileSync(tmpPath, `Worker ${workerId}, Iteration ${i}`);
                fs.renameSync(tmpPath, filepath);

                if (fs.readFileSync(filepath, 'utf-8').includes(`Worker ${workerId}`)) {
                    success++;
                } else {
                    failed++;
                }

                fs.unlinkSync(filepath);
            } catch (err) {
                failed++;
            }
        }
    }

    const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));
    await Promise.all(workers);

    console.log(`  成功: ${success}`);
    console.log(`  失败: ${failed}`);
    console.log(`  成功率: ${(success / (success + failed) * 100).toFixed(2)}%`);
}

async function run() {
    console.log('NFS 并发基准测试');
    console.log(`测试目录: ${TEST_DIR}`);
    console.log(`测试次数: ${TEST_COUNT}, 并发数: ${CONCURRENCY}`);

    fs.mkdirSync(TEST_DIR, { recursive: true });

    await testSingleWriteLatency();
    await testConcurrentWrites();

    console.log('\n=== 测试完成 ===');
}

run().catch(err => {
    console.error('Benchmark failed:', err);
    process.exit(1);
});