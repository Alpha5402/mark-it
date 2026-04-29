#!/usr/bin/env bash
#
# cr-review.sh — 本地 CR 审查
#
# 功能：
#   1. 确定 diff 范围 (未提交代码 / 指定 commit / 检查点 / 全量)
#   2. 按依赖关系分片
#   3. 调用 codebuddy 并行执行分批 CR (--model claude-opus-4.6)
#   4. 调用 codebuddy 执行 CR 意见复核 (--model gpt-5.5)
#   5. 输出结构化 JSON 结果
#
# 用法：
#   ./cr-review.sh                          # 审查未提交的代码 (staged + unstaged)
#   ./cr-review.sh --commit <hash>          # 从指定 commit 到 HEAD 的 diff
#   ./cr-review.sh --checkpoint             # 从本地检查点到 HEAD 的增量 diff
#   ./cr-review.sh --full                   # 从 merge-base(master, HEAD) 全量 diff
#   ./cr-review.sh --concurrency 4          # 设置并行数 (默认 4)
#
# 环境变量 (.env):
#   CODEBUDDY_API_KEY  — CodeBuddy API Key (复核阶段使用)
#
# 依赖：
#   - git, jq
#   - codebuddy (npm install -g @tencent-ai/codebuddy-code)
#
# 输出：
#   cr-output/cr-result.json         — 最终 CR 结果
#   cr-output/cr-controversial.json  — 被复核移除的 Issue
#   cr-output/cr-summary.txt         — 一行摘要
#   cr-output/batches/batches.json   — 分片详情
#   cr-output/cr-batches/cr_*.json   — 各批次原始结果

# ============================================================
# 前置：确保 Node.js 环境 (nohup 后台进程不会继承 shell 配置)
# ============================================================
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  # 优先 24，其次 20，最低 18
  for _v in 24 20 18; do
    nvm use "$_v" >/dev/null 2>&1 && break
  done
elif command -v fnm &>/dev/null; then
  eval "$(fnm env)" 2>/dev/null || true
  for _v in 24 20 18; do
    fnm use "$_v" >/dev/null 2>&1 && break
  done
fi

set -euo pipefail

# ============================================================
# 参数解析
# ============================================================

MODE="uncommitted"  # uncommitted | commit | checkpoint | full
COMMIT_HASH=""
CONCURRENCY=4
PROMPT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)
      MODE="commit"
      COMMIT_HASH="$2"
      shift 2
      ;;
    --checkpoint)
      MODE="checkpoint"
      shift
      ;;
    --full)
      MODE="full"
      shift
      ;;
    --concurrency)
      CONCURRENCY="$2"
      shift 2
      ;;
    --prompt)
      PROMPT_FILE="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ============================================================
# 常量
# ============================================================

OUTPUT_DIR="cr-output"
BATCH_DIR="$OUTPUT_DIR/batches"
CR_BATCHES_DIR="$OUTPUT_DIR/cr-batches"
RESULT_FILE="$OUTPUT_DIR/cr-result.json"
CONTROVERSIAL_FILE="$OUTPUT_DIR/cr-controversial.json"
SUMMARY_FILE="$OUTPUT_DIR/cr-summary.txt"
META_FILE="$OUTPUT_DIR/cr-meta.txt"

MAX_FILES_PER_BATCH=10
MAX_LINES_PER_BATCH=500
MAX_TOTAL_LINES=2000

EXCLUDES=(
  ':(exclude)package-lock.json'
  ':(exclude)yarn.lock'
  ':(exclude)pnpm-lock.yaml'
  ':(exclude).codebuddy/'
  ':(exclude)node_modules/'
)

# ============================================================
# 工具函数
# ============================================================

log() { echo "[$1] $2"; }
info() { log "INFO" "$1"; }
warn() { log "WARN" "$1"; }
error() { log "ERROR" "$1"; exit 1; }

cleanup() {
  rm -f "$BATCH_DIR/_file_lines.txt" "$BATCH_DIR/_file_lines_sorted.txt" \
        "$BATCH_DIR/_objects.ndjson" "$BATCH_DIR/_import_groups.json" \
        "$BATCH_DIR/_basename_map.txt" "$BATCH_DIR/_file_group.txt" \
        "$BATCH_DIR/_file_group.txt.tmp" "$BATCH_DIR/_file_lines_sorted.txt.tmp" 2>/dev/null || true
}
trap cleanup EXIT

# ============================================================
# Step 0: 环境检查
# ============================================================

