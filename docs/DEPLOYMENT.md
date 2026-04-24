# PKGM-Web 部署指南

**版本**: V1.0  
**创建日期**: 2026-04-22  
**状态**: 现行  

---

## 1. 部署架构

### 1.1 容器拓扑

```
docker-compose.yml (统一编排)
├── openclaw (my-dev-env:latest)    ← OpenClaw Agent，生成 Markdown
├── pkgm-web (Next.js)              ← 前端展示，只读挂载用户目录
├── pkgm-indexer (Node.js)          ← 索引服务，扫描所有用户
└── redis (可选)                    ← 多实例部署时启用 SSE Pub/Sub
```
docker-compose.yml (统一编排)
├── openclaw (my-dev-env:latest)    ← OpenClaw Agent，生成 Markdown
├── pkgm-web (Next.js)              ← 前端展示，只读挂载用户目录
├── pkgm-indexer (Node.js)          ← 索引服务，扫描所有用户
└── redis (可选)                    ← 多实例部署时启用 SSE Pub/Sub
```

### 1.2 数据流向

```
用户对话 → OpenClaw → 原子写入 → /PKGM/users/{username}/content/
                                     ↓ inotify
                               pkgm-indexer → SQLite (DELETE 模式)
                                     ↓ HTTP POST
                               pkgm-web → SSE → 浏览器
                                              ↑
                               (多实例时通过 Redis Pub/Sub)
```

---

## 2. Docker Compose 配置

### 2.1 完整配置

```yaml
# docker-compose.yml
version: '3.8'

services:
  # ============================================
  # OpenClaw Agent（原 aidev2 容器）
  # ============================================
  openclaw:
    image: my-dev-env:latest
    container_name: openclaw
    privileged: true
    restart: always
    working_dir: /workspace
    user: "0:0"
    ports:
      - "127.0.0.1:18789:18789"   # OpenClaw Web UI
      - "127.0.0.1:50080:50080"   # 其他服务端口
    volumes:
      # 工作空间
      - ~/workspace:/workspace:rw
      - /mnt/nas/project:/workspace/project:rw
      # supervisord 配置
      - /mnt/nas/project/PKGM-Web/supervisord.conf:/etc/supervisor/conf.d/supervisord.conf:ro
      - /mnt/nas/project/PKGM-Web/supervisor_log:/var/log/supervisor:rw
    command: ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf", "-n"]
    deploy:
      resources:
        limits:
          memory: "5.5g"
          cpus: "1.5"
        reservations:
          memory: "512m"
          cpus: "0.25"

  # ============================================
  # PKGM-Manager（用户 Agent 管理）
  # ============================================
  # PKGM-Manager 运行在 openclaw 容器内（作为 Agent 实例）
  # 通过 gateway config.patch 注册

  # ============================================
  # PKGM-Web 前端（Next.js）
  # ============================================
  pkgm-web:
    build:
      context: /mnt/nas/project/PKGM-Web
      dockerfile: web/Dockerfile
    container_name: pkgm-web
    restart: unless-stopped
    ports:
      - "127.0.0.1:3001:3001"
    volumes:
      # 只读挂载所有用户目录
      - /mnt/nas/project/PKGM/users:/workspace/project/PKGM/users:ro
    env_file:
      - ./.env
    environment:
      - NODE_ENV=production
      - PORT=3001
      - PKGM_USERS_DIR=/workspace/project/PKGM/users
      - MULTI_USER=true
      - INDEXER_HOST=pkgm-indexer
      - INDEXER_PORT=3004
      - REDIS_URL=redis://redis:6379  # 注释掉则使用内存模式（单实例）
    depends_on:
      - pkgm-indexer
      - redis  # 需要时取消注释
    networks:
      - pkgm-net
    deploy:
      resources:
        limits:
          memory: "512m"
          cpus: "1.0"

  # ============================================
  # Redis（可选，多实例部署时启用）
  # ============================================
  redis:
    image: redis:7-alpine
    container_name: pkgm-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data
    networks:
      - pkgm-net
    deploy:
      resources:
        limits:
          memory: "128m"
          cpus: "0.25"

  # ============================================
  # PKGM-Web Indexer（索引服务）
  # ============================================
  pkgm-indexer:
    build:
      context: /mnt/nas/project/PKGM-Web
      dockerfile: indexer/Dockerfile
    container_name: pkgm-indexer
    restart: unless-stopped
    ports:
      - "127.0.0.1:3004:3004"
    volumes:
      # 读写挂载用户目录（与 OpenClaw 共享 NAS）
      - /mnt/nas/project/PKGM/users:/workspace/project/PKGM/users:rw
    env_file:
      - ./.env
    environment:
      - NODE_ENV=production
      - PKGM_USERS_DIR=/workspace/project/PKGM/users
      - WEB_HOST=pkgm-web
      - WEB_PORT=3001
      - INDEXER_PORT=3004
      - INDEXER_SECRET=${INDEXER_SECRET:-default-secret-change-in-production}
      - MULTI_USER=true
    networks:
      - pkgm-net
    deploy:
      resources:
        limits:
          memory: "256m"
          cpus: "0.5"

