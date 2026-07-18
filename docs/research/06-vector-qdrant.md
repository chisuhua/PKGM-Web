# Qdrant 向量数据库调研报告 — 2026-07-17

## 概述

为 PKGM 知识库构建 AI 问答系统，支持多租户隔离的范围问答（domain/tags/confidence 过滤）。

## 租户隔离策略：Payload-based Multitenancy

**不建多 Collection，而是单 Collection + Payload 过滤。**

### 三种方案对比

| 方案 | 适用场景 | PKGM 适用 |
|------|---------|-----------|
| 基础 Payload Filtering | 小规模 (< 50 租户) | ❌ 性能瓶颈 |
| **`is_tenant=True` + `payload_m=16` + `m=0`** | 大量小租户 | ✅ **推荐** |
| Custom Sharding (Tiered) | 少量大租户 | 未来扩展 |

### 关键配置

```python
client.create_collection(
    collection_name="pkgm_knowledge",
    vectors_config={
        "dense": VectorParams(size=1024, distance=COSINE),
        "colbert": VectorParams(size=1024, distance=COSINE,
            multivector_config=MultiVectorConfig(comparator=MAX_SIM)),
    },
    sparse_vectors_config={
        "sparse": SparseVectorParams(modifier=IDF),
    },
    hnsw_config=HnswConfigDiff(payload_m=16, m=0),  # 多租户子图
)
```

**`m=0` 禁用全局 HNSW**，`payload_m=16` 构建每租户子图——租户过滤后直接跳转。

### Payload 索引（必须）

```python
# tenant_id 专用索引（62x 加速查询）
client.create_payload_index("pkgm_knowledge", "tenant_id",
    field_schema=KeywordIndexParams(type=KEYWORD, is_tenant=True))

# PKGM Frontmatter 索引
client.create_payload_index("pkgm_knowledge", "domain", KEYWORD)
client.create_payload_index("pkgm_knowledge", "type", KEYWORD)
client.create_payload_index("pkgm_knowledge", "confidence", INTEGER)
client.create_payload_index("pkgm_knowledge", "tags", KEYWORD)
```

**性能数据**（Qdrant 1.18.1 实测，100K 点）：

| 查询类型 | 无索引 p50 | 有索引 p50 | 加速比 |
|---------|----------|----------|--------|
| 纯过滤 | 2.69ms | 1.00ms | 2.7x |
| 向量+过滤 (brand+rating) | 146.77ms | 2.36ms | **62x** |
| 向量+must+should | 13.02ms | 1.70ms | 7.7x |

## 嵌入模型：BGE-M3

| 特性 | 参数 |
|------|------|
| 稠密维度 | 1024 |
| 最大序列长度 | **8192 tokens** |
| 多语言 | 100+ 种（含中英文） |
| 三种输出 | Dense + Sparse (lexical) + Multi-vector (ColBERT) |
| 模型大小 | 569M / 2.27GB |

**无需为 query 加 instruction**（BGE-M3 已自动处理）。

## 混合检索架构

### 三阶段 Pipeline

```
用户查询
    |
    ├── Prefetch 1: Sparse (BM25) 召回 → limit*2
    ├── Prefetch 2: Dense (BGE-M3) 召回 → limit*2
    |
    └── RRF 融合 → ColBERT Multi-vector 精排 → Group by doc_id
```

### 搜索代码示例

```python
def pkgm_search(query_text, tenant_id, domain=None, min_confidence=None):
    must = [FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))]
    if domain: must.append(FieldCondition(key="domain", match=MatchValue(value=domain)))
    if min_confidence: must.append(FieldCondition(key="confidence", range=Range(gte=min_confidence)))

    return client.query_points_groups(
        collection_name="pkgm_knowledge",
        prefetch=[
            Prefetch(query=SparseVector(...), using="sparse", limit=20),
            Prefetch(query=[...], using="dense", limit=20),
        ],
        query=Document(text=query_text, model="BAAI/bge-m3"),
        using="colbert",
        query_filter=Filter(must=must),
        group_by="doc_id",
        limit=10,
    )
```

## 部署与资源

### 单机配置

```yaml
# docker-compose.yml
services:
  qdrant:
    image: qdrant/qdrant:v1.18.1
    ports: ["6333:6333", "6334:6334"]
    volumes: ["./qdrant_data:/qdrant/storage"]
    environment:
      QDRANT__STORAGE__PERFORMANCE__INDEXING_THRESHOLD_KB: 10000
```

### 内存估算

| 向量数 | BGE-M3 1024d (无量化) | 启用 INT8 量化 |
|--------|----------------------|---------------|
| 100K | ~0.6 GB | ~0.15 GB |
| 1M | ~6 GB | ~1.5 GB |
| 10M | ~60 GB | ~15 GB |

生产内核参数：`vm.max_map_count = 262144`, `vm.swappiness = 10`

### 集群（> 100K 文档）

3 节点 + Replication Factor 2，启用 `on_disk_payload: true`。

## 备份

```python
# 每个 Collection 独立快照
snapshot = client.create_snapshot(collection_name="pkgm_knowledge")
# 恢复时需 priority=SNAPSHOT
client.recover_snapshot(collection_name="pkgm_knowledge",
    location="...", priority=SnapshotPriority.SNAPSHOT)
```

## Markdown 分块策略

| 策略 | PKGM 推荐 |
|------|-----------|
| **标题分块**（MarkdownNodeParser） | ✅ **主策略** |
| 固定大小 + 重叠 | 备用 |
| 语义分块 | ❌ 不必要 |

**分块规则**：
- 目标：200-800 tokens/chunk
- 重叠：10-20%
- 不切分代码块、表格、LaTeX
- Frontmatter 字段 → Payload 不嵌入

## LlamaIndex 集成

```python
from llama_index.vector_stores.qdrant import QdrantVectorStore

vector_store = QdrantVectorStore(
    collection_name="pkgm_knowledge",
    client=client, aclient=aclient,  # 必须同时传！
    enable_hybrid=True,
    dense_vector_name="dense",
    sparse_vector_name="sparse",
)
```

**⚠️ 必须同时传 `client` + `aclient`**，否则异步查询静默挂起。

## 避免的陷阱

| 陷阱 | 说明 |
|------|------|
| ❌ 每租户一个 Collection | Qdrant Cloud 限制 1000 个/集群 |
| ❌ 不建 tenant_id 索引 | 100K+ 点后从 2ms 退化为 200ms |
| ❌ 修改模型不重建索引 | 不同模型维度/语义不兼容 |
| ❌ 把 Frontmatter 也嵌入 | 只需存 Payload，嵌入正文 chunk |