# 加载 .env (支持脚本同目录或工作区根目录)
load_env() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  for env_file in "$script_dir/.env" "./.env" "$HOME/.cr-review.env"; do
    if [[ -f "$env_file" ]]; then
      info "加载环境变量: $env_file"
      set -a
      # shellcheck source=/dev/null
      source "$env_file"
      set +a
      return 0
    fi
  done

  warn "未找到 .env 文件"
  return 0  # 不报错，后续检查具体变量
}

check_api_key() {
  if [[ -z "${CODEBUDDY_API_KEY:-}" ]]; then
    echo ""
    echo "============================================"
    echo "  CODEBUDDY_API_KEY 未设置"
    echo ""
    echo "  复核阶段需要此 Key。请创建 .env 文件："
    echo ""
    echo "    echo 'CODEBUDDY_API_KEY=your_key_here' > .env"
    echo ""
    echo "  或直接 export:"
    echo ""
    echo "    export CODEBUDDY_API_KEY=your_key_here"
    echo ""
    echo "  获取方式: https://iwiki.woa.com/p/4020027673"
    echo "============================================"
    echo ""
    error "CODEBUDDY_API_KEY 缺失，无法继续"
  fi
  info "CODEBUDDY_API_KEY 已配置"
}

ensure_node_version() {
  local required_major=18
  local preferred_major=24

  local current_version
  current_version=$(node --version 2>/dev/null || echo "none")
  local current_major=0
  if [[ "$current_version" =~ ^v([0-9]+) ]]; then
    current_major="${BASH_REMATCH[1]}"
  fi

  if [[ "$current_major" -ge "$required_major" ]]; then
    info "Node.js $current_version"
    return 0
  fi

  info "Node.js $current_version 版本过低 (需要 >= v${required_major})，尝试切换..."

  # nvm
  if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    for v in $preferred_major 20 $required_major; do
      if nvm use "$v" >/dev/null 2>&1; then
        info "已切换到 Node.js $(node --version)"
        return 0
      fi
    done
  fi

  # fnm
  if command -v fnm &>/dev/null; then
    for v in $preferred_major 20 $required_major; do
      if fnm use "$v" >/dev/null 2>&1; then
        info "已切换到 Node.js $(node --version)"
        return 0
      fi
    done
  fi

  error "Node.js >= v${required_major} 不可用 (当前: $current_version)。请执行: nvm install ${preferred_major} && nvm use ${preferred_major}"
}

check_codebuddy_cli() {
  info "检查 codebuddy..."

  if command -v codebuddy &>/dev/null; then
    local version
    version=$(codebuddy --version 2>&1 || echo "unknown")
    if echo "$version" | grep -q "requires Node.js"; then
      warn "codebuddy Node.js 版本不兼容"
      return 1
    fi
    info "codebuddy 已安装: $version"
    return 0
  fi

  warn "codebuddy 未安装，正在安装..."
  if npm install -g @tencent-ai/codebuddy-code 2>&1; then
    info "codebuddy 安装成功"
    return 0
  fi

  if npm install -g @tencent-ai/codebuddy-code --registry=https://mirrors.tencent.com/npm/ 2>&1; then
    info "codebuddy 安装成功 (内部 registry)"
    return 0
  fi

  error "codebuddy 安装失败。请手动执行: npm install -g @tencent-ai/codebuddy-code"
}

# ============================================================
# Step 1: 确定 Diff 范围
# ============================================================