networks:
  pkgm-net:
    driver: bridge

volumes:
  redis-data:

### 2.2 环境变量

**根目录 `.env` 文件**：
```bash
# JWT_SECRET（部署前必须修改为强随机密钥）
JWT_SECRET=<生成的安全密钥>

# INDEXER_SECRET（Indexer 回调密钥，与 pkgm-indexer 一致）
INDEXER_SECRET=<生成的安全密钥>

# REDIS_URL（可选，多实例部署时取消注释）
# REDIS_URL=redis://redis:6379
```

**说明**：
| 变量 | 必填 | 说明 |
|------|------|------|
| `JWT_SECRET` | 是 | JWT 签名密钥，必须是强随机值 |
| `INDEXER_SECRET` | 是 | Indexer 回调 Web 的密钥，防止恶意触发 |
| `REDIS_URL` | 否 | 设置后启用 Redis Pub/Sub 模式（多实例部署） |

**OpenClaw 容器内路径映射**：
| 容器路径 | 宿主机路径 | 说明 |
|---------|-----------|------|
| `/workspace/project/PKGM/users` | `/mnt/nas/project/PKGM/users` | 用户数据目录 |
| `/workspace/project/PKGM/manager` | `/mnt/nas/project/PKGM/manager` | PKGM-Manager 工作区 |

---

## 3. 部署步骤

### 3.1 前置准备

```bash
# 1. 确认 NAS 挂载正常
ls -la /mnt/nas/project/

# 2. 创建 PKGM 目录结构
mkdir -p /mnt/nas/project/PKGM/users/{alice,bob}/{content/{daily,uploads,tasks},assets,meta}
mkdir -p /mnt/nas/project/PKGM/manager/{skills,templates,logs}

# 3. 生成 .env 文件
cat > /mnt/nas/project/PKGM-Web/.env << 'EOF'
JWT_SECRET=<在此粘贴生成的密钥>
INDEXER_SECRET=<在此粘贴生成的密钥>
# REDIS_URL=redis://redis:6379  # 多实例部署时取消注释
EOF
chmod 600 /mnt/nas/project/PKGM-Web/.env

# 4. 生成强随机密钥（替换 <在此粘贴生成的密钥>）
# JWT_SECRET
openssl rand -base64 32
# INDEXER_SECRET
openssl rand -base64 32
```

### 3.2 启动服务

```bash
cd /mnt/nas/project/PKGM-Web

# 构建并启动
docker compose build
docker compose up -d

# 验证服务状态
docker compose ps
```

### 3.3 验证清单

