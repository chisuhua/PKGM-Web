# 多租户认证方案调研报告 — 2026-07-17

## 概述

对比 Supabase Auth、Keycloak、Authentik、Clerk 四个认证方案，为 PKGM 从单机 JWT 升级为多租户 SaaS 选型。

## 当前 PKGM 认证状态

```typescript
// web/src/lib/auth.ts
new SignJWT({ username })  // 仅 username claim
  .setProtectedHeader({ alg: 'HS256' })
  .setExpirationTime('24h')
  .sign(SECRET);
```
- httpOnly Cookie `pkgm-token`
- Middleware 检验 + 路径 `/docs/{username}/` 隔离
- 无密码输入即登录（仅验证用户名在 Indexer 是否存在）

## 方案对比

| 维度 | Supabase Auth | Keycloak | Authentik | Clerk |
|------|-------------|----------|-----------|-------|
| **许可证** | Apache 2.0 (GoTrue) | Apache 2.0 | MIT | 闭源托管 |
| **租户隔离** | RLS Policy | Realm / Organizations | PostgreSQL Schema（企业版） | Organizations |
| **自托管** | ✅ GoTrue | ✅ | ✅ | ❌ |
| **JWT claim 定制** | Auth Hooks | Protocol Mapper | API | SDK 内置 |
| **免费层** | 50K MAU | 无限制 | 无限制（单租户） | 50K MRU |
| **SSO** | Pro $0.015/MAU | 内置 | Enterprise | Pro $25/月含1个 |
| **Next.js 集成** | `@supabase/ssr` | NextAuth v5 | API 调用 | `@clerk/nextjs` |
| **K8s 成熟度** | ⚠️ 自维护 | ✅ 官方 Helm | ✅ 官方 Helm | N/A |
| **规模上限** | 取决于 PG | Organizations 1500+ | 企业版 | 托管弹性 |

## Keycloak Realm vs Organizations 关键基准

**数据来源**：[gofranz.com 基准测试](https://gofranz.com/blog/keycloak-multi-tenancy-realms-vs-organizations/)

| 指标 | Realm 模式 (500 tenant) | Organizations 模式 (1500 tenant) |
|------|------------------------|----------------------------------|
| P95 延迟 | 16.6s | 几乎持平 |
| 吞吐量 | 下降 4 个数量级 | 持平 |
| 种子创建 | 59 min (1000) | 84s (1500) |
| 内存 | 峰值 43GB | ~1GB 稳定 |

**结论：PKGM 必须使用 Organizations 模式，避免 realm-per-tenant。**

## 推荐：Keycloak Organizations

### 理由
1. 免费自托管，Apache 2.0
2. Organizations 模型匹配 PKGM 用户结构
3. JWT claim 灵活注入 `tenant_id`、`role`
4. NextAuth.js v5 官方支持
5. 可演进：单 realm → Organizations → 多 realm 双模式共存

### 迁移要点
- Keycloak 26+ 启用 Organizations
- 1 个 realm + N 个 organizations（每个 PKGM 用户 1 个 org）
- Auth.js v5 替换 `jose` 自签 JWT
- 保留 `pkgm-token` httpOnly Cookie 作为 session 包装层
- `tenant_id` claim 写入 Next.js `auth()` 回调；Middleware 读取替换 `username`

### 目标 JWT Claims
```json
{
  "sub": "user_...",
  "tenant_id": "tnt_acme",
  "role": "owner",
  "iat": ...,
  "exp": ...,
  "iss": "https://auth.example.com/realms/pkgm"
}
```

## 触发切换条件

| 条件 | 切换方案 |
|------|---------|
| 6 个月内上线 + 团队 ≤ 3 人 | Clerk Pro ($25/月) |
| 数据全在 Postgres | Supabase Auth (RLS) |
| 严格 on-prem / FedRAMP | Keycloak 或 Authentik Enterprise |
| 用户 < 50 且无需 SSO | 保留自有 JWT，加 tenant_id claim |

## 避免的选择
- ❌ Authentik OSS：多租户锁定企业版（MIT OSS 只能单租户）
- ❌ Supabase Auth + 文件系统：RLS 优势无法发挥（PKGM 数据是文件，不是 DB 行）
- ❌ Keycloak realm-per-tenant：500+ 后性能崩塌