# PKGM-Web 部署架构文档 v2.0

**版本**: V2.0
**创建日期**: 2026-04-16
**最后更新**: 2026-04-16
**基于**: 
- PKGM-Web 架构提案 v4.0
- 现有 aidev2 容器配置
- 统一 Docker Compose 方案
- 完整回滚与灾难恢复方案
**状态**: 待实施

---

## 1. 部署架构

### 1.1 整体架构

```
宿主机 (ECS)
├── ~/workspace/home/my-docker-env/compose/
│   └── docker-compose.yml    ← 统一编排
│
├── /mnt/nas/project/PKGM/users/    ← 共享数据目录 (NAS)
│   ├── alice/
│   │   ├── agent-workspace/
│   │   ├── content/{daily,uploads,tasks}/
│   │   ├── assets/
│   │   └── meta/index.db
│   ├── bob/
│   └── ...
│
└── ~/workspace/                    ← OpenClaw 工作空间
    ├── home/.openclaw/             ← OpenClaw 配置
    ├── project/                    ← 项目目录
    └── ...
```

### 1.2 容器拓扑

```
docker-compose.yml (统一编排)
├── openclaw (my-aidev:v1.0.2)    ← OpenClaw Agent，生成 Markdown
├── pkgm-web (Next.js)            ← 前端展示，只读挂载用户目录
└── pkgm-indexer (Node.js)        ← 索引服务，扫描所有用户
```

### 1.3 数据流向

```
用户对话 → OpenClaw → 原子写入 → /PKGM/users/{username}/content/
                                    ↓ inotify
                              pkgm-indexer → SQLite (WAL)
                                    ↓ HTTP POST
                              pkgm-web → SSE → 浏览器
```

---

## 2. Docker Compose 配置

### 2.1 统一编排

> **前置要求**：前端代码（`PKGM-Web/web/`）和 Indexer 代码（`PKGM-Web/indexer/`）需要先实现。
> Phase 1 MVP 可先用简单页面（见架构文档 §8 验收清单），不必等完整前端。

```yaml
# ~/workspace/home/my-docker-env/compose/docker-compose.yml
version: '3.8'

services:
  # ============================================
  # OpenClaw Agent（原 aidev2 容器）
  # ============================================
  openclaw:
    image: my-aidev:v1.0.2
    container_name: openclaw
    privileged: true
    restart: always
    memory: "5.5g"
    memory-swap: "9g"
    cpus: "1.7"
    oom-score-adj: 500
    working_dir: /workspace
    ports:
      - "127.0.0.1:18789:18789"   # OpenClaw Web UI
      - "127.0.0.1:50080:50080"   # 其他服务端口
      - "127.0.0.1:8001:8001"
      - "127.0.0.1:8002:8002"
      - "127.0.0.1:8003:8003"
    volumes:
      # 用户配置
      - ~/workspace/home/.config:/home/ubuntu/.config:rw
      - ~/workspace/home/.bashrc:/home/ubuntu/.bashrc:ro
      - ~/workspace/home/.openclaw:/home/ubuntu/.openclaw:rw
      - ~/workspace/home/.claude:/home/ubuntu/.claude:rw
      - ~/workspace/home/.claude.json:/home/ubuntu/.claude.json:ro
      - ~/workspace/home/.ssh:/home/ubuntu/.ssh:rw
      - ~/workspace/home/.agents:/home/ubuntu/.agents:rw
      - ~/workspace/home/.tmux:/home/ubuntu/.tmux:rw
      - ~/workspace/home/.tmuxinator:/home/ubuntu/.tmuxinator:rw
      - ~/workspace/home/.tmux.conf:/home/ubuntu/.tmux.conf:ro
      - ~/workspace/home/.local/share:/home/ubuntu/.local/share:rw
      - ~/workspace/home/.gitconfig:/home/ubuntu/.gitconfig:ro
      # 工具链
      - ~/workspace/home/venv:/home/ubuntu/venv:rw
      - ~/workspace/home/.bun/bin:/home/ubuntu/.bun/bin:rw
      - ~/workspace/home/.bun/install/global:/home/ubuntu/.bun/install/global:rw
      # 工作空间
      - ~/workspace:/workspace:rw
      - /mnt/nas/project:/workspace/project:rw
    command: ["tail", "-f", "/dev/null"]

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
      context: ~/workspace/project/PKGM-Web
      dockerfile: web/Dockerfile
    container_name: pkgm-web
    restart: unless-stopped
    memory: "512m"
    cpus: "1.0"
    ports:
      - "127.0.0.1:3001:3001"
    volumes:
      # 只读挂载所有用户目录
      - /mnt/nas/project/PKGM/users:/workspace/project/PKGM/users:ro
    env_file:
      - ./compose/.env  # JWT_SECRET
    environment:
      - NODE_ENV=production
      - PORT=3001
      - PKGM_USERS_DIR=/data/users
      - MULTI_USER=true
    depends_on:
      - openclaw
    networks:
      - pkgm-net

  # ============================================
  # PKGM-Web Indexer（索引服务）
  # ============================================
  pkgm-indexer:
    build:
      context: ~/workspace/project/PKGM-Web
      dockerfile: indexer/Dockerfile
    container_name: pkgm-indexer
    restart: unless-stopped
    memory: "256m"
    cpus: "0.5"
    volumes:
      # 读写挂载用户目录（与 OpenClaw 共享 NAS）
      - /mnt/nas/project/PKGM/users:/workspace/project/PKGM/users:rw
    env_file:
      - ./compose/.env  # JWT_SECRET（可选，如果 Indexer 需要验证）
    environment:
      - NODE_ENV=production
      - PKGM_USERS_DIR=/data/users
      - WEB_HOST=pkgm-web
      - WEB_PORT=3001
      - MULTI_USER=true
    depends_on:
      - openclaw
      - pkgm-web
    networks:
      - pkgm-net

networks:
  pkgm-net:
    driver: bridge
```

