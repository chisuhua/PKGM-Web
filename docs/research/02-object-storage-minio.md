# MinIO 多租户对象存储调研报告 — 2026-07-17

## 概述

MinIO 作为 PKGM 多租户系统的对象存储层，承担原始文档上传、管线缓存和 Wiki 内容存储。

## 数据模型设计

### 推荐：混合策略（按数据类型分 Bucket + Prefix 按租户隔离）

```
pkgm-data (Bucket)
├── uploads/{tenant_id}/   # 00_Raw_Sources: 用户上传
├── cache/{tenant_id}/     # 03_Engine/cache: 管线缓存 (7天过期)
└── wiki/{tenant_id}/      # 01_Wiki: 生成内容
```

**理由**：上传/缓存/内容生命周期不同，可独立配置 Lifecycle。

### 三种多租户模型

| 模型 | 隔离强度 | 复杂度 | PKGM 适用 |
|------|---------|--------|-----------|
| Bucket-per-Tenant | 强 | 高（千级桶管理） | 不适合（用户增长不可控） |
| **Prefix 隔离**（推荐） | 中 | 低 | ✅ 适合，单桶足够 |
| Namespace 隔离 (K8s) | 物理隔离 | 极高 | ❌ 未来可能需要 |

## IAM 策略

### Prefix 隔离 Policy 模板

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::pkgm-data"],
      "Condition": {"StringLike": {"s3:prefix": ["${aws:username}/*"]}}
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::pkgm-data/${aws:username}/*"]
    }
  ]
}
```

`${aws:username}` 动态变量实现每用户自动隔离。

## 上传方案

| 方式 | 适用场景 | 优点 |
|------|---------|------|
| **Presigned PUT URL** | 小文件（< 100MB） | 直传 MinIO，绕过应用服务器 |
| **tusd** | 大文件/断线续传 | 可恢复，分片上传，断点续传 |

### Presigned URL 安全规则
- 有效期 ≤ 5 分钟
- 服务端决定对象 Key（用户不能控制路径）
- 签名 Content-Type + Content-MD5
- 限制对象大小范围
- 单次使用（业务层去重）

## 事件通知

### Webhook 配置（推荐）

```bash
export MINIO_NOTIFY_WEBHOOK_ENABLE_primary="on"
export MINIO_NOTIFY_WEBHOOK_ENDPOINT_primary="http://pkgm-web:3001/api/minio/events"
export MINIO_NOTIFY_WEBHOOK_AUTH_TOKEN_primary="Bearer ${INDEXER_SECRET}"
export MINIO_NOTIFY_WEBHOOK_QUEUE_DIR="/data/minio-events"  # 持久化
```

- 事件：`s3:ObjectCreated:Put` → 触发管线
- 事件：`s3:ObjectRemoved:Delete` → 索引清理
- 异步模式 + queue_dir 持久化，确保下线不丢事件

## ClamAV 病毒扫描

**推荐架构**：上传后异步扫描

```
用户上传 → MinIO → webhook → pkgm-scanner → ClamAV 扫描
                                    ├── 通过 → tag `scan-status=clean` → 触发管线
                                    └── 失败 → 移入隔离 Bucket `pkgm-quarantine`
```

- 扫描前默认拒绝下载（依赖 `scan-status` tag 过滤）
- 隔离区保留感染文件供取证

## 资源限制

| 指标 | 限制 |
|------|------|
| Max Buckets | 500,000（软限制） |
| Max Object Size | 5 TiB (PUT) / ~50 TiB (Multipart) |
| MinIO 数据盘 | **禁止 NFS**，推荐 XFS/ZFS/Btrfs |
| 单 Prefix 对象 | < 10,000（基线）|

## Lifecycle 策略

```bash
# 缓存 7 天过期
mc ilm rule add myminio/pkgm-data --prefix "cache/" --expire-days 7

# 临时上传区 1 天清理
mc ilm rule add myminio/pkgm-tmp --expire-days 1

# 版本清理
mc ilm rule add myminio/pkgm-data --noncurrent-expire-days 30
```

## 客户库选择

| 场景 | 推荐库 |
|------|--------|
| Node.js（PKGM-Web） | minio-js 或 AWS SDK v3（需 `forcePathStyle: true`） |
| Python（PKGM-Wiki） | minio-py |

## 部署

- Phase 0: Docker 单节点
- Phase 1: 4 节点分布式（> 100GB 数据）
- Phase 3: 引入 Kafka 替代 Webhook（高吞吐）

## 关键警告
- MinIO 数据盘禁止 NFS（一致性无法保证，stale handle 风险）
- Community Edition 2025 起进入维护模式（Web Console 已移除），生产大负载需 AIStor