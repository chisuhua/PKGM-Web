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
└── pkgm-indexer (Node.js)          ← 索引服务，扫描所有用户
```

### 1.2 数据流向

```
用户对话 → OpenClaw → 原子写入 → /PKGM/users/{username}/content/
                                    ↓ inotify
                              pkgm-indexer → SQLite (WAL)
                                    ↓ HTTP POST
                              pkgm-web → SSE → 浏览器
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
    depends_on:
      - pkgm-indexer
    networks:
      - pkgm-net
    deploy:
      resources:
        limits:
          memory: "512m"
          cpus: "1.0"

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
```

### 2.2 环境变量

**根目录 `.env` 文件**：
```bash
# JWT_SECRET（部署前必须修改为强随机密钥）
JWT_SECRET=<生成的安全密钥>
```

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

# 3. 生成 JWT_SECRET
openssl rand -base64 32 > /mnt/nas/project/PKGM-Web/.env
echo "JWT_SECRET=$(cat /mnt/nas/project/PKGM-Web/.env)" >> /mnt/nas/project/PKGM-Web/.env
chmod 600 /mnt/nas/project/PKGM-Web/.env
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

# 4. 测试 Web 访问
curl http://localhost:3001
# 预期：HTML 响应或 Next.js 页面
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
```

---

## 附录

### A. 资源规划

| 服务 | CPU | 内存 | 磁盘 |
|------|-----|------|------|
| openclaw | 1.5 | 5.5G | ~5G |
| pkgm-web | 1.0 | 512M | ~200M |
| pkgm-indexer | 0.5 | 256M | ~50M |
| **总计** | **3.0** | **6.2G** | **~5.5G** |

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

*本文档为 PKGM-Web 项目的部署参考，详细架构信息请参见 ARCHITECTURE.md。*
*上次更新：2026-04-22*
