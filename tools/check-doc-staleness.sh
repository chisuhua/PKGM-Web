#!/bin/bash
# PKGM 文档陈旧度月度审查脚本
# 用法: ./tools/check-doc-staleness.sh [--days N]
# 默认: 标记超过 90 天未更新的文档

set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

DAYS=${1:-90}
if [[ "$DAYS" =~ ^--days ]]; then
    DAYS=${2:-90}
fi

CUTOFF_DATE=$(date -d "@$(($(date +%s) - ${DAYS}*86400))" +%Y-%m-%d 2>/dev/null || date -j -v-${DAYS}d +%Y-%m-%d)

echo "=== PKGM 文档陈旧度报告（截止 $CUTOFF_DATE，阈值 ${DAYS} 天）==="
echo ""

STALE=0
NO_DATE=0

check_file() {
    local file="$1"
    local rel="${file#$PROJECT_ROOT/}"
    
    # 跳过已废弃文件和 openspec artifacts
    [[ "$file" =~ openspec/ ]] && return
    [[ "$file" =~ \.rddf/ ]] && return
    
    # 提取日期
    local date=""
    date=$(grep -oP '(创建日期|最后更新).*[：:]\s*\K\d{4}-\d{2}-\d{2}' "$file" 2>/dev/null | tail -1)
    
    if [[ -z "$date" ]]; then
        echo "  ⚠️  $rel — 无日期元数据"
        NO_DATE=$((NO_DATE + 1))
        return
    fi
    
    if [[ "$date" < "$CUTOFF_DATE" ]]; then
        echo "  📌 $rel — 最后更新 $date（${DAYS}+ 天前）"
        STALE=$((STALE + 1))
    fi
}

# 三项目文档目录
for dir in docs PKGM-Wiki/docs PKGM-Manager/docs; do
    [[ -d "$PROJECT_ROOT/$dir" ]] || continue
    echo "--- $dir ---"
    while read -r f; do
        check_file "$f"
    done < <(find "$PROJECT_ROOT/$dir" -name '*.md' | sort)
    echo ""
done

echo "=== 汇总 ==="
echo "陈旧文档（>${DAYS} 天）: $STALE"
echo "缺少日期元数据: $NO_DATE"
echo ""

if [[ $STALE -gt 0 ]] || [[ $NO_DATE -gt 0 ]]; then
    echo "建议: 审阅陈旧文档是否需要更新，缺少日期的文档请补充 '\`>{tag}\` 最后更新：YYYY-MM-DD'"
    exit 1
else
    echo "✅ 所有活跃文档均在 ${DAYS} 天内更新过。"
    exit 0
fi