determine_diff_range() {
  info "确定 diff 范围 (模式: $MODE)..."

  mkdir -p "$OUTPUT_DIR"

  local current_commit current_commit_short current_commit_msg
  current_commit=$(git rev-parse HEAD)
  current_commit_short=$(git rev-parse --short HEAD)
  current_commit_msg=$(git log -1 --pretty=%s)

  local base="" checkpoint_source="" diff_source="commits" using_staged=false

  case "$MODE" in
    uncommitted)
      # 优先用暂存区，没有则用工作区变更
      local staged_files unstaged_files
      staged_files=$(git diff --cached --name-only -- . "${EXCLUDES[@]}" || true)
      unstaged_files=$(git diff --name-only -- . "${EXCLUDES[@]}" || true)

      if [[ -n "$staged_files" || -n "$unstaged_files" ]]; then
        using_staged=true
        diff_source="working-tree"
        checkpoint_source="工作区未提交变更"
        base="HEAD"
        info "使用未提交变更 (staged + unstaged)"
      else
        warn "无未提交变更，降级为 merge-base 全量模式"
        MODE="full"
        determine_diff_range  # 递归调用一次
        return
      fi
      ;;

    commit)
      if [[ -z "$COMMIT_HASH" ]]; then
        error "必须指定 commit hash: --commit <hash>"
      fi
      if ! git cat-file -e "${COMMIT_HASH}^{commit}" 2>/dev/null; then
        error "无效的 commit: $COMMIT_HASH"
      fi
      base="$COMMIT_HASH"
      checkpoint_source="指定 commit $COMMIT_HASH"
      info "从指定 commit 展开: $COMMIT_HASH..HEAD"
      ;;

    checkpoint)
      local last_commit=""
      local local_checkpoint="$OUTPUT_DIR/last-checkpoint"

      # 优先级 1: 本地缓存
      if [[ -f "$local_checkpoint" ]]; then
        local cached
        cached=$(head -1 "$local_checkpoint" | tr -d '[:space:]')
        if [[ -n "$cached" ]] && git cat-file -e "${cached}^{commit}" 2>/dev/null; then
          last_commit="$cached"
          checkpoint_source="本地缓存检查点"
          info "使用本地缓存检查点: $last_commit"
        fi
      fi

      # 优先级 2: MR 评论 (通过 MCP 查询，需要 comments.json 已存在)
      if [[ -z "$last_commit" ]] && [[ -f "$OUTPUT_DIR/comments.json" ]]; then
        last_commit=$(jq -r '.[].body' "$OUTPUT_DIR/comments.json" \
          | grep -oE 'AICR_LAST_REVIEW:\s*[a-f0-9]{40}' \
          | awk '{print $2}' \
          | tail -n1 \
          || true)
        if [[ -n "$last_commit" ]]; then
          checkpoint_source="MR 评论 AICR 标记"
          info "使用 MR 评论检查点: $last_commit"
        fi
      fi

      # 优先级 3: 兜底 merge-base
      if [[ -z "$last_commit" ]]; then
        warn "无有效检查点，降级为 merge-base"
        MODE="full"
        determine_diff_range
        return
      fi

      if ! git cat-file -e "${last_commit}^{commit}" 2>/dev/null; then
        warn "检查点 commit 不在本地仓库，降级为 merge-base"
        MODE="full"
        determine_diff_range
        return
      fi

      base="$last_commit"
      ;;

    full)
      git fetch origin master >/dev/null 2>&1 || git fetch origin main >/dev/null 2>&1 || true
      local target_branch=""
      for branch in master main; do
        if git rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
          target_branch="$branch"
          break
        fi
      done
      [[ -z "$target_branch" ]] && error "找不到 master 或 main 分支"

      base=$(git merge-base "origin/$target_branch" HEAD)
      checkpoint_source="merge-base origin/$target_branch (全量)"
      info "全量模式: $base..HEAD"
      ;;
  esac

  # 导出给后续步骤
  DIFF_BASE="$base"
  DIFF_USING_STAGED="$using_staged"
  DIFF_CHECKPOINT_SOURCE="$checkpoint_source"
  DIFF_SOURCE="$diff_source"

  if [[ "$using_staged" == true ]]; then
    DIFF_RANGE=""  # 特殊标记：用 --cached + 工作区
  else
    DIFF_RANGE="$base..HEAD"
  fi

  # 获取变更文件
  if [[ "$using_staged" == true ]]; then
    FILES=$(git diff --cached --name-only -- . "${EXCLUDES[@]}" || true)
    local unstaged
    unstaged=$(git diff --name-only -- . "${EXCLUDES[@]}" || true)
    if [[ -n "$unstaged" ]]; then
      FILES=$(printf '%s\n%s' "$FILES" "$unstaged" | sort -u)
    fi
  else
    FILES=$(git diff "$DIFF_RANGE" --name-only -- . "${EXCLUDES[@]}" || true)
  fi

  if [[ -z "$FILES" ]]; then
    info "无变更文件"
    echo "CR 无变更文件，跳过" > "$SUMMARY_FILE"
    echo "[]" > "$RESULT_FILE"
    exit 0
  fi

  FILE_COUNT=$(echo "$FILES" | wc -l | tr -d ' ')

  # 规模检查
  local total_lines=0
  if [[ "$using_staged" == true ]]; then
    total_lines=$(git diff --cached --shortstat -- . "${EXCLUDES[@]}" \
      | awk -F',' '{add=$2; del=$3; gsub(/[^0-9]/,"",add); gsub(/[^0-9]/,"",del); print add+del}')
    local unstaged_lines
    unstaged_lines=$(git diff --shortstat -- . "${EXCLUDES[@]}" \
      | awk -F',' '{add=$2; del=$3; gsub(/[^0-9]/,"",add); gsub(/[^0-9]/,"",del); print add+del}')
    total_lines=$(( ${total_lines:-0} + ${unstaged_lines:-0} ))
  else
    total_lines=$(git diff "$DIFF_RANGE" --shortstat -- . "${EXCLUDES[@]}" \
      | awk -F',' '{add=$2; del=$3; gsub(/[^0-9]/,"",add); gsub(/[^0-9]/,"",del); print add+del}')
  fi
  total_lines=${total_lines:-0}
  TOTAL_LINES="$total_lines"

  if [[ "$total_lines" -gt "$MAX_TOTAL_LINES" ]]; then
    warn "变更过大 (${total_lines} 行，上限 ${MAX_TOTAL_LINES})，跳过"
    echo "CR 跳过：变更行数 ${total_lines} 超过上限 ${MAX_TOTAL_LINES}" > "$SUMMARY_FILE"
    echo "[]" > "$RESULT_FILE"
    exit 0
  fi

  # 生成 patch
  local patch_file="$OUTPUT_DIR/diff.patch"
  rm -f "$patch_file"
  if [[ "$using_staged" == true ]]; then
    for f in $FILES; do
      git diff --cached -- "$f" >> "$patch_file" 2>/dev/null || true
      git diff -- "$f" >> "$patch_file" 2>/dev/null || true
    done
  else
    for f in $FILES; do
      git diff "$DIFF_RANGE" -- "$f" >> "$patch_file"
    done
  fi

  # 写入元信息
  cat > "$META_FILE" <<EOF
