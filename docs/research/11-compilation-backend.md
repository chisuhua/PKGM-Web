# 调研 11：可插拔编译后端架构

> **日期**：2026-07-18
> **状态**：已完成
> **关联**：adr-030（可插拔编译后端架构）、adr-007（管线设计）、adr-024（Temporal Worker 适配）
> **来源**：4 份并行调研（可插拔架构 + 块级摘要/KG + 增量编译/缓存键 + PKGM 扩展点）

---

## 1. PKGM 管线扩展点现状

PKGM-Wiki 现有 **16 个管线扩展点**，覆盖 6 类：

| 类型 | 数量 | 代表 |
|------|------|------|
| schema | 4 | N09-N12 预留实体类型、R16+ 关系类型、schema 版本管理、研究地图动态扩展 |
| hook | 4 | pkgm-architect 决策触发器、03_Engine/cache/ 三级缓存、待定 ADR-019~021、待补充 ADR-024~028 |
| plugin | 3 | Phase 2 扩展 Skills（3 个）、摄入格式扩展、6 阶段管线 + 4 个后处理模块 |
| strategy | 3 | 检索策略三阶段演进、实体对齐 4 级降级、管线错误重试与降级 |
| pipeline-stage | 1 | 两阶段抽取（Analysis → Generation，ADR-007 §7 明示可演进为三阶段） |
| template | 1 | pkgm-wiki-gen 模板系统（8 个模板，含 fallback 机制） |

**关键发现**：架构 v3.0 已规划 4 个可插拔后处理模块（Temporal Worker / Git Push / Qdrant / Logseq / MinIO），各模块通过独立 Python 脚本实现，可独立启用/禁用。这为编译后端的插件化提供了先例。

---

## 2. 可插拔 LLM 管线架构模式

### 2.1 Microsoft GraphRAG：6 阶段编译管线

```
Phase 1 Compose TextUnits → Phase 2 Document Processing → Phase 3 Graph Extraction
→ Phase 4 Graph Augmentation (Leiden 社区检测) → Phase 5 Community Summarization → Phase 6 Text Embeddings
```

- 阶段间通过 **DataFrame（parquet 表）** 解耦，等价于编译器中间表示（IR）
- 社区检测用分层 Leiden 算法 + 自底向上摘要（叶子社区先摘要原始实体，父社区基于子报告再摘要）
- 查询时 map-reduce：map 并行生成答案+评分，reduce 聚合
- `period` 字段专为增量合并设计

### 2.2 Haystack 2.x：最适合可插拔 Pipeline

```python
p = Pipeline()
p.add_component("splitter", DocumentSplitter(...))
p.add_component("embedder", SentenceTransformersDocumentEmbedder(...))
p.connect("splitter.documents", "embedder.documents")
p.dump("production_rag.yaml")  # 单 YAML 序列化
```

- **显式 DAG + typed inputs/outputs**：连接错误在 `connect()` 时捕获
- **ComponentTool**：任何子 pipeline 可包成 Agent 工具
- **State injection (v2.28)**：组件可访问/修改 live agent state
- **YAML 序列化**：配置与代码分离，运维可独立改拓扑

### 2.3 Bazel Skyframe：增量编译理论基础

| Bazel 概念 | LLM 管线映射 | PKGM 实现 |
|-----------|-------------|----------|
| `SkyKey` | `(doc_path, chunk_id, backend_name)` | 用户目录 + 文件路径 |
| `SkyValue` | 摘要 / 嵌入 / 社区报告 | 编译产物 |
| `SkyFunction` | extract / summarize / embed | 编译后端步骤 |
| `ActionKey` | `(step, input_hash, backend, params)` | LLM 调用缓存键 |
| Bottom-up invalidation | 文档变更 → 反向重算依赖 | chokidar + 闭包计算 |
| **Change pruning** | 重算后值相同 → 复活下游节点 | 摘要哈希比对 |

### 2.4 GitHub 开源项目：工厂注册模式