```bash
# 1. 检查容器状态
docker compose ps
# 预期：openclaw, pkgm-web, pkgm-indexer 均为 Up

# 2. 检查日志
docker compose logs --tail=20 pkgm-indexer
# 预期：看到 "discovered X user(s)"

# 3. 测试 Indexer API
curl http://localhost:3004/users
# 预期：["alice", "bob"]

# 4. 测试 Indexer 健康检查
curl http://localhost:3004/health
# 预期：{"status":"healthy","nfs":{"status":"ok"},...}

# 5. 测试 Indexer 指标
curl http://localhost:3004/metrics
# 预期：Prometheus 格式指标

# 6. 测试 Web 健康检查
curl http://localhost:3001/api/health
# 预期：{"status":"healthy","checks":{"indexer":"healthy"},...}

# 7. 测试 Web 指标
curl http://localhost:3001/api/metrics
# 预期：Prometheus 格式指标

# 8. 测试 Web 访问
curl http://localhost:3001
# 预期：HTML 响应或 Next.js 页面

# 9. Redis 验证（如果启用了 REDIS_URL）
docker compose ps redis
# 预期：redis 容器 Up
docker exec pkgm-redis redis-cli ping
# 预期：PONG
```

---

## 4. Nginx 生产配置

### 4.1 基础代理配置

```nginx
# /etc/nginx/sites-available/pkgm-web

upstream pkgm-web {
    server 127.0.0.1:3001;
    keepalive 32;
}

server {
    listen 80;
    server_name docs.your-domain.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name docs.your-domain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # 强制 HTTPS
    add_header Strict-Transport-Security "max-age=63072000" always;

    # SSE 长连接（不缓冲，24h 超时）
    location ~ ^/docs/([^/]+)/api/events {
        proxy_pass http://pkgm-web;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        limit_conn addr 5;
    }

    # 用户路径代理
    location ~ ^/docs/([^/]+)/ {
        set $user $1;

        proxy_pass http://pkgm-web/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # API 路由
    location /api/ {
        proxy_pass http://pkgm-web;
        proxy_http_version 1.1;
    }

    # 静态资源
    location /_next/ {
        proxy_pass http://pkgm-web;
    }
}

# 限速区域
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=addr:10m;
```

### 4.2 SSL 证书配置

**方案 A：Let's Encrypt（推荐）**
```bash
# 安装 Certbot
sudo apt-get install certbot python3-certbot-nginx

# 自动获取并配置
sudo certbot --nginx -d docs.your-domain.com

# 自动续期已启用
sudo systemctl enable certbot.timer
```

**方案 B：自签名证书（测试/内网）**
```bash
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/key.pem \
  -out /etc/nginx/ssl/cert.pem \
  -subj "/C=CN/ST=Shanghai/L=Shanghai/O=PKGM/CN=docs.your-domain.com"
```

### 4.3 启用配置

```bash
sudo ln -sf /etc/nginx/sites-available/pkgm-web /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. 运维操作

### 5.1 服务管理

```bash
# 查看服务状态
docker compose ps

# 重启单个服务
docker compose restart pkgm-web
docker compose restart pkgm-indexer

# 全部重启
docker compose restart

# 停止所有服务
docker compose stop

# 重建服务
docker compose up -d --build pkgm-web
```

### 5.2 日志查看

```bash
# 实时日志
docker compose logs -f pkgm-web
docker compose logs -f pkgm-indexer
docker compose logs -f openclaw

# 最近 100 行
docker compose logs --tail=100 pkgm-indexer
```

### 5.3 健康检查

```bash
# 容器资源使用
docker stats openclaw pkgm-web pkgm-indexer

# Indexer 索引记录数
docker exec pkgm-indexer sqlite3 /workspace/project/PKGM/users/alice/meta/index.db \
    "SELECT COUNT(*) FROM documents;"

# Indexer 用户发现状态
docker logs pkgm-indexer | grep "discovered"
```

---

## 6. 备份与恢复

### 6.1 备份脚本

```bash
#!/bin/bash
# /opt/pkgm/backup.sh

DATE=$(date +%Y%m%d)
BACKUP_DIR="/backup/pkgm/$DATE"
mkdir -p "$BACKUP_DIR"

echo "[Backup] Starting backup for $DATE"