---

## 3. 迁移步骤

### 3.1 停止现有容器

```bash
# 停止 aidev2
docker stop aidev2

# 备份当前配置
mkdir -p ~/workspace/home/my-docker-env/backup
cp ~/workspace/home/my-docker-env/start_container.sh ~/workspace/home/my-docker-env/backup/start_container.sh.bak
```

### 3.2 创建 Compose 目录

```bash
mkdir -p ~/workspace/home/my-docker-env/compose
# 将上面的 docker-compose.yml 保存到 compose/docker-compose.yml
```

### 3.3 创建 PKGM 目录结构

```bash
# 在 NAS 上创建 PKGM 目录
mkdir -p /mnt/nas/project/PKGM/users/{alice,bob,carol}/{content/{daily,uploads,tasks},assets,meta}
mkdir -p /mnt/nas/project/PKGM/manager/{skills/{create-agent,manage-session,query-status,delete-agent},templates,logs}

# 初始化 SQLite（空库）
for user in alice bob carol; do
    sqlite3 /mnt/nas/project/PKGM/users/$user/meta/index.db "SELECT 1;"
done
```

### 3.3.1 PKGM-Manager 引导（一次性手动操作）

PKGM-Manager 不是自创建的，它是**系统首次部署时手动引导**创建的。

