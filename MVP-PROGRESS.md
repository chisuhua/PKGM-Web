# PKGM-Web MVP 进度报告

**版本**: v1.1
**创建日期**: 2026-04-22
**最后更新**: 2026-04-22 15:30
**项目路径**: `/workspace/project/PKGM-Web`
**群聊 ID**: `chat:oc_a1075829be1b03f1a41ff11b7b56e7f4`

---

## 一、项目概述

PKGM-Web 是 PKGM（Personal Knowledge Graph Manager）的**展示层**，负责：
- 渲染 AI Agent 生成的 Markdown 文档（日报、任务、知识图谱）
- 提供全文搜索能力（SQLite FTS5 + jieba 分词）
- 实时推送文档更新（SSE）
- 多租户隔离：每个用户独立目录 + 独立 Agent + 独立 SQLite

### 核心技术栈

| 层级 | 技术选型 |
|------|---------|
| 前端框架 | Next.js |
| 数据库 | SQLite + FTS5 |
| 中文分词 | @node-rs/jieba |
| 文件监控 | chokidar |
| 实时推送 | SSE (Server-Sent Events) |
| 容器编排 | docker-compose |

---

## 二、架构文档

完整架构方案见 `docs/ARCHITECTURE.md`（v5.0, 2026-04-16）

---

## 三、MVP 开发阶段

| 阶段 | 内容 | 状态 |
|------|------|------|
| **Phase 0** | 基础设施（目录权限、Nginx、docker-compose） | ✅ 完成 |
| **Phase 1** | Indexer 多用户版（chokidar watch + FTS5 入库） | ✅ 完成 |
| **Phase 2** | Next.js 前端（多用户列表页 + Markdown 渲染） | ✅ 完成 |
| **Phase 3** | 搜索功能（中文分词 + SSE 实时更新 + search highlighting） | ✅ 完成 |
| **Phase 4** | Docker 化（镜像构建 + 资源限制 + 备份脚本） | 🔄 部分完成 |

---

## 四、当前完成状态

### 4.1 代码完成度

| 组件 | 文件 | 状态 |
|------|------|------|
| 架构文档 | `docs/ARCHITECTURE.md` | ✅ 完整 |
| docker-compose.yml | `docker-compose.yml` | ✅ 完整（3 服务） |
| Indexer | `indexer/index.js` | ✅ 代码完成 |
| Next.js 前端 | `web/` | ✅ Build 完成 |
| Nginx 配置 | `nginx/` | ✅ 就绪 |
| 备份脚本 | `docs/` | 🔄 待完善 |

### 4.2 Git 提交历史

```
c8f5387 fix: always init FTS table (porter) in getUserDB; use wildcard suffix for FTS5 search
539af54 fix: use wildcard suffix (*) in FTS5 search for Porter stemmer case normalization
0e99f8f fix: change FTS5 tokenizer from porter to unicode61
d482452 fix: use bm25() instead of non-existent rank column in FTS5 search
9a28794 update gitignore
0cbc49b remove unwanted
20c342c fix: phase3 search highlighting
42d2bbd checkpoint: phase3 pre-fix
70386e2 pkgm-web
9792eb0 feat: PKGM-Web MVP initial commit
89a81fb initial commit
```

### 4.3 Docker 状态

- **容器状态**: ✅ 全部在线（2026-04-22 启动）
- **服务**: openclaw + pkgm-web + pkgm-indexer（三服务 docker-compose）
- **验证结果**:
  - `curl localhost:3004/users` → `["alice"]`
  - `curl localhost:3004/docs/alice` → 4 篇文档
  - `curl localhost:3004/search/alice?q=recover` → 3 结果 ✅

---

## 五、剩余工作

### 5.1 验证完成项

| 验收项 | 状态 | 说明 |
|--------|------|------|
| Docker 容器启动 | ✅ | openclaw, pkgm-web, pkgm-indexer 全部在线 |
| Phase 0 目录权限 | ✅ | `/workspace/project/PKGM/users/` 正常 |
| Phase 0 Nginx 通路 | ✅ | `www.hydraskill.com` 代理正常 |
| Phase 1 Indexer 入库 | ✅ | 4 文档成功索引 |
| Phase 2 Next.js 渲染 | ✅ | 列表页正常 |
| Phase 3 搜索（英文） | ✅ | FTS5 + jieba 分词正常 |

### 5.2 剩余工作

| 任务 | 优先级 | 说明 |
|------|--------|------|
| **Phase 4 完善** | 🟡 中 | 资源限制验证、备份脚本完善 |
| **中文搜索验证** | 🟡 中 | 确认中文关键词能搜到 |
| **多用户注册流程** | 🟡 中 | 端到端测试（注册 → 登录 → 使用） |
| **PKGM-Manager Agent** | 🟡 中 | 用户 Agent 生命周期管理（架构已定义，代码未实现） |
| **SSE 实时推送验证** | 🟡 中 | 新增文件验证 SSE 推送 |
| **文档补充** | 🟡 中 | README、部署文档 |

---

## 六、Phase 3 修复记录（2026-04-22）

### 问题 1: FTS5 `rank` 列不存在
- **原因**: FTS5 没有 `rank` 列，应使用 `bm25()` 函数
- **修复**: `ORDER BY rank` → `ORDER BY bm25(documents_fts)`
- **提交**: `d482452`

### 问题 2: Porter Stemmer 大小写不匹配
- **现象**: `recover` 查询不到 `Recovery`（Porter stemmer 干掉了 `y`）
- **根因**: FTS5 Porter tokenizer 对 query 和 indexed content 处理不一致
- **修复**: 搜索词加 wildcard 后缀 `jieba.cut(query).map(t => t + '*').join(' ')`
- **提交**: `c8f5387`

### 问题 3: FTS 表重启后丢失
- **原因**: `getUserDB` 中条件初始化，NFS 共享导致旧 DB 被复用
- **修复**: 改为幂等初始化，每次调用都 `CREATE VIRTUAL TABLE IF NOT EXISTS`
- **提交**: `c8f5387`

---

## 七、Nginx 配置

**文件**: `/mnt/nas/project/PKGM-Web/nginx/pkgm-web`

```
server {
    listen 80;
    server_name www.hydraskill.com;
    
    location ~ ^/docs/([^/]+)/ {
        set $user $1;
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header X-User-ID $user;
        ...
    }
}
```

**验证**:
- `curl -H 'Host: www.hydraskill.com' http://127.0.0.1/docs/alice/api/search?q=Recovery` → 3 结果 ✅

---

## 八、下一步行动

1. **中文搜索验证** — `curl 'localhost:3004/search/alice?q=实时'` 目前返回空，需要调查
2. **SSE 推送测试** — 新增文件后验证 SSE 实时推送
3. **端到端测试** — 注册 → 登录 → 使用完整流程
4. **Phase 4 完善** — 资源限制验证、备份脚本

---

*本文档由 DevMate 生成 | 2026-04-22*