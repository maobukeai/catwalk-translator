#!/bin/bash
# ==============================================================
# Product Evolution Mode — Main Controller Loop
# Hermes-controlled. agy is always a leaf (single-round).
# Stop condition: STOP_REQUESTED=true in evolution.log
# ==============================================================
set -u

WORKDIR="/c/Users/20269/Desktop/项目文件夹/翻译软件"
cd "$WORKDIR" || exit 1
STATE_DIR="$WORKDIR/.agent"
LOG="$STATE_DIR/evolution.log"
REPORT_PATH="/c/Users/20269/AppData/Local/Temp/EVOLUTION_REPORT.md"
mkdir -p "$STATE_DIR"
mkdir -p "$WORKDIR/.worktrees"

START_EPOCH=$(date +%s)
ROUND=0
LAST_REPORT=0

STAGES=(
  "01/09 UI/UX"
  "02/09 交互体验"
  "03/09 前端代码"
  "04/09 后端代码"
  "05/09 业务逻辑"
  "06/09 代码质量"
  "07/09 性能"
  "08/09 测试"
  "09/09 新功能"
)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }
trim() { echo "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }

read_stage() {
  local out="01/09 UI/UX"
  if [ -f "$STATE_DIR/backlog.md" ]; then
    local line
    line=$(grep "^- Stage:" "$STATE_DIR/backlog.md" 2>/dev/null | head -1)
    if [ -n "$line" ]; then
      out=$(echo "$line" | cut -d: -f2- | xargs)
    fi
  fi
  echo "$out"
}

next_stage() {
  local cur="$1"
  local idx=0
  for i in "${!STAGES[@]}"; do
    if [ "${STAGES[$i]}" = "$cur" ]; then idx=$(( (i + 1) % ${#STAGES[@]} )); break; fi
  done
  echo "${STAGES[$idx]}"
}

get_latest_tag() { git tag --sort=-creatordate 2>/dev/null | head -1; }
get_head() { git log --oneline -1 2>/dev/null | cut -d' ' -f1; }

write_report() {
  local now elapsed
  now=$(date +%s)
  elapsed=$(( (now - START_EPOCH) / 60 ))
  local runtime_h=$((elapsed / 60))
  local runtime_m=$((elapsed % 60))
  local head tag
  head=$(get_head)
  tag=$(get_latest_tag)
  [ -z "$tag" ] && tag="v0.1.0"
  local latest_changes
  latest_changes=$(git log --oneline -5 2>/dev/null)
  local completed
  completed=$(awk '/^## Completed/{flag=1;next}/^## /{flag=0}flag' "$STATE_DIR/backlog.md" 2>/dev/null | head -20)
  [ -z "$completed" ] && completed="(无已完成项)"
  cat > "$REPORT_PATH" <<EOF
# Evolution Report — $(date '+%Y-%m-%d %H:%M:%S')

运行时长: ${runtime_h}h ${runtime_m}min
已完成轮数: ${ROUND}
当前阶段: ${1:-${STAGES[0]}}
当前版本: ${tag}
Git HEAD: ${head:-unknown}

## 最新改动
\`\`\`
${latest_changes}
\`\`\`

## 累计完成
${completed}
EOF
  log "EVOLUTION_REPORT 已生成: ${REPORT_PATH}"
}

# ============================================================
# MAIN LOOP
# ============================================================
while true; do
  if grep -q "STOP_REQUESTED=true" "$LOG" 2>/dev/null; then
    log "STOP_REQUESTED 已检测，主控循环退出"
    break
  fi

  ROUND=$((ROUND + 1))
  log "========== 第 ${ROUND} 轮开始 =========="

  STAGE=$(read_stage)
  log "当前轮盘阶段: ${STAGE}"

  ROUND_START=$(date +%s)

  # ============================================================
  # Phase 0: Research — 1 agy
  # ============================================================
  log "Phase 0: Research"
  RESEARCH_PROMPT=$(cat <<RPROMPT
你是 Product Evolution Mode 第 ${ROUND} 轮的研究 Agent。当前轮盘阶段：${STAGE}。

角色：只研究、不写代码。

步骤：
1. 先读取 /.agent/ 下所有文件（mission.md / roadmap.md / backlog.md / decisions.md / metrics.md），理解产品现状
2. 联网搜索（用 search_web / research 子代理）当前阶段相关最佳实践、竞品、设计趋势
3. 阅读 /c/Users/20269/Desktop/项目文件夹/翻译软件/app_v2/ 下代码，结合项目实际分析
4. 将研究报告写入 /.agent/research.md，结构：
   - 当前状态分析
   - 调研发现
   - 具体改进方案（可执行，含文件路径）
   - 技术选型建议
   - 风险评估
5. 完成后只输出 DONE，不写代码

禁止：写任何 .rs / .ts / .tsx 文件。
RPROMPT
)

  RESEARCH_OUT=$(agy -p "$RESEARCH_PROMPT" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 8m 2>&1)
  R_STATUS=$(echo "$RESEARCH_OUT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('status','ERROR'))" 2>/dev/null)
  if [ "$R_STATUS" = "SUCCESS" ]; then
    log "Phase 0 完成"
  else
    log "Phase 0 FAIL (status=$R_STATUS)，降级直接进 Phase 1"
  fi

  # ============================================================
  # Phase 1: Planner — 1 agy
  # ============================================================
  log "Phase 1: Planner"
  PLANNER_PROMPT=$(cat <<PPROMPT
你是 Product Evolution Mode 第 ${ROUND} 轮的规划 Agent。当前轮盘阶段：${STAGE}。

角色：只拆任务，不写代码。

步骤：
1. 读取 /.agent/research.md（如存在）
2. 读取 /.agent/backlog.md
3. 将本轮工作拆解为 N 个并行子任务（N ≥ 2），要求：
   - 文件范围不重叠（用 files 字段声明）
   - 每个子任务独立可开发、独立可测试
   - 粒度：文件级或模块级
4. 写入 /.agent/tasks.md，格式：

---
round: ${ROUND}
stage: ${STAGE}
N: <数量>
---
## Task 1
name: <任务名>
priority: P__
files: <文件列表，|分隔>
prompt: <完整开发指令>
---
## Task 2
name: <任务名>
priority: P__
files: <文件列表，|分隔>
prompt: <完整开发指令>
---

如果当前阶段无待办或 research.md 建议推进到下一阶段，写 N: 0 并在末尾写 ADVANCE_STAGE=true。

完成后只输出 DONE，不写代码。
PPROMPT
)

  PLANNER_OUT=$(agy -p "$PLANNER_PROMPT" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 5m 2>&1)
  P_STATUS=$(echo "$PLANNER_OUT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('status','ERROR'))" 2>/dev/null)
  log "Phase 1 status=$P_STATUS"

  TASKS="$STATE_DIR/tasks.md"
  if [ ! -f "$TASKS" ]; then
    log "tasks.md 未生成，本轮跳过"
    sleep 30
    continue
  fi

  # 检查是否建议推进阶段
  if grep -q "ADVANCE_STAGE=true" "$TASKS" 2>/dev/null; then
    NEW_STAGE=$(next_stage "$STAGE")
    log "当前阶段无待办，推进到 ${NEW_STAGE}"
    # 更新 backlog 顶部 Stage
    if grep -q "^- Stage:" "$STATE_DIR/backlog.md" 2>/dev/null; then
      sed -i "s/^- Stage:.*/- Stage: ${NEW_STAGE}/" "$STATE_DIR/backlog.md"
    else
      sed -i "1i\\- Stage: ${NEW_STAGE}" "$STATE_DIR/backlog.md" 2>/dev/null || echo "- Stage: ${NEW_STAGE}" >> "$STATE_DIR/backlog.md"
    fi
    log "更新 backlog.md Stage → ${NEW_STAGE}"
    sleep 15
    continue
  fi

  N=$(grep "^N:" "$TASKS" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '[:space:]')
  N=${N:-2}
  [ -z "$N" ] || [ "$N" -lt 2 ] 2>/dev/null && N=2

  # ============================================================
  # Phase 2: 并行 N 个 Dev
  # ============================================================
  log "Phase 2: 并行启动 N=${N} 个 Dev Agent"
  PIDS=()
  WT_DIRS=()

  for i in $(seq 1 "$N"); do
    TASK_NAME=$(sed -n "/^## Task ${i}$/,/^## Task /p" "$TASKS" 2>/dev/null | grep "^name:" | head -1 | cut -d: -f2- | xargs)
    TASK_PROMPT=$(sed -n "/^## Task ${i}$/,/^## Task /p" "$TASKS" 2>/dev/null | grep "^prompt:" | head -1 | cut -d: -f2-)

    [ -z "$TASK_NAME" ] && continue
    TASK_NAME_CLEAN=$(echo "$TASK_NAME" | tr -cs 'a-zA-Z0-9' '-')
    BRANCH="feature/r${ROUND}-t${i}-${TASK_NAME_CLEAN}"
    WT_DIR="$WORKDIR/.worktrees/t${i}"

    # 清理旧 worktree
    git worktree remove "$WT_DIR" 2>/dev/null
    git branch -D "$BRANCH" 2>/dev/null
    git worktree add "$WT_DIR" "$BRANCH" 2>/dev/null || \
      git worktree add "$WT_DIR" main -b "$BRANCH" 2>/dev/null
    WT_DIRS+=("$WT_DIR")

    DEV_PROMPT="${TASK_PROMPT}

当前工作目录：${WT_DIR}（独立 git worktree，分支 ${BRANCH}）
角色：开发 Agent，负责执行上述开发任务。

开发步骤：
1. 执行上述开发任务
2. 通过 10 道检查门的前 4 道 + 后 2 道（跳过视觉验证/回归/无倒退/控制台 由主控做）：
   - cargo build / npm run build 编译通过
   - cargo clippy 无 Warning
   - cargo test / npm run test 通过
   - cargo fmt --check / 前端格式正确
   - git diff 自查（只包含本次目标改动）
   - git commit -m "[${STAGE}] Task ${i}: ${TASK_NAME}"
3. 不要触发下一轮，完成后只输出 DONE

工作目录在提示中给出，请直接使用该路径。
"

    (
      cd "$WT_DIR" || exit 1
      agy -p "$DEV_PROMPT" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 15m
    ) > "/tmp/evolution_r${ROUND}_t${i}.log" 2>&1 &
    PIDS+=($!)
    log "Dev Agent ${i} 已启动: PID=$! 分支=${BRANCH}"
  done

  # 等待全部完成
  if [ ${#PIDS[@]} -gt 0 ]; then
    wait "${PIDS[@]}" 2>/dev/null
    log "Phase 2: 全部 ${#PIDS[@]} 个 Dev Agent 已完成"
  fi

  # ============================================================
  # Phase 3: 合并
  # ============================================================
  log "Phase 3: 合并"
  cd "$WORKDIR"
  MERGED=0
  for wt in "${WT_DIRS[@]}"; do
    BRANCH=$(git -C "$wt" branch --show-current 2>/dev/null | head -1)
    if [ -n "$BRANCH" ]; then
      if git merge "$BRANCH" --no-ff -m "merge: ${BRANCH}" 2>>"$LOG"; then
        MERGED=$((MERGED + 1))
        log "合并 ${BRANCH} 成功"
      else
        git merge --abort 2>/dev/null
        log "合并 ${BRANCH} 冲突，SKIP"
      fi
      git worktree remove "$wt" 2>/dev/null
    fi
  done
  log "Phase 3: 合并了 ${MERGED}/${#WT_DIRS[@]} 个分支"

  # 最终 commit（如有未提交）
  if git status --porcelain 2>/dev/null | grep -q .; then
    git add -A 2>/dev/null
    git commit -a -m "evolution round ${ROUND}: ${MERGED} agents merged" 2>>"$LOG"
    log "最终 commit 完成"
  fi

  # 每 10 轮打 tag
  if [ $((ROUND % 10)) -eq 0 ]; then
    PATCH=$((ROUND / 10))
    git tag "v0.1.${PATCH}" 2>/dev/null
    log "打 tag v0.1.${PATCH}"
  fi

  # 记录本轮
  log "========== 第 ${ROUND} 轮完成 (阶段=${STAGE}, 合并=${MERGED}/${#WT_DIRS[@]}) =========="

  # 429 熔断
  RECENT_FAILS=0
  TOTAL_TASKS=${#WT_DIRS[@]}
  for i in $(seq 1 "$N"); do
    grep -qE "429|Too Many|timeout waiting" "/tmp/evolution_r${ROUND}_t${i}.log" 2>/dev/null && \
      RECENT_FAILS=$((RECENT_FAILS + 1))
  done
  if [ "$TOTAL_TASKS" -gt 0 ] && [ "$RECENT_FAILS" -eq "$TOTAL_TASKS" ]; then
    log "本轮全部失败/429，暂停 5 分钟"
    sleep 300
  fi

  # 日志裁剪
  if [ -f "$LOG" ] && [ $(wc -l < "$LOG") -gt 1000 ]; then
    tail -1000 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
  fi

  # 每 30 分钟写报告
  NOW=$(date +%s)
  if [ $((NOW - LAST_REPORT)) -ge 1800 ] || [ "$ROUND" -le 1 ]; then
    LAST_REPORT=$NOW
    write_report "$STAGE"
  fi

  # 检查单轮超时（30 min）
  ROUND_ELAPSED=$(( $(date +%s) - ROUND_START ))
  if [ "$ROUND_ELAPSED" -ge 1800 ]; then
    log "单轮超时 30min，强制继续下一轮"
  fi

  sleep 10
done

log "MAIN_LOOP 已退出"