```bash
# Step 1: 写入 PKGM-Manager SOUL.md
cat > /mnt/nas/project/PKGM/manager/SOUL.md << 'SOULEOF'
# SOUL.md — PKGM-Manager

**身份**: PKGM 系统管理员
**职责**: 管理所有用户 Agent 的生命周期

## 核心能力
1. 创建用户 Agent（目录 + SOUL.md + 配置注册）
2. 管理用户 Agent 会话
3. 查询系统状态
4. 执行系统维护

## 执行纪律
- 创建 Agent 必须验证用户名唯一性
- 删除 Agent 必须二次确认
- 所有操作完成后必须验证结果
- 所有操作必须写入审计日志
SOULEOF

# Step 2: 写入 SOUL 模板
cat > /mnt/nas/project/PKGM/manager/templates/SOUL_TEMPLATE.md << 'TMPEOF'
# SOUL.md — {username} 的专属 AI 助手

**角色**: {role}

你是用户 {username} 的专属 AI 助手，一位{role}。

## 工作目录
- 工作区: /workspace/project/PKGM/users/{username}/agent-workspace/
- 内容输出: /workspace/project/PKGM/users/{username}/content/

## 写入规则
- 所有 Markdown 文件必须写入 content/ 目录
- 使用原子写入（临时文件 → fsync → rename）
- 必须包含 Frontmatter 元数据
TMPEOF

# Step 3: 写入 System Prompt 模板
cat > /mnt/nas/project/PKGM/manager/templates/USER_PROMPT.md << 'PROMPTEOF'
你是用户 {username} 的专属 AI 助手。

你的工作目录：/workspace/project/PKGM/users/{username}/agent-workspace/
内容输出目录：/workspace/project/PKGM/users/{username}/content/

**角色**: {role}

**写入规则**：
- 生成的 Markdown 文件必须写入 content/ 目录
- 使用原子写入（临时文件 + fsync + rename）
- 必须包含 Frontmatter 元数据（title, type, status）
- status: 生成中为 "writing"，完成后改为 "completed"
PROMPTEOF

# Step 4: 写入技能文件
# 详见架构文档 §3.4 技能详细实现
# 每个技能目录下的 SKILL.md 按文档定义编写

# Step 5: 注册 PKGM-Manager Agent（使用 openclaw agents add）
# 在宿主机执行（不需要进容器）
openclaw agents add pkgm-manager \
  --name "PKGM-Manager" \
  --workspace "/workspace/project/PKGM/manager/" \
  --system-prompt "你是 PKGM 系统管理员，负责管理所有用户 Agent 的生命周期。"

# Step 6: 重启 Gateway 使配置生效
openclaw gateway restart
```

**验证 PKGM-Manager 就绪**：

```bash
# 通过 OpenClaw 会话与 PKGM-Manager 对话
# 指令: "查看系统状态"
# 预期输出: 系统状态报告
```

### 3.4 环境变量配置

#### 3.4.1 JWT_SECRET 生成与设置

**JWT_SECRET 是部署时预生成的强随机密钥**，所有服务实例必须共享同一个密钥。

```bash
# 生成密钥（256 位）
export JWT_SECRET_PROD=$(openssl rand -base64 32)
echo "Generated JWT_SECRET: $JWT_SECRET_PROD"

# 保存到环境变量文件（权限保护）
echo "JWT_SECRET=$JWT_SECRET_PROD" > ~/workspace/home/my-docker-env/compose/.env
chmod 600 ~/workspace/home/my-docker-env/compose/.env
```

**安全规则**：
| 规则 | 原因 |
|------|------|
| 长度 ≥32 字符 | 防暴力破解 |
| 不提交 Git | `.env` 加入 `.gitignore` |
| 多实例共享同一密钥 | 避免随机验签失败 |
| 轮换密钥 = 所有用户掉线 | 谨慎操作 |

#### 3.4.2 其他环境变量

```bash
# PKGM-Web
PORT=3001
NODE_ENV=production
PKGM_USERS_DIR=/data/users
MULTI_USER=true

# PKGM-Indexer
PKGM_USERS_DIR=/data/users
WEB_HOST=pkgm-web
WEB_PORT=3001
MULTI_USER=true
```

### 3.5 启动统一编排

```bash
cd ~/workspace/home/my-docker-env/compose

# 构建并启动
docker compose build
docker compose up -d

# 验证
docker compose ps
```

### 3.6 验证清单

```bash
# 1. OpenClaw 可访问
curl -I http://localhost:18789

# 2. PKGM-Web 可访问
curl http://localhost:3001/docs/alice/

# 3. Indexer 日志
docker logs pkgm-indexer

# 4. 测试写入（通过 OpenClaw 生成文件）
# 在 OpenClaw 中触发文档生成，观察 /mnt/nas/project/PKGM/users/alice/content/ 是否有新文件

# 5. 测试索引
sleep 1  # 等防抖
docker exec pkgm-indexer sqlite3 /data/users/alice/meta/index.db "SELECT title FROM documents;"
```

### 3.7 Indexer 用户自动发现

Indexer 启动时自动扫描 `/data/users/` 目录下所有子目录，无需手动配置用户列表：

