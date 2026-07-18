# 修复文档引用错误

## 现状问题

1. **`docs/README.md` §3.3 注2** 声称"PKGM-Wiki 已有 **23** 个历史 ADR（adr-001 到 adr-023）"
   - 实际只有 **20 个已确认 ADR** 文件（缺少 adr-019/020/021，它们仅在 `PENDING_ADR_TOPICS.md` 中定义但未创建文件）
   - 用户或新开发者按此数字查找文件时会发现不一致

2. **`PKGM-Wiki/docs/adr/README.md` §2.2** （"未来可能需要补充的 ADR"）未反映最新状态：
   - 仍列出 adr-027（已合并入 adr-005，不应再独立存在）
   - 缺少 adr-029（块级建模）和 adr-030（可插拔编译后端）
   - adr-028 优先级仍标为 🟢 低，实际已升级为 🟡 中

## 影响范围

- `docs/README.md`（1 处修改）
- `PKGM-Wiki/docs/adr/README.md`（§2.2 表格更新）