# 备份所有用户数据
for user_dir in /mnt/nas/project/PKGM/users/*/; do
    username=$(basename "$user_dir")
    mkdir -p "$BACKUP_DIR/users/$username"
    
    # 备份内容目录（黄金数据）
    rsync -avz "$user_dir/content/" "$BACKUP_DIR/users/$username/content/"
    
    # 备份 SQLite 数据库
    if [ -f "$user_dir/meta/index.db" ]; then
        cp "$user_dir/meta/index.db" "$BACKUP_DIR/users/$username/"
        # 注意：NFS 环境使用 DELETE 模式，无需备份 .wal/.shm
    fi
    
    echo "[Backup] Backed up $username"
done

# 保留最近 7 天
find /backup/pkgm -type d -mtime +7 -exec rm -rf {} \;

echo "[Backup] Completed: $BACKUP_DIR"
```

**Crontab 配置**：
```bash
# 每天凌晨 3 点备份
echo "0 3 * * * /opt/pkgm/backup.sh" | crontab -
```

### 6.2 灾难恢复

#### 场景 1：索引损坏（常见）

```bash
# 对每个用户执行
for user_dir in /mnt/nas/project/PKGM/users/*/; do
    username=$(basename "$user_dir")
    echo "重建 $username 索引..."
    rm -f "$user_dir/meta/index.db"*
done

# 重启 Indexer 触发全量扫描
docker compose restart pkgm-indexer
```

#### 场景 2：从备份恢复

```bash
#!/bin/bash
# /opt/pkgm/restore.sh

RESTORE_DATE="$1"  # 例如：20260415
if [ -z "$RESTORE_DATE" ]; then
    echo "Usage: $0 <YYYYMMDD>"
    exit 1
fi

BACKUP_DIR="/backup/pkgm/$RESTORE_DATE"
if [ ! -d "$BACKUP_DIR" ]; then
    echo "Backup not found: $BACKUP_DIR"
    exit 1
fi

echo "[Restore] Restoring from $BACKUP_DIR"