```javascript
// indexer.js - 启动时自动发现用户
const usersDir = process.env.PKGM_USERS_DIR || '/data/users';
const users = fs.readdirSync(usersDir).filter(d => fs.statSync(path.join(usersDir, d)).isDirectory());

console.log(`发现 ${users.length} 个用户: ${users.join(', ')}`);

// 对每个用户启动监控
users.forEach(username => {
    const watchPath = path.join(usersDir, username, 'content/**/*.md');
    const dbPath = path.join(usersDir, username, 'meta/index.db');
    startWatching(username, watchPath, dbPath);
});
```

**效果**：新增用户后无需重启 Indexer，新目录自动被 chokidar 监控。

### 3.8 首次用户注册

部署完成后，第一个用户的创建方式：

**方式 A：通过 PKGM-Manager 对话**（推荐）

```
在 OpenClaw 中与 PKGM-Manager 对话：

用户: "创建用户 Agent，名字叫 alice，角色是资深代码审查员"
PKGM-Manager: 执行 create-agent 技能
         ↓
    1. 创建目录结构
    2. 生成 SOUL.md
    3. 注册 Agent 配置
    4. 重启 Gateway
    5. 初始化 SQLite
         ↓
PKGM-Manager: "Agent alice 创建成功。工作区：/workspace/project/PKGM/users/alice/。"
```

**方式 B：通过 PKGM-Web 注册页面**

```
1. 访问 https://docs.your-domain.com/register
2. 输入用户名 + 密码
3. 后端调用 PKGM-Manager 创建 Agent
4. 自动登录
```

> ⚠️ 方式 B 需要前端注册页面已实现。Phase 1 建议先用方式 A。

---

## 4. Nginx 生产配置

### 4.1 Nginx 生产配置

```nginx
# /etc/nginx/sites-available/pkgm-web
upstream pkgm-web {
    server 127.0.0.1:3001;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name docs.your-domain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # 强制 HTTPS
    add_header Strict-Transport-Security "max-age=63072000" always;

    # 登录端点（限速防暴力破解）
    location /api/auth/login {
        proxy_pass http://pkgm-web;
        limit_req zone=login_limit burst=3 nodelay;
    }

    # SSE 长连接（不缓冲，24h 超时）
    location ~ ^/docs/([^/]+)/api/notify {
        proxy_pass http://pkgm-web;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        limit_conn addr 5;
    }

    # 用户路径隔离（Nginx 正则捕获 → Header 传递）
    location ~ ^/docs/([^/]+)/ {
        set $user $1;

        proxy_pass http://pkgm-web/;
        proxy_set_header X-User-ID $user;
        proxy_set_header X-User-Path /data/users/$user;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 登录页/注册页/静态资源（放行）
    location /login { proxy_pass http://pkgm-web; }
    location /register { proxy_pass http://pkgm-web; }
    location /_next/ { proxy_pass http://pkgm-web; }

    # 搜索 API（限速）
    location ~ ^/docs/([^/]+)/api/search {
        set $user $1;
        proxy_pass http://pkgm-web/;
        proxy_set_header X-User-ID $user;
        limit_req zone=search_limit burst=10 nodelay;
    }

    # 静态资源（Nginx 直出）
    location ~ ^/assets/(.*)$ {
        alias /mnt/nas/project/PKGM/assets/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
}

# 限速区域
limit_req_zone $binary_remote_addr zone=login_limit:10m rate=1r/s;
limit_req_zone $binary_remote_addr zone=search_limit:10m rate=5r/s;
limit_conn_zone $binary_remote_addr zone=addr:10m;
```

**路径重写说明**：

```
用户请求: /docs/alice/content/daily/test.md
         ↓ Nginx regex 捕获
    $user = alice
         ↓ proxy_pass 结尾 / 重写
    发送给 Next.js: /content/daily/test.md
         ↓ Headers
    X-User-ID: alice
    X-User-Path: /data/users/alice
```

**认证边界**：
- **Nginx 层**：只负责路径分发和限速
- **Next.js 层**：JWT 校验 + 用户权限判断
- **Middleware 校验**：验证 cookie 中的 JWT 用户名与 `X-User-ID` 匹配

### 4.2 SSL 证书配置

**方案 A：Let's Encrypt（推荐，公网部署）**

