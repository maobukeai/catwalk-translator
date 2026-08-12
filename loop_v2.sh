#!/bin/bash
# loop_v3.sh — Product Evolution 主控循环（修复版）
# 修复内容：
#   1. 每次 agy 执行结果 → 微信推送（成功/失败/额度耗尽全量转发）
#   2. 额度耗尽 → 自动切号（通过 trigger 文件 + cron 桥接）
#   3. 每轮完成后 → 微信推送详细报告
#   4. notify_stage 阶段推送
cd /c/Users/20269/Desktop/项目文件夹/翻译软件
WORKDIR=$(pwd)
STATE_DIR="$WORKDIR/.agent"
LOG="$STATE_DIR/evolution.log"
TRIGGER="$STATE_DIR/.quota_switch"
ROUND=0

mkdir -p "$STATE_DIR"

# === 工具函数 ===
notify() {
  echo "🔄 Loop${ROUND}: $1" | hermes send --to weixin -l 2>/dev/null
}

agy_run() {
  # 包装 agy：执行后检查结果 + 推送微信
  local label="$1"
  shift
  local outfile="$1"
  shift

  "$@" > "$outfile" 2>&1

  local status error_json response_len
  status=$(grep -o '"status":"[A-Z]*"' "$outfile" 2>/dev/null | head -1 | cut -d'"' -f4)
  error_json=$(grep -o '"error":"[^"]*"' "$outfile" 2>/dev/null | head -1 | cut -d'"' -f4)
  response_len=$(grep -o '"response":"' "$outfile" 2>/dev/null | wc -l)

  case "${status:-UNKNOWN}" in
    SUCCESS)
      if [ "$response_len" -gt 0 ]; then
        echo "[$(date)] ${label}: SUCCESS" >> "$LOG"
        notify "✅ ${label} SUCCESS"
      else
        echo "[$(date)] ${label}: SUCCESS 但无输出（后端超时）" >> "$LOG"
        notify "⚠️ ${label}: 成功但无输出（后端超时）"
      fi
      ;;
    ERROR)
      local quota_hint=""
      if echo "$error_json" | grep -qi "quota\|Individual quota reached\|429"; then
        quota_hint="（额度耗尽）"
        touch "$TRIGGER"
        echo "[$(date)] ${label}: QUOTA EXHAUSTED${quota_hint}，已触发自动切号" >> "$LOG"
        notify "🚨 ${label}: 额度耗尽！自动切号中..."
      else
        echo "[$(date)] ${label}: ERROR — ${error_json}" >> "$LOG"
        notify "❌ ${label}: ${error_json:0:120}"
      fi
      ;;
    *)
      echo "[$(date)] ${label}: status=${status:-MISSING}" >> "$LOG"
      notify "⚠️ ${label}: 状态异常 (${status:-未识别})"
      ;;
  esac
}

# === P2: 断点续跑 ===
if [ -f "$STATE_DIR/state.json" ]; then
  SAVED_ROUND=$(grep '"round":' "$STATE_DIR/state.json" 2>/dev/null | head -1 | sed 's/.*"round": *\([0-9]*\).*/\1/')
  SAVED_STAGE=$(grep '"stage":' "$STATE_DIR/state.json" 2>/dev/null | head -1 | sed 's/.*"stage": *" *\(["]*[^[^"]*\)/\1/' | tr -d '" ')
  [ -n "$SAVED_ROUND" ] && ROUND=$SAVED_ROUND
  [ -n "$SAVED_STAGE" ] && { STAGE="$SAVED_STAGE"; LAST_SAVED_STAGE="$STAGE"; }
  echo "[$(date)] MAIN_LOOP: P2 恢复 ROUND=${ROUND}" >> "$LOG"
fi

declare -A LAST_DIFF_HASH
declare -A LAST_ERROR_HASH
declare -A STALL_COUNT