# 恢复所有用户
for user_backup_dir in "$BACKUP_DIR"/users/*/; do
    username=$(basename "$user_backup_dir")
    target_dir="/mnt/nas/project/PKGM/users/$username"
    
    # 恢复内容目录
    rsync -avz "$user_backup_dir/content/" "$target_dir/content/"
    
    # 恢复数据库
    if [ -f "$user_backup_dir/index.db" ]; then
        cp "$user_backup_dir/index.db" "$target_dir/meta/"
    fi
    
    echo "[Restore] Restored $username"
done

# 重启 Indexer
docker compose restart pkgm-indexer

echo "[Restore] Completed"
```

---

## 7. 故障排查

### 7.1 常见问题诊断表

| 问题 | 可能原因 | 诊断命令 | 解决方案 |
|------|---------|---------|---------|
| Indexer 未发现问题 | chokidar 未启动 | `docker logs pkgm-indexer` | 重启 Indexer |
| 中文搜索无结果 | jieba 未安装 | `docker exec pkgm-indexer npm list @node-rs/jieba` | 重新构建镜像 |
| SQLite Busy | 并发冲突 | `docker exec pkgm-indexer sqlite3 ... "PRAGMA busy_timeout;"` | 增加 timeout 或重试 |
| SSE 断开 | 连接超时 | 检查 Nginx 日志 | 调整 proxy_read_timeout |
| SSE 不更新（多实例） | Redis 未启动 | `docker compose ps redis` | 启动 Redis 或回滚到内存模式 |
| Redis 连接失败 | REDIS_URL 配置错误 | `docker logs pkgm-web \| grep redis` | 检查 REDIS_URL 格式 |
| 内存不足 | Indexer 泄漏 | `docker stats pkgm-indexer` | 增加 memory limit |

### 7.2 深度诊断

```bash
# 检查 NFS 挂载
mount | grep nas

# 检查目录权限
ls -la /mnt/nas/project/PKGM/users/

# 检查 Indexer 连接
docker exec pkgm-indexer node -e "
const Database = require('better-sqlite3');
const db = new Database('/workspace/project/PKGM/users/alice/meta/index.db');
console.log(db.pragma('journal_mode'));
db.close();
"

# 测试 Indexer API
curl -v http://localhost:3004/users

# Redis 健康检查
docker exec pkgm-redis redis-cli ping
docker exec pkgm-redis redis-cli info memory | grep used_memory_human

# 测试 SSE broker 模式
docker compose logs pkgm-web | grep "Using"
# 预期（内存模式）：[SSE] Using in-memory broker
# 预期（Redis 模式）：[SSE] Using Redis broker
```

---

## 附录

### A. 资源规划

| 服务 | CPU | 内存 | 磁盘 |
|------|-----|------|------|
| openclaw | 1.5 | 5.5G | ~5G |
| pkgm-web | 1.0 | 512M | ~200M |
| pkgm-indexer | 0.5 | 256M | ~50M |
| redis (可选) | 0.25 | 128M | ~10M |
| **总计** | **3.25** | **6.4G** | **~5.5G** |
| **总计（含 Redis）** | **3.5** | **6.5G** | **~5.5G** |

### B. 扩展方案

**水平扩展 Indexer**（多用户并发）：
```bash
docker compose up -d --scale pkgm-indexer=5
```

**垂直扩展**（增大资源）：
```yaml
# 修改 docker-compose.yml
pkgm-web:
    deploy:
        resources:
            limits:
                cpus: '2.0'
                memory: 1G
```

---

## 8. 多实例部署（SSE Redis Pub/Sub）

### 8.1 部署模式对比

| 模式 | SSE 实现 | 适用场景 |
|------|---------|---------|
| **单实例** | 内存 Set（默认） | 个人使用、小规模部署 |
| **多实例** | Redis Pub/Sub | 生产环境、水平扩展 |

### 8.2 启用 Redis 模式

**步骤 1：取消注释 Redis 服务**

```bash
# 编辑 docker-compose.yml
# 在 pkgm-web 的 depends_on 中添加 redis
# 在 pkgm-web 的 environment 中添加 REDIS_URL
```

**步骤 2：重建镜像**

```bash
cd /mnt/nas/project/PKGM-Web
docker compose build pkgm-web
docker compose up -d
```

**步骤 3：验证**

```bash
# 检查日志确认使用 Redis broker
docker compose logs pkgm-web | grep "Using Redis broker"
# 预期输出：[SSE] Using Redis broker

# 验证 Redis 连接
docker exec pkgm-redis redis-cli ping
# 预期：PONG
```

### 8.3 多实例架构

```
                    ┌──────────┐
    Nginx (LB) ────►│ Web 1   │ ──┐
                    ├──────────┤   │
                    │ Web 2   │ ──┼──► Redis Pub/Sub
    Indexer ───────►│ Web N   │ ──┘
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │  Redis   │
                    └──────────┘
```

### 8.4 Nginx 负载均衡配置

```nginx
upstream pkgm-web {
    # 方式 1：轮询（默认）
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;  # 第二个实例
    keepalive 32;

    # 方式 2：ip_hash（同一用户始终路由到同一实例）
    # ip_hash;
    # server 127.0.0.1:3001;
    # server 127.0.0.1:3002;
}

# SSE 端点需要长连接
location ~ ^/docs/([^/]+)/api/events {
    proxy_pass http://pkgm-web;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
}

# 复制多个端口
server {
    listen 3002;
    # ... 同 3001 配置
}
```

### 8.5 回滚到内存模式

如需回滚到单实例内存模式：

```bash
# 方式 1：注释掉 REDIS_URL
# 编辑 .env 或 docker-compose.yml
# 注释掉 REDIS_URL=redis://redis:6379

# 方式 2：重启即可
docker compose restart pkgm-web
# 日志应显示：[SSE] Using in-memory broker
```

---

*本文档为 PKGM-Web 项目的部署参考，详细架构信息请参见 ARCHITECTURE.md。*
*上次更新：2026-04-24*