```bash
# 安装 Certbot
sudo apt-get install certbot python3-certbot-nginx

# 自动获取并配置 Nginx
sudo certbot --nginx -d docs.your-domain.com

# 自动续期
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

## 5. 资源规划

### 5.1 当前配置

| 服务 | CPU | 内存 | 磁盘 |
|------|-----|------|------|
| openclaw | 1.7 | 5.5G | ~5G (配置+工具) |
| pkgm-web | 1.0 | 512M | ~200M (代码) |
| pkgm-indexer | 0.5 | 256M | ~50M (代码) |
| **总计** | **3.2** | **6.2G** | **~5.3G** |

### 5.2 扩展方案

**水平扩展 Indexer**（多用户并发）：
```bash
# 扩展到 5 个 Indexer 实例
docker compose up -d --scale pkgm-indexer=5
```

**垂直扩展**（增大资源）：
```yaml
# 修改 docker-compose.yml 后重启
pkgm-web:
    cpus: '2.0'
    mem_limit: 1G
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

# 备份所有用户 SQLite（WAL 模式）
for user_dir in /mnt/nas/project/PKGM/users/*/; do
    username=$(basename "$user_dir")
    mkdir -p "$BACKUP_DIR/users/$username"
    
    # SQLite 三文件
    cp "$user_dir/meta/index.db"* "$BACKUP_DIR/users/$username/" 2>/dev/null
    
    # 源文件（黄金数据）
    rsync -avz "$user_dir/content/" "$BACKUP_DIR/users/$username/content/"
done

# 保留最近 7 天
find /backup/pkgm -type d -mtime +7 -exec rm -rf {} \;

echo "Backup completed: $BACKUP_DIR"
```

```bash
# Crontab
echo "0 3 * * * /opt/pkgm/backup.sh" | crontab -
```

### 6.2 灾难恢复

#### 场景 1：索引损坏（常见）

```bash
# 从文件重建索引（终极兜底）
rm -f /mnt/nas/project/PKGM/users/alice/meta/index.db*
docker restart pkgm-indexer  # 自动全量扫描重建
```

#### 场景 2：容器故障

```bash
# 重启单个服务
docker compose restart pkgm-indexer
docker compose restart pkgm-web

# 全部重启
docker compose restart
```

#### 场景 3：从备份恢复

```bash
# 恢复指定日期的备份
RESTORE_DATE="20260415"
for user_dir in /backup/pkgm/$RESTORE_DATE/users/*/; do
    username=$(basename "$user_dir")
    cp "$user_dir/meta/index.db"* /mnt/nas/project/PKGM/users/$username/meta/
    rsync -avz "$user_dir/content/" /mnt/nas/project/PKGM/users/$username/content/
done
docker restart pkgm-indexer
```

---

## 7. 回滚策略

### 7.1 分级回滚表

| 场景 | 严重性 | 回滚命令 | 数据影响 | 恢复时间 |
|------|--------|---------|---------|----------|
| PKGM-Web 前端 bug | 🟡 中 | `docker compose stop pkgm-web`<br>`docker compose up -d pkgm-web` | 前端停止，数据无影响 | <1min |
| Indexer 索引错误 | 🟡 中 | `docker compose restart pkgm-indexer` | 自动重建索引 | 1-5min |
| SQLite 数据库损坏 | 🔴 高 | `rm -f .../index.db* && docker restart pkgm-indexer` | 索引丢失，源文件安全 | 5-10min |
| OpenClaw 容器故障 | 🔴 高 | `docker compose restart openclaw` | 服务中断，数据无影响 | 2-3min |
| Gateway 配置错误 | 🔴 高 | 恢复旧 docker-compose.yml<br>`docker compose up -d openclaw` | 需重启 Gateway | 3-5min |
| 全系统故障 | ⚫ 严重 | 从 NAS 备份恢复 | 最多丢失当天未备份数据 | 30min |

### 7.2 完整灾难恢复流程

**步骤 1：评估故障范围**

```bash
# 检查所有容器状态
docker compose ps

# 检查日志
docker compose logs --tail=50 pkgm-web
docker compose logs --tail=50 pkgm-indexer

# 检查磁盘空间
df -h /mnt/nas