while true; do
  if grep -q "STOP_REQUESTED=true" "$LOG" 2>/dev/null; then
    echo "[$(date)] STOP_REQUESTED 退出" >> "$LOG"
    break
  fi

  # 检查切号 trigger
  if [ -f "$TRIGGER" ]; then
    WAIT_TIME=0
    while [ -f "$TRIGGER" ] && [ "$WAIT_TIME" -lt 300 ]; do
      sleep 10
      WAIT_TIME=$((WAIT_TIME + 10))
    done
    notify "🔄 已等待切号完成，继续运行"
  fi

  ROUND=$((ROUND + 1))
  ROUND_START_TIME=$(date +%s)
  echo "[$(date)] MAIN_LOOP: 第 ${ROUND} 轮开始" >> "$LOG"

  STAGE="01/09 UI/UX"
  [ -f "$STATE_DIR/backlog.md" ] && STAGE=$(grep "^- Stage:" "$STATE_DIR/backlog.md" | head -1 | cut -d' ' -f3-)

  echo "{\"round\":${ROUND},\"stage\":\"${STAGE}\",\"phase\":\"P0\",\"status\":\"RUNNING\"}" > "$STATE_DIR/state.json"

  # Phase 0: Research
  agy_run "Phase0-Research" /tmp/ev_r${ROUND}_research.log agy -p "Product Evolution R${ROUND}，阶段：${STAGE}。你是【研究Agent】，只研究不写代码。读 /.agent/ 全部文件，联网搜索，读代码，输出方案到 /.agent/research.md。完成后只输出 DONE。" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 8m
  notify "📖 第${ROUND}轮 Phase0 研究完成"

  # Phase 1: Planner
  agy_run "Phase1-Planner" /tmp/ev_r${ROUND}_planner.log agy -p "Product Evolution R${ROUND}。你是【规划Agent】，只拆任务。读 /.agent/research.md 和 backlog.md，拆 N≥2 个并行任务，写 /.agent/tasks.md。完成后只输出 DONE。" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 5m
  notify "📋 第${ROUND}轮 Phase1 规划完成"

  TASKS="$STATE_DIR/tasks.md"
  [ ! -f "$TASKS" ] && { notify "⚠️ 第${ROUND}轮 tasks.md 缺失，跳过"; sleep 30; continue; }

  N=$(grep "^N:" "$TASKS" | head -1 | awk '{print $2}')
  N=${N:-2}; [ "$N" -lt 2 ] 2>/dev/null && N=2

  PIDS=(); WORKTREES=(); BRANCHES=()
  for i in $(seq 1 "$N"); do
    TASK_NAME=$(sed -n "/^## Task ${i}$/,/^## Task /p" "$TASKS" | grep "^name:" | head -1 | cut -d' ' -f2-)
    TASK_PROMPT=$(sed -n "/^## Task ${i}$/,/^## Task /p" "$TASKS" | grep "^prompt:" | head -1 | cut -d' ' -f2-)
    BRANCH="feature/r${ROUND}-t${i}-${TASK_NAME}"
    WT_DIR=".worktrees/t${i}"
    git worktree add "$WT_DIR" "$BRANCH" 2>/dev/null || git worktree add "$WT_DIR" "main" -b "$BRANCH" 2>/dev/null
    WORKTREES+=("$WT_DIR"); BRANCHES+=("$BRANCH")
    (
      cd "$WT_DIR" || exit 1
      agy -p "${TASK_PROMPT} 当前工作目录：$(pwd)（独立git worktree，分支${BRANCH}）。你是【开发Agent】。执行任务，过十道检查门，git commit，完成后只输出DONE。" \
        --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 15m
    ) > "/tmp/ev_r${ROUND}_t${i}.log" 2>&1 &
    PIDS+=($!)
  done
  echo "[$(date)] MAIN_LOOP: 启动${N}个Dev Agent PIDs: ${PIDS[*]}" >> "$LOG"
  wait "${PIDS[@]}"

  # 汇总 Dev Agent 结果
  for i in $(seq 1 "$N"); do
    local_out="/tmp/ev_r${ROUND}_t${i}.log"
    st=$(grep -o '"status":"[A-Z]*"' "$local_out" 2>/dev/null | head -1 | cut -d'"' -f4)
    err=$(grep -o '"error":"[^"]*"' "$local_out" 2>/dev/null | head -1 | cut -d'"' -f4)
    quota_hit=0
    echo "$err" | grep -qi "quota\|Individual quota\|429" && quota_hit=1
    if [ "$quota_hit" -eq 1 ]; then
      touch "$TRIGGER"
      notify "🚨 t${i}: 额度耗尽，自动切号中"
    elif [ "$st" = "SUCCESS" ]; then
      notify "✅ t${i} (${BRANCHES[$((i-1))]}) SUCCESS"
    else
      notify "❌ t${i}: ${err:0:120}"
    fi
  done
  notify "👷 第${ROUND}轮 Phase2 开发完成（${N}个分支）"

  # Phase 2.5: Reviewer
  REVIEW_INPUT=""
  for i in $(seq 1 "$N"); do
    BRANCH="${BRANCHES[$((i-1))]}"; WT_DIR="${WORKTREES[$((i-1))]}"
    TASK_NAME=$(sed -n "/^## Task ${i}$/,/^## Task /p" "$TASKS" | grep "^name:" | head -1 | cut -d' ' -f2-)
    REVIEW_INPUT="${REVIEW_INPUT}
