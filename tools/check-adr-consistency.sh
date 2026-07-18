#!/bin/bash
# PKGM ADR 一致性检查脚本
# 检查 1：跨项目编号冲突检测（必做）
# 检查 2：三文档编号一致性检查（推荐）
# 检查 3：文档陈旧度（复用 check-doc-staleness.sh）
#
# 用法: ./tools/check-adr-consistency.sh

set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

ERRORS=0
WARNINGS=0

echo "=== PKGM ADR 一致性检查 ==="
echo ""

# =====================
# 辅助函数
# =====================

error() {
    echo "  ❌ $1"
    ERRORS=$((ERRORS + 1))
}

warn() {
    echo "  ⚠️  $1"
    WARNINGS=$((WARNINGS + 1))
}

ok() {
    echo "  ✅ $1"
}

# =====================
# 检查 1：跨项目编号冲突
# =====================
echo "--- 检查 1：跨项目编号冲突 ---"

# 用 Python 解析 docs/README.md §3 中的 ADR 编号和归属项目
read_adr_from_docs_readme() {
    python3 -c "
import re, sys
with open('docs/README.md', 'r', encoding='utf-8') as f:
    content = f.read()

# 提取 §3.x 小节中的 ADR 表格行
# 模式：3.1 PKGM-Web, 3.2 PKGM-Manager, 3.3 PKGM-Wiki, 3.4 跨项目
project_map = {
    '3.1': 'PKGM-Web',
    '3.2': 'PKGM-Manager',
    '3.3': 'PKGM-Wiki',
    '3.4': 'cross-project'
}

results = {}
current_project = None

for line in content.split('\n'):
    # 检测小节标题
    m = re.search(r'^### (\d+\.\d+)', line)
    if m and m.group(1) in project_map:
        current_project = project_map[m.group(1)]
        continue
    # 检测 ADR 表格行：| adr-NNN | title |
    m = re.search(r'^\|\s*(adr-\d{3})\s*\|\s*([^|]+)', line)
    if m and current_project:
        num = m.group(1)
        title = m.group(2).strip()
        results[num] = (current_project, title)

for num, (proj, title) in sorted(results.items()):
    print(f'{num}|{proj}|{title}')
" 2>/dev/null || echo "PARSE_ERROR"
}

# 用 Python 解析 adr-discussion-plan.md §2.2 中的 ADR 编号和归属项目
read_adr_from_discussion_plan() {
    python3 -c "
import re
with open('docs/adr-discussion-plan.md', 'r', encoding='utf-8') as f:
    content = f.read()

# 只解析 ### 2.2 议题总览 到下一个 ### 之间的表格
m = re.search(r'### 2\.2 议题总览\n(.*?)(?=\n### |\Z)', content, re.DOTALL)
if not m:
    print('SECTION_NOT_FOUND', file=sys.stderr)
    sys.exit(1)

section = m.group(1)
results = {}
for line in section.split('\n'):
    # 只匹配数据行（非分隔行、非标题行、非 Wave 组标题行）
    if not re.match(r'^\|.*\|.*\|.*\|.*\|.*\|.*\|$', line):
        continue
    if re.match(r'^\|.*---.*\|', line):
        continue
    m2 = re.search(r'^\|\s*(adr-\d{3})\s*\|\s*([^|]+)\s*\|\s*([^|]+)', line)
    if m2:
        num = m2.group(1)
        title = m2.group(2).strip()
        project = m2.group(3).strip()
        # 跳过 Wave 组标题行（它们没有 adr-NNN）
        if project.strip('- '):
            results[num] = (project, title)

for num, (proj, title) in sorted(results.items()):
    print(f'{num}|{proj}|{title}')
" 2>/dev/null || echo "PARSE_ERROR"
}

# 收集 docs/README.md 的数据
echo "  提取 docs/README.md §3..."
MAP1=$(read_adr_from_docs_readme)
if [ "$MAP1" = "PARSE_ERROR" ]; then
    warn "无法解析 docs/README.md §3，跳过"
else
    ok "解析到 $(echo "$MAP1" | wc -l) 条 ADR"
fi

# 收集 adr-discussion-plan.md 的数据
echo "  提取 adr-discussion-plan.md §2.2..."
MAP2=$(read_adr_from_discussion_plan)
if [ "$MAP2" = "PARSE_ERROR" ]; then
    warn "无法解析 adr-discussion-plan.md §2.2，跳过"
else
    ok "解析到 $(echo "$MAP2" | wc -l) 条 ADR"
fi

echo ""

# 交叉检查：docs/README.md 和 adr-discussion-plan.md 对同一编号的项目+标题信息是否一致
# （双轨编号下，不同项目使用同一编号是允许的，但两个文档对编号的描述必须一致）

echo "  验证两个文档对同一编号的描述是否一致..."

CONFLICT=0
MISSING_FROM_MAP2=0
MISSING_FROM_MAP1=0

# 规范化项目名称
normalize_project() {
    local name="$1"
    case "$name" in
        跨项目|cross-project|cross) echo "cross-project" ;;
        *) echo "$name" ;;
    esac
}

# 交叉检查：两个文档对同一编号的项目归属是否一致（标题措辞差异正常）
echo "  验证两个文档对同一编号的项目归属是否一致..."

CONFLICT=0
MISSING_FROM_MAP2=0
MISSING_FROM_MAP1=0

# 构建 MAP2 的查找表（num → proj）
declare -A map2_proj
while IFS='|' read -r num project title; do
    [ -z "$num" ] && continue
    map2_proj["$num"]=$(normalize_project "$project")
done <<< "$MAP2"

