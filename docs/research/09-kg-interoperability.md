# 调研 09：知识图谱互操作与语义 Web

> **日期**：2026-07-18  
> **状态**：已完成  
> **关联**：adr-026（Qdrant 嵌入模型）、adr-029（块级建模）  
> **来源**：librarian 调研（JSON-LD/Schema.org/Roam-Logseq/Obsidian Bases/PROV-DM/backlinks）

---

## 1. JSON-LD 嵌入 Markdown

**标准**：W3C Recommendation，https://www.w3.org/TR/json-ld11/

### 两种工业模式

| 模式 | 做法 | 适用场景 |
|------|------|---------|
| **生成式** | build 时 SSG 读 frontmatter → 渲染到 HTML `<head>` 的 `<script type="application/ld+json">` | Hugo/Jekyll 主流 |
| **嵌入式** | markdown body 内嵌 `@{Type,prop=value}`，解析器扫到后产出 JSON-LD | iunera/json-ld-markdown |

### PKGM frontmatter → Schema.org 映射

| PKGM frontmatter | Schema.org property |
|---|---|
| `title` | `headline` |
| `type: concept` | `@type: TechArticle` |
| `created` | `dateCreated` |
| `updated` | `dateModified` |
| `created_by` | `author`（`@type: Person`） |
| `tags` | `keywords` |
| `source_url` | `sameAs` |

**结论**：JSON-LD 渲染约 200 行 React 代码，属于 PKGM-Web 实现细节，不需要独立 ADR。

---

## 2. 块级建模（Block-level Identity）

### Roam Research

- **数据结构**：Datomic/Datascript，每个 block 是 entity
- **关键 attribute**：`:block/uid`（9 字符 public ID）、`:block/string`、`:block/children`、`:block/refs`
- **查询语言**：Datalog 子集

### Logseq

- **数据结构**：DataScript + SQLite 双层
- **关键 attribute**：`:block/uuid`（UUID）、`:block/parent`、`:block/refs`
- **关键教训**（PR #12081）：删除 `:block/path-refs`（占 21% datom），改用 Datalog 规则 `(has-ref ?b ?ref)` 递归

### 对 PKGM 的建议

PKGM 不需要照搬 Roam/Logseq 的块级模型，但可借鉴轻量设计：
- 每个 heading 生成 `block_uuid` 哈希（path + heading offset）
- `[[wikilink]]` 升级为 `[[doc#heading]]` 锚点引用
- Indexer 维护块级链接表

已列为 **adr-029（块级建模与块级引用，P2）**。

---

## 3. Backlinks 与多跳查询

### 实现模式对比

| 模式 | 代表工具 | PKGM 现状 |
|------|---------|----------|
| 文件扫描 | rg + grep | 备选 |
| SQLite 索引 | LeafWiki / BrainDB / MindGraph | ✅ PKGM 已用 FTS5 |
| 图数据库 | Roam (Datomic) / Logseq (DataScript) | 未采用 |

### 关键发现：SQLite 递归 CTE 可替代图数据库

ctxgraph 项目验证：50k 节点以内，SQLite 递归 CTE 与 Neo4j 性能差距可忽略。

```sql
-- 找间接依赖（≤3 跳）
WITH RECURSIVE deps(id, depth) AS (
  SELECT id, 0 FROM notes WHERE title = 'CUDA Warp'
  UNION ALL
  SELECT l.source_id, d.depth + 1
  FROM deps d JOIN links l ON l.target_id = d.id
  WHERE d.depth < 3
)
SELECT DISTINCT n.path FROM deps d JOIN notes n ON n.id = d.id;
```

**结论**：PKGM 不需要引入 Neo4j/Cozo。Indexer 加 `links` 表 + 递归 CTE 即可实现多跳查询。属于 adr-026 范畴（Backlinks 表与多跳查询引擎），也可能在现有 adr-003（双引擎搜索）框架内解决。

---

## 4. W3C PROV-DM

**标准**：https://www.w3.org/TR/prov-dm/

### 核心三角

```
Entity ← wasGeneratedBy → Activity ← wasAssociatedWith → Agent
Entity ← wasDerivedFrom → Entity
Activity ← used → Entity
```

### PKGM 已覆盖：80%

| PROV 要素 | PKGM 对应 | 状态 |
|----------|----------|------|
| Agent | `created_by` / `updated_by` | ✅ |
| Entity provenance | `source_type` / `source_ref` / `source_url` | ✅ |
| Activity 链 | ADR-002 transformation_chain（Phase 2） | ✅ 计划中 |

**结论**：不需要完整 PROV-O 化。ADR-002 的 transformation_chain 已覆盖核心需求。

---

## 5. Obsidian Bases 兼容性

PKGM-Wiki 的 frontmatter 与 Obsidian Bases 100% 兼容。

| PKGM frontmatter | Bases 兼容？ |
|---|---|
| `title` / `type` / `domain` | ✅ `note.title` / `note.type` / `note.domain` |
| `confidence` / `tags` / `source_type` | ✅ |
| `verification.status` / `lifecycle.status` | ✅ |
| `relations.depends_on` | ❌ 嵌套对象不直接支持 |

**结论**：生成 `.base` 文件是**零代码操作**（只需写几个 YAML 配置文件），不需要架构决策。但 nested `relations` 需要 flatten。

---

*关联：adr-discussion-plan.md §4 adr-026、adr-029*