=== t${i}: ${BRANCH} (${TASK_NAME}) ===
DIFF:$(git -C "$WT_DIR" diff main --stat 2>/dev/null)
LOG:$(tail -20 "/tmp/ev_r${ROUND}_t${i}.log" 2>/dev/null)
"
  done
  agy_run "Reviewer" /tmp/ev_r${ROUND}_review.log agy -p "你是【独立Reviewer Gatekeeper】。审查以下${N}个分支。每分支输出一行：REVIEW_RESULT t1: APPROVED 或 REJECTED: <原因>。
${REVIEW_INPUT}
只输出REVIEW_RESULT行，完成后输出DONE。" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 8m
  notify "🔍 第${ROUND}轮 Reviewer 审查完成"

  unset REVIEW_DECISION; declare -A REVIEW_DECISION
  for i in $(seq 1 "$N"); do
    LINE=$(grep "REVIEW_RESULT t${i}:" /tmp/ev_r${ROUND}_review.log 2>/dev/null | head -1)
    if echo "$LINE" | grep -q "APPROVED"; then
      REVIEW_DECISION[$i]="APPROVED"
    else
      REVIEW_DECISION[$i]="REJECTED"
      notify "❌ Reviewer 驳回 t${i}: ${LINE:0:80}"
    fi
  done

  # Phase 2.8: QA
  QA_TARGETS=""
  for i in $(seq 1 "$N"); do
    [ "${REVIEW_DECISION[$i]}" != "APPROVED" ] && continue
    QA_TARGETS="${QA_TARGETS}
=== t${i}: ${BRANCHES[$((i-1))]} ===
WORKTREE: ${WORKTREES[$((i-1))]}
DIFF:$(git -C "${WORKTREES[$((i-1))]}" diff main --stat 2>/dev/null)
"
  done
  unset QA_DECISION; declare -A QA_DECISION
  if [ -n "$QA_TARGETS" ]; then
    agy_run "QA" /tmp/ev_r${ROUND}_qa.log agy -p "你是【独立QA智能体】。对通过Reviewer的分支进行质量验证：