current_commit=$current_commit
current_commit_short=$current_commit_short
current_commit_msg=$current_commit_msg
base_commit=$base
checkpoint_source=$checkpoint_source
diff_source=$diff_source
mode=$MODE
file_count=$FILE_COUNT
total_lines=$total_lines
EOF

  info "变更: $FILE_COUNT 个文件, $total_lines 行"
}

# ============================================================
# Step 2: 按依赖关系分片
# ============================================================

split_batches() {
  info "执行分片..."

  rm -rf "$BATCH_DIR"
  mkdir -p "$BATCH_DIR"

  local file_lines_list="$BATCH_DIR/_file_lines.txt"
  local sorted_list="$BATCH_DIR/_file_lines_sorted.txt"
  local import_groups="$BATCH_DIR/_import_groups.json"
  local objects_file="$BATCH_DIR/_objects.ndjson"

  > "$file_lines_list"
  > "$objects_file"

  # ---- 统计每个文件的变更行数 ----
  echo ""
  echo "========== 文件变更行数 =========="
  printf "%-6s  %-40s  %s\n" "行数" "文件" "导入关系"
  echo "------  ----------------------------------------  ----------"

  for f in $FILES; do
    local flines=0
    if [[ "$DIFF_USING_STAGED" == true ]]; then
      flines=$(( $(git diff --cached -- "$f" 2>/dev/null | grep -c '^[+-]' || true) \
               + $(git diff -- "$f" 2>/dev/null | grep -c '^[+-]' || true) ))
    else
      flines=$(git diff "$DIFF_RANGE" -- "$f" | grep -c '^[+-]' || true)
    fi

    # 提取 import 关系 (用于依赖分组)
    local imports=""
    if [[ -f "$f" ]]; then
      imports=$(grep -oE "from ['\"]\.\.?/[^'\"]+['\"]" "$f" 2>/dev/null \
        | sed "s/from ['\"]//;s/['\"]$//" \
        | head -5 \
        | tr '\n' ',' \
        | sed 's/,$//' \
        || true)
    fi

    echo "$flines|$f|$imports" >> "$file_lines_list"
    printf "%-6s  %-40s  %s\n" "$flines" "$f" "${imports:-(无)}"
  done

  # ---- 依赖分组 (兼容 bash 3.x，不使用关联数组) ----
  # 策略：解析 import 关系，将相互引用的变更文件归为同一组
  # 使用临时文件代替关联数组：
  #   _basename_map.txt  →  basename|filepath (用于匹配 import 目标)
  #   _file_group.txt    →  filepath|group_id (文件→组映射)
  info "分析文件间依赖关系..."

  local basename_map="$BATCH_DIR/_basename_map.txt"
  local file_group_map="$BATCH_DIR/_file_group.txt"
  local group_idx=0

  > "$basename_map"
  > "$file_group_map"

  # 收集所有变更文件的 basename (去掉扩展名)
  for f in $FILES; do
    local bn
    bn=$(basename "$f" | sed 's/\.\(ts\|tsx\|js\|jsx\|vue\|css\|scss\|less\)$//')
    echo "$bn|$f" >> "$basename_map"
  done

  # 辅助函数：查询文件的组 ID (从临时文件中 grep)
  _get_group() {
    local result
    result=$(grep "^$1|" "$file_group_map" 2>/dev/null | head -1 | cut -d'|' -f2) || true
    echo "$result"
  }

  # 辅助函数：设置文件的组 ID
  _set_group() {
    # 先删除旧记录，再追加新记录
    local tmpf="${file_group_map}.tmp"
    grep -v "^$1|" "$file_group_map" > "$tmpf" 2>/dev/null || true
    echo "$1|$2" >> "$tmpf"
    mv "$tmpf" "$file_group_map"
  }

  # 辅助函数：通过 basename 查找变更文件路径
  _find_by_basename() {
    local result
    result=$(grep "^$1|" "$basename_map" 2>/dev/null | head -1 | cut -d'|' -f2) || true
    echo "$result"
  }

  # 对每个文件，检查 import 是否指向其他变更文件
  for f in $FILES; do
    local existing_group
    existing_group=$(_get_group "$f")
    if [[ -n "$existing_group" ]]; then
      continue  # 已分组
    fi

    local current_group="$group_idx"
    _set_group "$f" "$current_group"

    # 提取 import 路径，匹配其他变更文件
    if [[ -f "$f" ]]; then
      local imp_line imp_base dep_file
      while IFS= read -r imp_line; do
        imp_base=$(basename "$imp_line" | sed 's/\.\(ts\|tsx\|js\|jsx\|vue\|css\|scss\|less\)$//')
        dep_file=$(_find_by_basename "$imp_base")
        if [[ -n "$dep_file" ]]; then
          local dep_group
          dep_group=$(_get_group "$dep_file")
          if [[ -z "$dep_group" ]]; then
            _set_group "$dep_file" "$current_group"
          fi
        fi
      done < <(grep -oE "from ['\"]\.\.?/[^'\"]+['\"]" "$f" 2>/dev/null \
        | sed "s/from ['\"]//;s/['\"]$//" || true)
    fi

    group_idx=$((group_idx + 1))
  done

  # 未分组的文件按目录兜底
  for f in $FILES; do
    local existing_group
    existing_group=$(_get_group "$f")
    if [[ -z "$existing_group" ]]; then
      local dir found_group=""
      dir=$(dirname "$f")
      for other in $FILES; do
        if [[ "$(dirname "$other")" == "$dir" ]]; then
          found_group=$(_get_group "$other")
          if [[ -n "$found_group" ]]; then
            break
          fi
        fi
      done
      if [[ -n "$found_group" ]]; then
        _set_group "$f" "$found_group"
      else
        _set_group "$f" "$group_idx"
        group_idx=$((group_idx + 1))
      fi
    fi
  done

  # 输出分组结果
  echo ""
  echo "========== 依赖分组 =========="
  local prev_grp=""
  sort -t'|' -k2,2n "$file_group_map" | while IFS='|' read -r gf gid; do
    if [[ "$gid" != "$prev_grp" ]]; then
      [[ -n "$prev_grp" ]] && echo ""
      echo "  组 $gid:"
      prev_grp="$gid"
    fi
    echo "    $gf"
  done

  # ---- 按组+行数装箱 ----
  # 排序：先按组 ID 排列，组内按行数升序
  # 生成 sorted_list：格式 行数|文件|import|组ID
  > "$sorted_list"
  while IFS='|' read -r flines f fimports; do
    local gid
    gid=$(_get_group "$f")
    gid=${gid:-999}
    echo "${gid}|${flines}|${f}|${fimports}" >> "$sorted_list"
  done < "$file_lines_list"
  sort -t'|' -k1,1n -k2,2n "$sorted_list" > "${sorted_list}.tmp" && mv "${sorted_list}.tmp" "$sorted_list"

  local batch_idx=0
  local -a batch_files=()
  local batch_lines=0

  flush_batch() {
    [[ ${#batch_files[@]} -eq 0 ]] && return

    echo ""
    echo "┌─ Batch $batch_idx ─────────────────────────────"
    echo "│  文件数: ${#batch_files[@]}  |  变更行: ~$batch_lines"
    for bf in "${batch_files[@]}"; do
      echo "│    $bf"
    done
    if [[ ${#batch_files[@]} -eq 1 ]] && [[ "$batch_lines" -gt "$MAX_LINES_PER_BATCH" ]]; then
      echo "│  分片原因: 大文件独占 (>$MAX_LINES_PER_BATCH 行)"
    fi
    echo "└───────────────────────────────────────────────"

    # 生成 patch 内容
    local patch_content=""
    for bf in "${batch_files[@]}"; do
      if [[ "$DIFF_USING_STAGED" == true ]]; then
        patch_content="$patch_content$(git diff --cached -- "$bf" 2>/dev/null || true)"$'\n'
        patch_content="$patch_content$(git diff -- "$bf" 2>/dev/null || true)"$'\n'
      else
        patch_content="$patch_content$(git diff "$DIFF_RANGE" -- "$bf")"$'\n'
      fi
    done

    local files_json
    files_json=$(printf '%s\n' "${batch_files[@]}" | jq -R . | jq -s .)

    jq -n \
      --argjson batch "$batch_idx" \
      --argjson files "$files_json" \
      --arg patch "$patch_content" \
      --argjson lines "$batch_lines" \
      '{"batch": $batch, "files": $files, "patch": $patch, "total_lines": $lines}' \
      >> "$objects_file"

    batch_idx=$((batch_idx + 1))
    batch_files=()
    batch_lines=0
  }

  echo ""
  echo "========== 分片结果 =========="

  while IFS='|' read -r _gid flines f _imports; do
    flines=${flines:-0}

    # 大文件独占一批
    if [[ "$flines" -gt "$MAX_LINES_PER_BATCH" ]]; then
      flush_batch
      batch_files=("$f")
      batch_lines=$flines
      flush_batch
      continue
    fi

    # 当前批次已满
    if [[ ${#batch_files[@]} -ge $MAX_FILES_PER_BATCH ]] || \
       [[ $((batch_lines + flines)) -gt $MAX_LINES_PER_BATCH ]]; then
      flush_batch
    fi

    batch_files+=("$f")
    batch_lines=$((batch_lines + flines))
  done < "$sorted_list"

  flush_batch

  # 生成最终 JSON
  jq -s '.' "$objects_file" > "$BATCH_DIR/batches.json"
  TOTAL_BATCHES=$(jq 'length' "$BATCH_DIR/batches.json")

  echo ""
  echo "==============================="
  echo "分片完成: $TOTAL_BATCHES 个批次, $FILE_COUNT 个文件"
  echo "==============================="
}

# ============================================================
# Step 3: 并行执行 CR (codebuddy --model claude-opus-4.6)
# ============================================================

extract_json_from_output() {
  local raw="$1"
  # 策略 1: 整体就是合法 JSON
  if echo "$raw" | jq empty 2>/dev/null; then
    echo "$raw"
    return 0
  fi
  # 策略 2: 提取 [ ... ] 数组部分
  local part
  part=$(echo "$raw" | sed -n '/^\[/,/^\]/p' | head -1000) || true
  if [[ -n "$part" ]] && echo "$part" | jq empty 2>/dev/null; then
    echo "$part"
    return 0
  fi
  # 策略 3: 提取 ```json ... ``` 代码块
  part=$(echo "$raw" | sed -n '/```json/,/```/p' | sed '1d;$d') || true
  if [[ -n "$part" ]] && echo "$part" | jq empty 2>/dev/null; then
    echo "$part"
    return 0
  fi
  return 1
}

run_cr_parallel() {
  info "启动并行 CR 审查 (codebuddy claude-opus-4.6, 并发: $CONCURRENCY, 批次: $TOTAL_BATCHES)..."

  mkdir -p "$CR_BATCHES_DIR"
  echo "[]" > "$RESULT_FILE"

  # 统一进度文件：所有批次的 codebuddy 输出实时追加到此文件
  local progress_file="$OUTPUT_DIR/cr-progress.log"
  > "$progress_file"

  local pids=()
  local running=0

  for i in $(seq 0 $((TOTAL_BATCHES - 1))); do
    local batch_json
    batch_json=$(jq -c ".[$i]" "$BATCH_DIR/batches.json")

    local batch_num files_str patch_content
    batch_num=$(echo "$batch_json" | jq -r '.batch')
    files_str=$(echo "$batch_json" | jq -r '.files | join(", ")')
    patch_content=$(echo "$batch_json" | jq -r '.patch')

    local batch_output="$CR_BATCHES_DIR/cr_${batch_num}.json"
    local batch_log="$CR_BATCHES_DIR/cr_${batch_num}.log"

    info "  Batch $batch_num: $files_str"

    # 构造 prompt
    local prompt="This is an automated Code Review task (batch ${batch_num}).

Files: ${files_str}

Patch:
${patch_content}

Instructions:
- Find issues ONLY introduced or amplified by this patch. Evidence required.
- Code-driven: read code first, then match rules. Discard if uncertain.
- Engineering pragmatism > theoretical correctness. If patch follows existing patterns, don't report.
- Three perspectives: design (responsibility scope expansion), implementation (correctness, type safety, consistency), defect (reproducible runtime risks).
- Discard: rename-only, format-only, follows existing patterns, style preferences, needs changes outside patch, no code evidence.
- One code evidence = one issue. Pick the phase that best drives the fix.

Output: pure JSON array. Each item: {file, lineRange, line, phase, risk, rule, problem, reason, suggestion}. All text fields in Chinese except code/variable names. Empty = []. No text outside JSON."

    # 后台启动 codebuddy CR
    local prompt_file="$CR_BATCHES_DIR/cr_${batch_num}.prompt"
    echo "$prompt" > "$prompt_file"

    (
      exec > "$batch_log" 2>&1

      echo "=== Batch $batch_num 开始 ==="
      echo "Prompt 长度: $(wc -c < "$prompt_file") 字节"
      echo "codebuddy 路径: $(which codebuddy 2>/dev/null || echo 'NOT FOUND')"
      echo "Node 版本: $(node --version 2>/dev/null || echo 'N/A')"
      echo "CODEBUDDY_API_KEY: ${CODEBUDDY_API_KEY:+已设置}"
      echo ""

      local exit_code=0
      local prompt_content
      prompt_content=$(cat "$prompt_file")
      # codebuddy 输出通过 tee 同时写入:
      #   1. 当前子 shell 的 stdout (被 exec 重定向到 batch_log)
      #   2. 统一进度文件 (供外部 tail -f 观察)
      {
        echo "[Batch $batch_num] >>> codebuddy 开始执行"
        codebuddy -p --model claude-opus-4.6 --output-format text "$prompt_content" 2>&1
        echo ""
        echo "[Batch $batch_num] >>> codebuddy 执行完毕"
      } | tee -a "$progress_file" || exit_code=$?

      echo ""
      echo "=== Batch $batch_num 结束 (exit: $exit_code) ==="

      if [[ $exit_code -ne 0 ]]; then
        echo "[]" > "$batch_output"
      else
        # 从 log 中提取 JSON（跳过诊断头和尾）
        local raw_output
        raw_output=$(sed -n '/^=== Batch .* 开始 ===/,/^=== Batch .* 结束/{ /^===/d; p; }' "$batch_log" \
          | grep -v '^Prompt 长度:' \
          | grep -v '^codebuddy 路径:' \
          | grep -v '^Node 版本:' \
          | grep -v '^CODEBUDDY_API_KEY:' \
          | grep -v '^$')

        local json_result
        if json_result=$(extract_json_from_output "$raw_output"); then
          echo "$json_result" > "$batch_output"
        else
          echo "[WARN] 无法从输出中提取 JSON" >&2
          echo "[]" > "$batch_output"
        fi
      fi

      [[ -f "$batch_output" ]] || echo "[]" > "$batch_output"
    ) &

    pids+=($!)
    running=$((running + 1))

    # 并发控制
    if [[ $running -ge $CONCURRENCY ]]; then
      wait "${pids[0]}"
      pids=("${pids[@]:1}")
      running=$((running - 1))
    fi
  done

  # 等待所有任务完成
  for pid in "${pids[@]}"; do
    wait "$pid" || true
  done

  # 合并所有批次结果 + 打印执行状态
  info "合并 $TOTAL_BATCHES 个批次结果..."
  echo "[]" > "$RESULT_FILE"
  for i in $(seq 0 $((TOTAL_BATCHES - 1))); do
    local batch_out="$CR_BATCHES_DIR/cr_${i}.json"
    local batch_lg="$CR_BATCHES_DIR/cr_${i}.log"

    # 打印批次执行状态
    if [[ -f "$batch_lg" ]]; then
      local batch_exit
      batch_exit=$(grep "^=== Batch .* 结束" "$batch_lg" | grep -oE 'exit: [0-9]+' | head -1) || true
      if echo "$batch_exit" | grep -q "exit: 0"; then
        info "  Batch $i: 成功"
      else
        warn "  Batch $i: 失败 ($batch_exit)"
        warn "  --- 日志摘要 ---"
        tail -15 "$batch_lg" >&2
        warn "  --- 日志结束 ---"
      fi
    else
      warn "  Batch $i: 日志文件不存在"
    fi

    if [[ -f "$batch_out" ]]; then
      jq -s '.[0] + .[1]' "$RESULT_FILE" "$batch_out" > "${RESULT_FILE}.tmp" \
        && mv "${RESULT_FILE}.tmp" "$RESULT_FILE"
    fi
  done

  local total_issues
  total_issues=$(jq 'length' "$RESULT_FILE")
  info "CR 审查完成: $total_issues 条 Issue"
}

# ============================================================
# Step 4: 复核 (codebuddy, ChatGPT-5.5)
# ============================================================

run_verify() {
  local total_issues
  total_issues=$(jq 'length' "$RESULT_FILE")

  if [[ "$total_issues" -eq 0 ]]; then
    info "无 Issue，跳过复核"
    echo "[]" > "$CONTROVERSIAL_FILE"
    return
  fi

  info "执行复核 (codebuddy, $total_issues 条 Issue)..."

  local verify_log="$OUTPUT_DIR/cr-verify.log"
  local verify_prompt="Review the following CR issues. For each issue: if rule starts with CR, verify against rule definition; if DEFECT, verify trigger conditions are reachable in normal usage; otherwise verify the problem genuinely exists with code evidence. Keep valid ones, remove invalid ones. Output ONLY a pure JSON array of the valid issues. No text outside JSON."

  local exit_code=0
  cat "$RESULT_FILE" | codebuddy "$verify_prompt" > "$verify_log" 2>&1 || exit_code=$?

  if [[ $exit_code -ne 0 ]]; then
    warn "复核失败 (exit: $exit_code):"
    tail -20 "$verify_log" >&2
    echo "[]" > "$CONTROVERSIAL_FILE"
    return
  fi

  local raw_output
  raw_output=$(cat "$verify_log")
  local verified_json

  if verified_json=$(extract_json_from_output "$raw_output"); then
    # 备份原始结果用于计算差集
    cp "$RESULT_FILE" "${RESULT_FILE}.bak"
    echo "$verified_json" > "$RESULT_FILE"

    # 计算被移除的 Issue
    jq -s '[.[0][] as $orig | if ([.[1][] | select(.file == $orig.file and .line == $orig.line)] | length) == 0 then $orig + {"filtered_reason": "复核移除"} else empty end]' \
      "${RESULT_FILE}.bak" "$RESULT_FILE" > "$CONTROVERSIAL_FILE" 2>/dev/null || echo "[]" > "$CONTROVERSIAL_FILE"

    rm -f "${RESULT_FILE}.bak"
  else
    warn "复核输出无法解析为 JSON，保留原始结果"
    echo "[]" > "$CONTROVERSIAL_FILE"
  fi

  # 最终校验
  jq empty "$RESULT_FILE" 2>/dev/null || { warn "result.json 非法，重置"; echo "[]" > "$RESULT_FILE"; }
  jq empty "$CONTROVERSIAL_FILE" 2>/dev/null || echo "[]" > "$CONTROVERSIAL_FILE"

  local final_count removed_count
  final_count=$(jq 'length' "$RESULT_FILE")
  removed_count=$(jq 'length' "$CONTROVERSIAL_FILE")
  info "复核完成: 保留 $final_count 条, 移除 $removed_count 条"
}

# ============================================================
# Step 5: 生成摘要
# ============================================================

generate_summary() {
  local total serious normal slight
  total=$(jq 'length' "$RESULT_FILE")
  serious=$(jq '[.[] | select(.risk == "SERIOUS")] | length' "$RESULT_FILE")
  normal=$(jq '[.[] | select(.risk == "NORMAL")] | length' "$RESULT_FILE")
  slight=$(jq '[.[] | select(.risk == "SLIGHT")] | length' "$RESULT_FILE")

  if [[ "$total" -eq 0 ]]; then
    echo "CR 未发现问题" > "$SUMMARY_FILE"
  else
    echo "CR 发现 ${total} 个问题 (SERIOUS ${serious}、NORMAL ${normal}、SLIGHT ${slight})" > "$SUMMARY_FILE"
  fi

  # 保存检查点 (供下次增量使用)
  git rev-parse HEAD > "$OUTPUT_DIR/last-checkpoint"

  echo ""
  echo "==============================="
  echo "$(cat "$SUMMARY_FILE")"
  echo ""
  echo "输出文件:"
  echo "  结果:   $RESULT_FILE"
  echo "  移除:   $CONTROVERSIAL_FILE"
  echo "  摘要:   $SUMMARY_FILE"
  echo "  分片:   $BATCH_DIR/batches.json"
  echo "==============================="
}

# ============================================================
# Main
# ============================================================

main() {
  echo "==============================="
  echo "TAB AI CR 审查"
  echo "  CR:   codebuddy --model claude-opus-4.6"
  echo "  复核: codebuddy --model gpt-5.5"
  echo "==============================="
  echo ""

  load_env
  check_api_key
  ensure_node_version
  check_codebuddy_cli
  determine_diff_range
  split_batches
  run_cr_parallel
  run_verify
  generate_summary
}

main
