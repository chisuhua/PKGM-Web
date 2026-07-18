# 调研 10：SeKV/HISA/Karpathy Wiki 与多格式投影

> **日期**：2026-07-18  
> **状态**：已完成  
> **关联**：adr-005（Logseq 兼容层）、adr-020（OKF 互操作）  
> **来源**：SeKV 论文（arxiv 2606.31145）、Karpathy llm-wiki gist、librarian 调研

---

## 1. 概念校正

### SeKV 

用户在讨论中提到**SeKV**（Semantic KV Cache），arxiv 2606.31145（UBC + Microsoft Research，2026-06-30）。

| 属性 | 说明 |
|------|------|
| 核心机制 | LLM 推理时把长上下文按 token 熵切分为语义 span |
| GPU 端 | 高熵 anchor tokens + 32 维 summary 向量 |
| CPU 端 | 低秩 SVD 因子（U_k, s_k, V_k），按需 lazy fetch |
| 问题域 | LLM 推理 GPU 显存优化 |
| 与 PKGM 的关系 | **不属于知识管理层**，是推理引擎优化 |

### HISA

**Hierarchical Indexed Sparse Attention**（arxiv 2603.28458，PKU MuLab，COLM 2026）。

| 属性 | 说明 |
|------|------|
| 核心机制 | 替代 DeepSeek-V3.2 indexer，把 O(L²) 全量扫描改为两级稀疏检索 |
| 问题域 | Transformer 注意力加速 |
| 与 PKGM 的关系 | **不属于知识管理层** |

**结论**：SeKV 和 HISA 是 LLM 推理优化技术，与 PKGM 的文档格式/知识管理是**不同问题域**。除非 PKGM 未来自建 LLM 推理代理并对 128K 文档做多轮问答，否则本期无需关注。

---

## 2. Karpathy LLM-Wiki

**来源**：https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

### 三段架构

```
raw/         ← 不可变原始素材
wiki/        ← LLM 生成的 markdown 集合
SCHEMA.md    ← 操作契约（人 + LLM 共演化）
```

### 三大操作

| 操作 | 触发 | 关键不变量 |
|------|------|----------|
| Ingest | 投放新原料 | 单源可能触动 10-15 个 wiki 页 |
| Query | 用户提问 | 答案可回流为新 wiki 页 |
| Lint | 周期触发 | 矛盾、过期、孤儿页、断链 |

### 两个导航文件

- `index.md`：按内容分类的目录，每次 ingest 更新
- `log.md`：按时间追加的操作日志，`## [YYYY-MM-DD] ingest | Title` 格式

### 与 PKGM 的契合度：85%

| 维度 | Karpathy Wiki | PKGM 当前 |
|------|--------------|----------|
| 链接语法 | `[Title](slug.md)` | `[[wikilink]]` |
| 关系类型 | 隐式 | 显式 R01-R15 |
| frontmatter | 可选 | 必填（28+ 字段） |
| 索引机制 | `index.md`（LLM 自动维护） | `hot.md` + Indexer FTS5 |
| 来源溯源 | 弱 | 强（source_type/confidence） |
| 操作日志 | `log.md` | Git history |

**PKGM 缺的**：`log.md`（append-only 操作日志，Agent 可 grep 解析）。

**结论**：PKGM 的 6 阶段管线是在 Karpathy 模式上的工程化增强，而非完全不同。不需要单独 ADR。

---

## 3. PKGM「一源多吃」现状

### 已有的两阶段消化模型（ADR-004）

```
00_Raw（原材料）
  ↓ pkgm-ingest（粗咀嚼）
04_Knowledge（简化 frontmatter，按知识领域组织）
  ↓ pkgm-extract → pkgm-link → pkgm-wiki-gen（深度咀嚼）
01_Wiki（完整 Schema，类型化关系）
```

这是 **一源两吃** 的雏形：同一原始素材 → 两种粒度的知识表示。

### 计划中的投影

| 议题 | 投影目标 | 优先级 | 状态 |
|------|---------|--------|------|
| adr-005 | Logseq 兼容格式（YAML → `property::` 行内属性） | 🟢 P2 | ⏳ 待讨论 |
| adr-020 | OKF 互操作导出（rich schema → minimal bundle） | 🟡 P1 | ⏳ 待讨论 |
| adr-026 | Qdrant 向量嵌入（不是投影，是检索增强） | 🟡 P1 | ⏳ 待讨论 |

---

## 4. 多格式投影 vs 多后端编译

### 区分两个概念

| 概念 | 含义 | 例子 |
|------|------|------|
| **多格式投影** | 同一 Wiki 页面 → 派生不同格式 | Wiki markdown → Logseq `::` 格式 / OKF minimal bundle |
| **多后端编译** | 同一原始素材 → 不同 LLM 策略编译成不同知识表示 | 文档 → 块级摘要 / 本体 KG / QA 对 |

用户真正需要的是 **多后端编译**（管线即编译器），而非简单的多格式投影。

### 编译后端构想

```
Analysis JSON（共享前端产物，来自 pkgm-extract Step 1）
    ├──→ 编译后端 1: wiki-gen（现有，深度结构化 Wiki）
    ├──→ 编译后端 2: block-summary（块级摘要，层级块用于检索）
    ├──→ 编译后端 3: ontology-kg（本体对齐 KG，用于图检索）
    └──→ 编译后端 4: qa-pairs（QA 对，快速问答）
```

### 关键架构决策

| 决策点 | 选项 |
|--------|------|
| 输入共享层 | pkgm-extract Step 1 Analysis JSON（已缓存，7 天 TTL） |
| 后端注册 | `03_Engine/backends/{name}/SKILL.md` 或 config.yaml |
| 增量编译 | SHA256 文件级缓存 + 策略版本号 |
| 输出位置 | `01_Wiki/{backend-name}/{domain}/{slug}.*` |

---

## 5. 结论

### 不建议新增独立 ADR 的理由

1. PKGM 已有两阶段消化模型（一源两吃）
2. adr-005 + adr-020 已覆盖投影格式决策
3. 多后端编译需要先验证具体后端的实现复杂度，不适合过早抽象

### 建议的下一步

| 阶段 | 动作 |
|------|------|
| 现在 | 讨论 adr-005（Logseq 投影）和 adr-020（OKF 互操作），验证编译需求 |
| 中期 | 实现 block-summary 编译后端（最高 ROI） |
| 远期 | ≥3 个编译后端且共享逻辑 ≥60% → 抽象通用编译框架 ADR |

---

*关联：adr-discussion-plan.md、ADR-004（目录结构）、ADR-007（管线设计）、ADR-008（SHA256 增量缓存）*