1. 进入每个worktree，运行cargo build/cargo test/cargo clippy
2. 用cua-driver模拟真人操作（划词→翻译→复制），截图核查UI
3. 检查console有无Error
4. 验证核心功能无回归
输出格式：QA_RESULT t1: PASS 或 FAIL: <原因>
${QA_TARGETS}
只输出QA_RESULT行，完成后输出DONE。" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 12m
    notify "🧪 第${ROUND}轮 QA 测试完成"
    for i in $(seq 1 "$N"); do
      [ "${REVIEW_DECISION[$i]}" != "APPROVED" ] && continue
      LINE=$(grep "QA_RESULT t${i}:" /tmp/ev_r${ROUND}_qa.log 2>/dev/null | head -1)
      if echo "$LINE" | grep -q "PASS"; then
        QA_DECISION[$i]="PASS"
      else
        QA_DECISION[$i]="FAIL"
        notify "❌ QA 未通过 t${i}: ${LINE:0:80}"
      fi
    done
  fi

  # P0: Stall Detection
  unset STALLED_THIS_ROUND; declare -A STALLED_THIS_ROUND
  for i in $(seq 1 "$N"); do
    WT_DIR="${WORKTREES[$((i-1))]}"
    CH=$(git -C "$WT_DIR" diff main 2>/dev/null | sha256sum | cut -d' ' -f1)
    EH=$(grep -i "error\|fail" "/tmp/ev_r${ROUND}_t${i}.log" 2>/dev/null | tail -20 | sha256sum | cut -d' ' -f1)
    if [ -n "${LAST_DIFF_HASH[$i]:-}" ] && [ "$CH" = "${LAST_DIFF_HASH[$i]}" ] && [ "$EH" = "${LAST_ERROR_HASH[$i]}" ] && [ "$CH" != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]; then
      STALL_COUNT[$i]=$(( ${STALL_COUNT[$i]:-0} + 1 ))
    else
      STALL_COUNT[$i]=0
    fi
    LAST_DIFF_HASH[$i]="$CH"; LAST_ERROR_HASH[$i]="$EH"
    [ "${STALL_COUNT[$i]}" -ge 3 ] && { STALLED_THIS_ROUND[$i]=1; notify "⚠️ STALLED: t${i}"; }
  done

  # Phase 3: 合并
  MERGED_COUNT=0
  _SAVE_WD="$WORKDIR"; cd "$WORKDIR"
  for i in $(seq 1 "$N"); do
    BRANCH="${BRANCHES[$((i-1))]}"; DECISION="${REVIEW_DECISION[$i]}"; STALLED="${STALLED_THIS_ROUND[$i]:-0}"
    if [ "$DECISION" = "APPROVED" ] && [ "${QA_DECISION[$i]:-PASS}" = "PASS" ] && [ "$STALLED" != "1" ]; then
      git merge "$BRANCH" --no-ff -m "merge: ${BRANCH}" 2>/dev/null && MERGED_COUNT=$((MERGED_COUNT+1))
    else
      echo "[$(date)] ${BRANCH} ${DECISION}/STALLED 跳过" >> "$LOG"
    fi
    git worktree remove "${WORKTREES[$((i-1))]}" 2>/dev/null
  done
  git status --porcelain 2>/dev/null | grep -q . && git commit -a -m "evolution R${ROUND}: ${N}agents, ${MERGED_COUNT}merged" 2>/dev/null

  DURATION=$(( $(date +%s) - ROUND_START_TIME ))

  # P2: state.json
  STALLED_JSON="["
  FIRST=true
  for i in $(seq 1 "$N"); do
    [ "${STALLED_THIS_ROUND[$i]:-0}" = "1" ] && { [ "$FIRST" = "true" ] && FIRST=false || STALLED_JSON="${STALLED_JSON},"; STALLED_JSON="${STALLED_JSON}\"${BRANCHES[$((i-1))]}\""; }
  done
  STALLED_JSON="${STALLED_JSON}]"
  echo "{\"round\":${ROUND},\"stage\":\"${STAGE}\",\"phase\":\"Done\",\"status\":\"IDLE\",\"stalled\":${STALLED_JSON}}" > "$STATE_DIR/state.json"

  # 详细轮报告
  ROUND_REPORT="第${ROUND}轮报告：
🎯 阶段: ${STAGE}
📋 任务数: ${N}
✅ 合并: ${MERGED_COUNT}/${N}
⏱ 耗时: ${DURATION}s
📝 研究: $(tail -3 "$STATE_DIR/research.md" 2>/dev/null | tr '\n' ' ' | head -c 200)
🔍 Review: $(grep -c APPROVED /tmp/ev_r${ROUND}_review.log 2>/dev/null || echo 0)/${N} approved
🧪 QA: $(grep -c PASS /tmp/ev_r${ROUND}_qa.log 2>/dev/null || echo 0)/${N} passed"
  echo "[$(date)] $ROUND_REPORT" >> "$LOG"
  notify "$ROUND_REPORT"

  # 配额检查
  QUOTA_COUNT=0
  for i in $(seq 1 "$N"); do
    grep -qi "quota\|Individual quota\|429" "/tmp/ev_r${ROUND}_t${i}.log" 2>/dev/null && QUOTA_COUNT=$((QUOTA_COUNT+1))
    grep -qi "quota\|Individual quota\|429" /tmp/ev_r${ROUND}_research.log 2>/dev/null && QUOTA_COUNT=$((QUOTA_COUNT+1))
    grep -qi "quota\|Individual quota\|429" /tmp/ev_r${ROUND}_planner.log 2>/dev/null && QUOTA_COUNT=$((QUOTA_COUNT+1))
  done
  if [ "$QUOTA_COUNT" -ge "$N" ]; then
    touch "$TRIGGER"
    notify "🚨 本轮全部额度耗尽，等待自动切号恢复"
  fi

  sleep 10
done