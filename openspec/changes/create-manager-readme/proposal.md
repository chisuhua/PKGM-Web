# 创建 PKGM-Manager 文档索引并添加维护契约

## 现状问题

1. **PKGM-Manager 缺少文档索引**：`docs/README.md` §1.2 引用了 PKGM-Manager 的架构文档，但 Manager 项目自身没有任何 `README.md` 索引文件。开发者需要先在 `docs/README.md` 找到引用，再跳转到 Manager 目录，没有独立的文档导航入口。

2. **缺少文档维护流程**：三个项目（PKGM-Web / PKGM-Wiki / PKGM-Manager）的 ADR 文档各自独立维护，没有任何"新增/修改 ADR 时必须同步哪些文件"的约定。这是导致本次所有对齐问题的根因。

## 影响范围

- 新建 `PKGM-Manager/docs/README.md`
- 修改 `docs/README.md`（新增 § 文档维护流程）
- 修改 `PKGM-Wiki/docs/adr/README.md`（新增 § 文档维护流程）