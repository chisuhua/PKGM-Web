# 调研 08：OKF 与 Markdown 知识文档规范

> **日期**：2026-07-18  
> **状态**：已完成  
> **关联**：adr-020（OKF 互操作）、adr-005（Logseq 兼容层）、adr-029（块级建模）  
> **来源**：OKF 官方文章（2026-06）、OKF v0.1 SPEC、librarian 调研（Obsidian/Logseq/Foam/Jekyll/Pandoc/RFC 7991/Dataview）

---

## 1. OKF（Open Knowledge Format）v0.1

**发布方**：Google Cloud，2026-06-12  
**仓库**：https://github.com/GoogleCloudPlatform/knowledge-catalog  
**规范**：https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md

### 核心设计

| 维度 | OKF 设计 |
|------|---------|
| 载体 | Markdown 文件目录 + YAML frontmatter |
| 唯一强制字段 | `type`（自由字符串，无中央注册表） |
| 链接方式 | 标准 inline Markdown link（**禁止** frontmatter `links:` 字段） |
| 保留文件名 | `index.md`（目录索引）、`log.md`（变更日志，ISO 8601 日期组） |
| 路径规范 | bundle-relative `/` 路径 |
| 消费者契约 | 必须保留未知字段、必须容忍 broken link |
| 三原则 | 低约束、生产消费解耦、纯格式标准（非平台） |

### 与 PKGM 的关键差异

| 维度 | OKF | PKGM-Wiki |
|------|-----|-----------|
| 必填字段 | 仅 `type` | title + type + domain + source_type + source_ref + confidence（6 个） |
| type 语义 | 自由字符串 | 枚举 N01-N12 |
| 关系表达 | inline markdown link | frontmatter `relations:` + 正文 `[[wikilink]]` |
| 溯源 | 无 | ADR-002 完整溯源链 |
| 实体类型 | 无注册表 | 12 实体 + 15 关系 |
| 是平台还是格式 | 纯格式标准 | 个人知识管理系统 |

### 关键洞察

OKF 的定位是 **跨组织互操作标准**，PKGM-Wiki 是 **个人知识图谱引擎**。前者低约束以促进互通，后者高约束以保证图谱质量。PKGM 需要的是一个"投影层"（rich schema → OKF minimal bundle），而非改造自身 schema 以兼容 OKF。

---

## 2. 8 种主流 Markdown 知识文档规范对比

| 规范 | 核心设计 | 链接机制 | 元数据 | 与 PKGM 契合度 |
|------|---------|---------|--------|---------------|
| **OKF v0.1** | 目录树 + YAML frontmatter | inline markdown link | type 强制 | 高（同范式） |
| **Obsidian** | CommonMark + GFM + `[[wikilink]]` | `[[wikilink]]` + `[[note#^block]]` | YAML frontmatter（properties） | 最高（PKGM 用同语法） |
| **Logseq** | 块级 outliner | `[[Page]]` + `((block-uuid))` + `{{embed}}` | 行内 `key:: value` + YAML frontmatter | 中（块级不兼容 PKGM 文档级模型） |
| **Foam** | 纯 VS Code 知识管理 | `[[wikilink]]` + GitHub 兼容渲染 | YAML frontmatter | 高 |
| **Jekyll Front Matter** | `---\nYAML\n---` 事实标准 | 标准 md link | `layout/permalink/date/categories/tags` | 高（PKGM 合规） |
| **Pandoc** | 多格式转换枢纽 | `[@key]` citation | YAML metadata block + CSL/BibTeX | 中（学术场景） |
| **RFC 7991** | 严格 XML + RELAX NG schema | `<xref>` + `<relref>` | XML 属性 | 低（不兼容 markdown） |
| **Dataview (DQL)** | frontmatter 查询层 | 通过 `[[Page]].field` 查询 | 消费 YAML + 行内 `Key::` | 中（查询语法可借鉴） |

---

## 3. 对 PKGM 的建议

### 已覆盖的能力（不需要新 ADR）
- ✅ `[[wikilink]]` 双向链接（ADR-003）
- ✅ 类型化关系 R01-R15（schema.yaml）
- ✅ 溯源/provenance（ADR-002）
- ✅ slug 命名（ADR-003）
- ✅ 知识老化（ADR-018）
- ✅ lint 规范（schema.yaml §6）

### 真正的缺口
1. **OKF 互操作导出**（已列为 adr-020，P1）
2. **块级建模**（已列为 adr-029，P2）
3. **消费者容错契约**（纳入 adr-020 讨论）
4. **JSON-LD 渲染**（PKGM-Web 实现细节，不需要 ADR）

### 不建议新增的
- Schema.org 词汇表——PKGM R01-R15 已更精细
- Obsidian Bases 兼容——前端生成 `.base` 文件即可，零代码
- W3C PROV-DM 完整实现——ADR-002 的 transformation_chain 已覆盖 80%

---

*关联：adr-discussion-plan.md §4 adr-020、adr-029*