调研 8 个知名项目（vllm / pytorch / sglang / pandera / ray / mmengine），提炼出五种注册模式：

| 模式 | 代表 | 适用场景 |
|------|------|---------|
| **工厂 + register_backend(name, class_or_path)** | vllm, sglang, ray | **推荐首选**：懒加载 + 运行时注册 |
| 装饰器 `@register_backend("name")` | pytorch | 声明式，零样板 |
| 按类型分派 | pandera | 多后端共存 + 自动路由 |
| 前缀路由 | mmengine | URI 协议透明 |
| 抽象基类 | PipelineDP | 纯接口契约 |

---

## 3. 块级摘要编译策略

### 3.1 Chunking 策略对比（2025-2026 共识）

| 策略 | Recall@5 | 端到端准确率 | 推荐场景 |
|------|---------|------------|---------|
| **Recursive 512 + 64 overlap** | 82-83% | **69%（Vecta 第一）** | **默认首选** |
| Semantic (embedding 相似度) | 93-94% | 54%（反降！） | 需配合 parent-child |
| Semantic-Markdown 混合 | 94% | 高 | 文档 KB |
| Late chunking (Jina) | 高 | 高 | 长文跨引用 |

**关键反直觉发现**：Semantic chunking 召回最高但端到端反降——chunk 太"纯"丢失上下文。必须配合 parent-child 或 context expansion。

**PKGM 推荐**：Recursive Markdown-aware, 512 tokens, 64 overlap（Markdown 文档最稳默认）。

### 3.2 RAPTOR：层级摘要

递归 embed → cluster → summarize，自底向上构建多层摘要树：
- 叶节点：100-token chunks
- 聚类：Leiden 算法 + 自适应参数
- 检索：collapsed tree（拍平所有层 cosine top-k）优于 tree traversal

### 3.3 Dense-X Proposition Extraction

把文档拆成**原子命题**（自包含、最小不可分的自然语言事实），100-200 词 ≈ 10 propositions。Recall@20 +10.1（无监督 retriever），适合 factoid 查询。

### 3.4 Chunk 元数据设计

```yaml
chunk_id: <stable_hash>
doc_path: /users/alice/content/daily/2026-07-18-foo.md
chunk_index: 3 / total_chunks: 12
heading_path: ["日报", "技术进展"]
chunk_type: leaf | summary | proposition
frontmatter_inherited: {title, type, tags, status, source, created}
entity_ids: ["e_001"]
embedding_model_id: bge-large-zh-v1.5 / embedding_version: v2
content_hash: sha256(...)
```

---

## 4. 本体论 KG 编译策略

### 4.1 抽取范式对比

| 范式 | 优点 | 缺点 | PKGM 适用 |
|------|------|------|----------|
| **Schema-free LLM**（GraphRAG Standard） | 零配置 | entity type 漂移、噪声大 | 冷启动 |
| **NLP co-occurrence**（GraphRAG Fast） | 便宜 75% | 无语义、不归一 | 海量低成本 |
| **Schema-guided few-shot** | 类型可控、与查询对齐 | 需预定义本体 | **✅ 推荐** |

PKGM 已有 schema.yaml（12 实体 + 15 关系），天然适合 schema-guided few-shot 抽取。

### 4.2 Entity Disambiguation：三层归一

```
Layer 1: 字符串归一化 + 别名表（最便宜，必做）
   normalize(name) = lowercase + strip + remove_punct + unicode_nfkc
Layer 2: Embedding 相似度（中等成本）
   cosine > 0.88 + 同 type → 候选集
Layer 3: LLM 判定（最高精度，仅 ambiguous 触发）
   候选 ≥ 2 或 borderline 0.80-0.88 → LLM 二次确认
```

主键策略：`(normalized_name, type)` 双键，避免 "张三"@Person 与 "张三"@Project 撞车。

### 4.3 增量 KG 编译（LightRAG 算法）