# 检查 SQLite 完整性
for user_dir in /mnt/nas/project/PKGM/users/*/; do
    username=$(basename "$user_dir")
    sqlite3 "$user_dir/meta/index.db" "PRAGMA integrity_check;"
done
```

**步骤 2：尝试快速恢复**

```bash
# 尝试重启故障服务
docker compose restart <service_name>

# 等待 30 秒后检查状态
sleep 30 && docker compose ps
```

**步骤 3：重建索引（如 SQLite 损坏）**

```bash
# 对每个用户执行
for user_dir in /mnt/nas/project/PKGM/users/*/; do
    username=$(basename "$user_dir")
    echo "重建 $username 索引..."
    rm -f "$user_dir/meta/index.db"*
    # 创建空库
    sqlite3 "$user_dir/meta/index.db" "SELECT 1;"
done

# 重启 Indexer 触发全量扫描
docker restart pkgm-indexer
```

**步骤 4：从备份恢复（最坏情况）**

```bash
# 1. 停止所有服务
docker compose stop

# 2. 恢复备份
RESTORE_DATE="20260415"
for user_dir in /backup/pkgm/$RESTORE_DATE/users/*/; do
    username=$(basename "$user_dir")
    echo "恢复 $username..."
    rm -rf "/mnt/nas/project/PKGM/users/$username"
    mkdir -p "/mnt/nas/project/PKGM/users/$username"
    cp "$user_dir/meta/index.db"* "/mnt/nas/project/PKGM/users/$username/meta/"
    rsync -avz "$user_dir/content/" "/mnt/nas/project/PKGM/users/$username/content/"
done

# 3. 重启所有服务
docker compose up -d

# 4. 验证恢复
docker compose ps
curl http://localhost:3001/docs/alice/
```

---

## 8. 监控与健康检查

### 8.1 健康检查端点

```typescript
// pkgm-web: /api/health
export async function GET() {
    return NextResponse.json({ status: 'ok', timestamp: Date.now() });
}
```

### 8.2 监控命令

```bash
# 容器状态
docker compose ps

# 资源使用
docker stats openclaw pkgm-web pkgm-indexer

# 日志查看
docker compose logs -f pkgm-indexer    # Indexer 日志
docker compose logs -f pkgm-web        # Web 日志
docker compose logs -f openclaw        # OpenClaw 日志

# SQLite 数据库状态
docker exec pkgm-indexer sqlite3 /data/users/alice/meta/index.db \
    "SELECT COUNT(*) FROM documents;"
```

---

## 9. 未来扩展路线

### 9.1 K8s 迁移

```bash
# 使用 kompose 转换
kompose convert -f docker-compose.yml -o k8s/

# 部署到 K8s
kubectl apply -f k8s/
```

### 9.2 弹性伸缩

```yaml
# K8s HPA（基于 CPU）
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: pkgm-indexer
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: pkgm-indexer
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

### 9.3 分布式存储

当前：NAS 文件系统 → 未来：S3/MinIO 对象存储

```yaml
# 未来可改用 S3 挂载
volumes:
  - type: s3
    source: pkgm-users-bucket
    target: /data/users
```

---

## 10. 部署检查清单

- [ ] aidev2 容器已停止
- [ ] docker-compose.yml 已创建
- [ ] .env 文件已生成（JWT_SECRET）
- [ ] .env 未提交 Git（.gitignore 包含 .env）
- [ ] PKGM 用户目录已创建
- [ ] PKGM-Manager 已引导（SOUL.md + 技能 + Agent 注册）
- [ ] PKGM-Manager 验证就绪
- [ ] SQLite 初始数据库已创建
- [ ] SSL 证书已配置（Let's Encrypt 或自签名）
- [ ] `docker compose up -d` 成功
- [ ] OpenClaw 可访问（:18789）
- [ ] PKGM-Web 可访问（:3001）
- [ ] Indexer 自动发现用户
- [ ] Nginx 配置已生效
- [ ] 首个用户已创建
- [ ] 备份脚本已配置
- [ ] 监控命令已验证

---

*本文档由 DevMate 基于统一 Docker Compose 方案生成。*
*版本: V1.0 | 2026-04-16*
