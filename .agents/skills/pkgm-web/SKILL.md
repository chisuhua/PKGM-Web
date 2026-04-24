---
name: pkgm-web-environment
description: PKGM-Web 项目环境感知技能。当在 PKGM-Web 项目中工作时自动激活，提供 OpenClaw 容器环境、宿主机访问、数据路径和 Docker 操作指导。
---

# PKGM-Web 环境感知

本技能帮助你在 PKGM-Web 项目中正确理解和使用环境。

## 环境概述

**你运行在 OpenClaw 容器内。** 这是一个特权容器，通过 supervisord 管理多个服务。

## 关键路径映射

| 容器内路径 | 宿主机路径 | 说明 |
|-----------|-----------|------|
| `/workspace/project` | `/mnt/nas/project` | 项目代码目录 |
| `/workspace/project/PKGM-Web` | `/mnt/nas/project/PKGM-Web` | PKGM-Web 项目 |
| `/workspace/project/PKGM` | `/mnt/nas/project/PKGM` | 用户数据目录 |

## 访问宿主机

如果需要测试 HTTP 接口或检查服务状态，可以 SSH 到宿主机：

```bash
ssh dev@47.100.102.207
```

在宿主机上可以：
- 使用 `curl` 测试 API 端点
- 使用 `docker compose` 命令管理服务
- 查看日志

### 测试示例

```bash
# 测试 Web 服务
curl http://localhost:3001

# 测试 Indexer API
curl http://localhost:3004/users

# 查看容器状态
docker compose -f /mnt/nas/project/PKGM-Web/docker-compose.yml ps

# 重启服务
docker compose -f /mnt/nas/project/PKGM-Web/docker-compose.yml restart pkgm-indexer
```

## 项目文件操作

**修改代码**：在容器内直接编辑 `/workspace/project/PKGM-Web/` 下的文件

**修改会生效**：
- Web 代码：需要重新构建 Docker 镜像或重启容器
- Indexer 代码：重启 `pkgm-indexer` 服务即可

**数据文件**：位于 `/workspace/project/PKGM/` 下，包括：
- 用户文档：`/workspace/project/PKGM/users/{username}/content/`
- SQLite 数据库：`/workspace/project/PKGM/users/{username}/meta/index.db`

## 需要谨慎的操作

### 需要用户协助的操作

以下操作需要 sudo 权限或影响系统配置，**请停下并告诉用户来执行**：

- 修改 `/etc/nginx/` 配置
- 修改系统服务配置
- 修改 Docker 系统级配置
- 修改用户数据目录权限

### 可自行执行的操作

- 编辑 `/workspace/project/PKGM-Web/` 下的代码
- 通过 `docker compose` 重启服务
- 使用 `curl` 测试 API
- 读取日志（`docker compose logs`）

## Docker 服务管理

```bash
# 查看服务状态
docker compose -f /mnt/nas/project/PKGM-Web/docker-compose.yml ps

# 查看日志
docker compose -f /mnt/nas/project/PKGM-Web/docker-compose.yml logs pkgm-web
docker compose -f /mnt/nas/project/PKGM-Web/docker-compose.yml logs pkgm-indexer

# 重启服务
docker compose -f /mnt/nas/project/PKGM-Web/docker-compose.yml restart pkgm-web
docker compose -f /mnt/nas/project/PKGM-Web/docker-compose.yml restart pkgm-indexer

# 重建服务
docker compose -f /mnt/nas/project/PKGM-Web/docker-compose.yml up -d --build pkgm-web
```

## 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| pkgm-web | 3001 | Next.js 前端 |
| pkgm-indexer | 3004 | 索引服务 API |

## 索引重建

如果索引数据损坏，可以重建：

```bash
# 在宿主机上执行
ssh dev@47.100.102.207
rm -f /mnt/nas/project/PKGM/users/{username}/meta/index.db*
docker compose -f /mnt/nas/project/PKGM-Web/docker-compose.yml restart pkgm-indexer
```

## 工作流程建议

1. **修改代码** → 在容器内编辑 `/workspace/project/PKGM-Web/`
2. **验证修改** → SSH 到宿主机，用 `curl` 测试
3. **重启服务** → 在宿主机上用 `docker compose restart`
4. **检查日志** → `docker compose logs -f pkgm-indexer`