```
新文档 𝒟' 用同一 φ 处理 → (𝒱̂', 𝛈̂')
取并集：𝒱̂ ∪ 𝒱̂', 𝛈̂ ∪ 𝛈̂'
Dedupe 函数合并同义实体
复杂度：仅与新增 token 数成正比
```

**关键**：无需重建索引，只增量追加节点/边。

---

## 5. 增量编译与缓存键设计

### 5.1 复合缓存键

```
compile_key = SHA256(
    source_file_sha256     // 源文件内容哈希
  ∥ backend_name          // "wiki-gen" | "block-summary" | "ontology-kg"
  ∥ backend_strategy_ver  // 编译策略版本（content hash）
  ∥ model_id              // "claude-3-5-haiku" | "gpt-4o" | ...
  ∥ model_params_hash     // SHA256(temperature ∥ top_p ∥ ...)
  ∥ template_version      // prompt template 的 content hash
  ∥ schema_version        // schema.yaml 的 content hash
)
```

**对比现状**：ADR-008 仅 `SHA256(源文件)`，缺 model/template/strategy 维度。

### 5.2 非确定性输出三档策略

| 档位 | 场景 | 温度 | 缓存策略 |
|------|------|------|---------|
| A. 确定性 | 结构化抽取 | 0 | exact match，30 天 TTL |
| B. 校验后 | 半结构化生成 | ≤0.3 | schema 校验通过后写入，24h TTL |
| C. 不缓存 | 创意生成 | >0.3 | 仅相似度缓存 + LLM 仲裁 |

### 5.3 四层缓存架构

```
L1 内存 LRU（<1μs, 100 entries）
   ↓ miss
L2 本地 SQLite（~1ms, 单租户, LRU+TTL）
   ↓ miss
L3 MinIO 远程（~50ms, 跨会话, 7 天 TTL, v3.0 已规划）
   ↓ miss
L4 Redis（可选, 多 Worker 一致性）
   ↓ miss → 调用 LLM → 写穿 L1→L2→L3
```

---

## 6. 架构设计：三层 + 多编译后端

```
┌─────────────────────────────────────────────────┐
│ Layer 1: Backend Registry                       │
│   - register_backend(name, class_or_path)        │
│   - 内置: wiki-gen, block-summary, ontology-kg   │
│   - 用户可注入自定义后端                          │
├─────────────────────────────────────────────────┤
│ Layer 2: Pipeline DAG（类 Haystack）              │
│   - Step: typed inputs/outputs + Backend 注入    │
│   - YAML 序列化，配置/代码分离                    │
├─────────────────────────────────────────────────┤
│ Layer 3: Incremental Engine（类 Skyframe）        │
│   - CompileKey + ActionKey + bottom-up inval     │
│   - L1→L2→L3 四层缓存                            │
│   - change pruning                               │
└─────────────────────────────────────────────────┘

Analysis JSON（共享前端产物，pkgm-extract Step 1）
    ├──→ backend: wiki-gen → 01_Wiki/concepts/ (现有)
    ├──→ backend: block-summary → 01_Wiki/summaries/
    ├──→ backend: ontology-kg → 01_Wiki/kg/
    └──→ backend: custom → ...
```

---

## 7. PKGM 适配路径

| Phase | 内容 | 依赖 |
|-------|------|------|
| **Phase 0** | 抽出 `CompileBackend` 抽象基类 + `register_backend` 注册表 | 无 |
| **Phase 1** | 引入 CompileKey/ActionKey + 依赖图，替代纯 SHA256 缓存 | ADR-008 升级 |
| **Phase 2** | 实现 block-summary 编译后端（recursive chunking + 层级摘要） | Phase 0 |
| **Phase 3** | 实现 ontology-kg 编译后端（schema-guided few-shot + 三层 disambiguation） | Phase 0 + adr-024 |
| **Phase 4** | Pipeline YAML 序列化 + Qdrant/MinIO 集成 | adr-026, adr-028 |

---

*关联：adr-007（管线设计）、adr-008（SHA256 缓存）、adr-024（Temporal Worker）、adr-030（可插拔编译后端）*