# 对比 MAP1 中每条记录
while IFS='|' read -r num project title; do
    [ -z "$num" ] && continue
    proj1=$(normalize_project "$project")
    proj2="${map2_proj[$num]:-}"
    if [ -z "$proj2" ]; then
        error "$num 在 docs/README.md §3 中存在，但在 adr-discussion-plan.md §2.2 中找不到"
        MISSING_FROM_MAP2=$((MISSING_FROM_MAP2 + 1))
    elif [ "$proj1" != "$proj2" ]; then
        error "$num 项目归属冲突：docs/README.md → $project / adr-discussion-plan.md → $(while IFS='|' read -r n p t; do [ "$n" = "$num" ] && echo "$p" && break; done <<< "$MAP2")"
        CONFLICT=$((CONFLICT + 1))
    fi
done <<< "$MAP1"

# 检查 MAP2 中有但 MAP1 中没有的编号
while IFS='|' read -r num project title; do
    [ -z "$num" ] && continue
    proj2=$(normalize_project "$project")
    if ! echo "$MAP1" | grep -qE "^${num}\|"; then
        warn "$num 在 adr-discussion-plan.md §2.2 中存在，但在 docs/README.md §3 中找不到"
        MISSING_FROM_MAP1=$((MISSING_FROM_MAP1 + 1))
    fi
done <<< "$MAP2"

if [ $ERRORS -eq 0 ]; then
    ok "跨项目编号无冲突"
fi

echo ""

# =====================
# 检查 2：三文档一致性
# =====================
echo "--- 检查 2：三文档编号一致性 ---"

check_doc_consistency() {
    python3 -c "
import re

files = {
    'docs/README.md §3': ('docs/README.md', 'adr'),
    'docs/adr-discussion-plan.md §2.2': ('docs/adr-discussion-plan.md', 'discussion'),
}

def extract_adrs_from_table(filepath, mode='adr'):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    nums = set()
    for line in content.split('\n'):
        m = re.search(r'\|\s*(adr-\d{3})', line)
        if m:
            # 排除注释行/分隔行
            if not re.search(r'^[\s\|]*[-]+', line):
                nums.add(m.group(1))
    return nums

readme_nums = extract_adrs_from_table('docs/README.md', 'adr')
plan_nums = extract_adrs_from_table('docs/adr-discussion-plan.md', 'discussion')

# 排除附录中的 adr-031~034（不在讨论计划中）
readme_active = {n for n in readme_nums if not (int(n.split('-')[1]) >= 31)}
plan_active = plan_nums

only_in_readme = readme_active - plan_active
only_in_plan = plan_active - readme_active

if only_in_readme:
    print(f'ONLY_README: {\", \".join(sorted(only_in_readme))}')
if only_in_plan:
    print(f'ONLY_PLAN: {\", \".join(sorted(only_in_plan))}')
if not only_in_readme and not only_in_plan:
    print('OK')
" 2>/dev/null || echo "PARSE_ERROR"
}

CONSISTENCY=$(check_doc_consistency)
if [ "$CONSISTENCY" = "PARSE_ERROR" ]; then
    warn "无法解析三文档一致性"
elif [ "$CONSISTENCY" = "OK" ]; then
    ok "docs/README.md §3 与 adr-discussion-plan.md §2.2 编号一致"
else
    while IFS= read -r line; do
        if [[ "$line" == ONLY_README:* ]]; then
            warn "仅在 docs/README.md 中存在（不在讨论计划中）: ${line#ONLY_README: }"
        elif [[ "$line" == ONLY_PLAN:* ]]; then
            warn "仅在讨论计划中存在（不在 docs/README.md 中）: ${line#ONLY_PLAN: }"
        fi
    done <<< "$CONSISTENCY"
fi

echo ""

# =====================
# 检查 3：文档陈旧度
# =====================
echo "--- 检查 3：文档陈旧度（>90 天） ---"
DAYS=90
CUTOFF_DATE=$(date -d "@$(($(date +%s) - ${DAYS}*86400))" +%Y-%m-%d 2>/dev/null || date -j -v-${DAYS}d +%Y-%m-%d)
STALE_CNT=0

check_file() {
    local file="$1"
    local rel="${file#$PROJECT_ROOT/}"
    [[ "$file" =~ openspec/ ]] && return
    [[ "$file" =~ \.rddf/ ]] && return
    local date=""
    date=$(grep -oP '(创建日期|最后更新).*[：:]\s*\K\d{4}-\d{2}-\d{2}' "$file" 2>/dev/null | tail -1)
    if [[ -z "$date" ]]; then
        return
    fi
    if [[ "$date" < "$CUTOFF_DATE" ]]; then
        echo "  📌 $rel — 最后更新 $date（${DAYS}+ 天前）"
        STALE_CNT=$((STALE_CNT + 1))
    fi
}

for dir in docs PKGM-Wiki/docs PKGM-Manager/docs; do
    [[ -d "$PROJECT_ROOT/$dir" ]] || continue
    while read -r f; do
        check_file "$f"
    done < <(find "$PROJECT_ROOT/$dir" -name '*.md' | sort)
done

if [ $STALE_CNT -eq 0 ]; then
    ok "所有文档均在 ${DAYS} 天内更新"
else
    warn "发现 $STALE_CNT 个超过 ${DAYS} 天未更新的文档"
fi

echo ""

# =====================
# 汇总
# =====================
echo "=== 汇总 ==="
echo "错误: $ERRORS"
echo "警告: $WARNINGS"
echo ""

if [ $ERRORS -gt 0 ]; then
    echo "❌ 检查未通过，请修复上述错误。"
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo "⚠️  检查通过（有警告，建议处理）。"
    exit 0
else
    echo "✅ 全部检查通过。"
    exit 0
fi