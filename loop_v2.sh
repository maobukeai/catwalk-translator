#!/bin/bash
# 主控循环：Hermes 通过 terminal(bg=true) 启动本脚本
cd /c/Users/20269/Desktop/项目文件夹/翻译软件
WORKDIR=$(pwd)
STATE_DIR="$WORKDIR/.agent"
LOG="$STATE_DIR/evolution.log"
ROUND=0

mkdir -p "$STATE_DIR"

# === P2: state.json 断点续跑 ===
if [ -f "$STATE_DIR/state.json" ]; then
  SAVED_ROUND=$(grep '"round":' "$STATE_DIR/state.json" 2>/dev/null | head -1 | sed 's/.*"round": *\([0-9]*\).*/\1/')
  SAVED_STAGE=$(grep '"stage":' "$STATE_DIR/state.json" 2>/dev/null | head -1 | sed 's/.*"stage": *"\([^"]*\)".*/\1/')
  [ -n "$SAVED_ROUND" ] && ROUND=$SAVED_ROUND
  [ -n "$SAVED_STAGE" ] && { STAGE="$SAVED_STAGE"; LAST_SAVED_STAGE="$STAGE"; }
  echo "[$(date)] MAIN_LOOP: P2 断点续跑 — 恢复 ROUND=${ROUND}, STAGE=${STAGE}" >> "$LOG"
fi

# === P0: 按 task index 独立追踪的哈希数组 ===
declare -A LAST_DIFF_HASH
declare -A LAST_ERROR_HASH
declare -A STALL_COUNT

while true; do
  if grep -q "STOP_REQUESTED=true" "$LOG" 2>/dev/null; then
    echo "[$(date)] STOP_REQUESTED 已检测，主控循环退出" >> "$LOG"
    break
  fi

  ROUND=$((ROUND + 1))
  ROUND_START_TIME=$(date +%s)
  echo "[$(date)] MAIN_LOOP: ========== 第 ${ROUND} 轮开始 ==========" >> "$LOG"

  STAGE="01/09 UI/UX"
  if [ -f "$STATE_DIR/backlog.md" ]; then
    STAGE=$(grep "^- Stage:" "$STATE_DIR/backlog.md" | head -1 | cut -d' ' -f3- || echo "$STAGE")
  fi

  echo "{ \"round\": ${ROUND}, \"stage\": \"${STAGE}\", \"phase\": \"Phase 0\", \"status\": \"RUNNING\" }" > "$STATE_DIR/state.json"

  RESEARCH_PROMPT="Product Evolution Mode 第 ${ROUND} 轮，当前轮盘阶段：${STAGE}。你的角色是【研究 Agent】，只研究、不写代码。读取 /.agent/ 全部文件，联网搜索，阅读代码，输出方案到 /.agent/research.md。完成后只输出 DONE。"

  agy -p "$RESEARCH_PROMPT" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 8m > /tmp/evolution_round${ROUND}_research.log 2>&1

  RESEARCH="$STATE_DIR/research.md"
  if [ ! -f "$RESEARCH" ]; then
    echo "[$(date)] MAIN_LOOP: research.md 未生成，降级进入规划" >> "$LOG"
  fi

  PLANNER_PROMPT="Product Evolution Mode 第 ${ROUND} 轮任务规划。当前轮盘阶段：${STAGE}。你的角色是【规划 Agent】，只拆任务。读取 /.agent/research.md 和 backlog.md，拆解为 N 个并行子任务（N>=2，文件不重叠），写入 /.agent/tasks.md。完成后只输出 DONE。"

  agy -p "$PLANNER_PROMPT" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 5m

  TASKS="$STATE_DIR/tasks.md"
  if [ ! -f "$TASKS" ]; then
    echo "[$(date)] MAIN_LOOP: tasks.md 未生成，本轮跳过" >> "$LOG"
    sleep 30
    continue
  fi

  N=$(grep "^N:" "$TASKS" | head -1 | awk '{print $2}')
  N=${N:-2}
  [ "$N" -lt 2 ] 2>/dev/null && N=2

  PIDS=()
  WORKTREES=()
  BRANCHES=()

  for i in $(seq 1 "$N"); do
    TASK_NAME=$(sed -n "/^## Task ${i}$/,/^## Task /p" "$TASKS" | grep "^name:" | head -1 | cut -d' ' -f2-)
    TASK_PROMPT=$(sed -n "/^## Task ${i}$/,/^## Task /p" "$TASKS" | grep "^prompt:" | head -1 | cut -d' ' -f2-)
    BRANCH="feature/r${ROUND}-t${i}-${TASK_NAME}"
    WT_DIR=".worktrees/t${i}"
    git worktree add "$WT_DIR" "$BRANCH" 2>/dev/null || git worktree add "$WT_DIR" "main" -b "$BRANCH" 2>/dev/null
    WORKTREES+=("$WT_DIR")
    BRANCHES+=("$BRANCH")
    (
      cd "$WT_DIR"
      agy -p "${TASK_PROMPT} 当前工作目录：$(pwd)（独立 git worktree，分支 ${BRANCH}）。你的角色是【开发 Agent】。执行任务，通过十道检查门，git commit，完成后只输出 DONE。" \
        --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 15m
    ) > "/tmp/evolution_round${ROUND}_task${i}.log" 2>&1 &
    PIDS+=($!)
  done

  echo "[$(date)] MAIN_LOOP: 并行启动 ${N} 个 agent，PIDs: ${PIDS[*]}" >> "$LOG"
  wait "${PIDS[@]}"

  # === Phase 2.5 — P1: 共享 1 个 Reviewer Agent ===
  REVIEW_INPUT=""
  for i in $(seq 1 "$N"); do
    BRANCH="${BRANCHES[$((i-1))]}"
    WT_DIR="${WORKTREES[$((i-1))]}"
    TASK_NAME=$(sed -n "/^## Task ${i}$/,/^## Task /p" "$TASKS" | grep "^name:" | head -1 | cut -d' ' -f2-)
    REVIEW_INPUT="${REVIEW_INPUT}
=== 分支 t${i}: ${BRANCH} (任务: ${TASK_NAME}) ===
WORKTREE: ${WT_DIR}
DIFF:
$(git -C "$WT_DIR" diff main --stat 2>/dev/null)
LOG_TAIL:
$(tail -n 30 "/tmp/evolution_round${ROUND}_task${i}.log" 2>/dev/null)
"
  done

  REVIEWER_PROMPT="你是【独立 Reviewer Gatekeeper】。审查以下 ${N} 个并行开发分支是否达到交付标准。
规则：检查每个分支 diff 是否非空且合理，日志是否显示通过检查门。
对每个分支输出一行：
REVIEW_RESULT t1: APPROVED
REVIEW_RESULT t2: REJECTED: <原因>

分支信息：
${REVIEW_INPUT}

只输出 N 行 REVIEW_RESULT，完成后输出 DONE。"

  REVIEW_OUT="/tmp/evolution_round${ROUND}_review.log"
  agy -p "$REVIEWER_PROMPT" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 8m > "$REVIEW_OUT" 2>&1

  unset REVIEW_DECISION
  declare -A REVIEW_DECISION
  for i in $(seq 1 "$N"); do
    LINE=$(grep "REVIEW_RESULT t${i}:" "$REVIEW_OUT" 2>/dev/null | head -1)
    if echo "$LINE" | grep -q "APPROVED"; then
      REVIEW_DECISION[$i]="APPROVED"
      echo "[$(date)] MAIN_LOOP: P1 Reviewer 签署 t${i} [APPROVED]" >> "$LOG"
    else
      REVIEW_DECISION[$i]="REJECTED"
      REASON="${LINE:-Reviewer 未输出该分支结论}"
      echo "[$(date)] MAIN_LOOP: P1 Reviewer 驳回 t${i} [REJECTED] 原因: ${REASON}" >> "$LOG"
    fi
  done

  # === Phase 2.8 — P1: 共享 1 个 QA Agent（真人点击 + 视觉 + 回归测试） ===
  QA_TARGETS=""
  QA_BRANCHES=""
  for i in $(seq 1 "$N"); do
    if [ "${REVIEW_DECISION[$i]}" = "APPROVED" ]; then
      QA_TARGETS="${QA_TARGETS}
=== 待测分支 t${i}: ${BRANCHES[$((i-1))]} ===
WORKTREE: ${WORKTREES[$((i-1))]}
TASK: $(sed -n "/^## Task ${i}$/,/^## Task /p" "$TASKS" | grep "^name:" | head -1 | cut -d' ' -f2-)
DIFF_STAT: $(git -C "${WORKTREES[$((i-1))]}" diff main --stat 2>/dev/null)
"
      QA_BRANCHES="${QA_BRANCHES} t${i}"
    fi
  done

  if [ -n "$QA_TARGETS" ]; then
    QA_PROMPT="你是【独立 QA 智能体】。以下分支已通过 Reviewer 审查，现在需要你进行独立的质量验证。

你的职责：
1. 进入每个分支的 worktree
2. 运行 cargo build / cargo test / cargo clippy
3. 若 app 可启动，用 cua-driver 模拟真人操作（划词 → 翻译 → 复制），截图核查 UI
4. 检查控制台/devtools 有无新增 Error
5. 验证核心功能无回归（对比改动前后的行为）

输出格式（每个分支一行）：
QA_RESULT t1: PASS
QA_RESULT t2: FAIL: <原因>

测试目标：
${QA_TARGETS}

只输出 QA_RESULT 行，完成后输出 DONE。"

    QA_OUT="/tmp/evolution_round${ROUND}_qa.log"
    agy -p "$QA_PROMPT" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 12m > "$QA_OUT" 2>&1

    unset QA_DECISION
    declare -A QA_DECISION
    for i in $(seq 1 "$N"); do
      if [ "${REVIEW_DECISION[$i]}" = "APPROVED" ]; then
        LINE=$(grep "QA_RESULT t${i}:" "$QA_OUT" 2>/dev/null | head -1)
        if echo "$LINE" | grep -q "PASS"; then
          QA_DECISION[$i]="PASS"
          echo "[$(date)] MAIN_LOOP: P1 QA 通过 t${i}" >> "$LOG"
        else
          QA_DECISION[$i]="FAIL"
          REASON="${LINE:-QA 未输出该分支结论}"
          echo "[$(date)] MAIN_LOOP: P1 QA 未通过 t${i} 原因: ${REASON}" >> "$LOG"
        fi
      fi
    done
  fi

  # === P0: Stall Detection — 按 task index 独立追踪 ===
  unset STALLED_THIS_ROUND
  declare -A STALLED_THIS_ROUND
  for i in $(seq 1 "$N"); do
    BRANCH="${BRANCHES[$((i-1))]}"
    WT_DIR="${WORKTREES[$((i-1))]}"
    CURRENT_DIFF_HASH=$(git -C "$WT_DIR" diff main 2>/dev/null | sha256sum | cut -d' ' -f1)
    CURRENT_ERROR_HASH=$(grep -i "error\|fail\|warn" "/tmp/evolution_round${ROUND}_task${i}.log" 2>/dev/null | tail -n 20 | sha256sum | cut -d' ' -f1)

    if [ -n "${LAST_DIFF_HASH[$i]:-}" ] && [ "$CURRENT_DIFF_HASH" = "${LAST_DIFF_HASH[$i]}" ] && [ "$CURRENT_ERROR_HASH" = "${LAST_ERROR_HASH[$i]}" ] && [ "$CURRENT_DIFF_HASH" != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]; then
      STALL_COUNT[$i]=$(( ${STALL_COUNT[$i]:-0} + 1 ))
    else
      STALL_COUNT[$i]=0
    fi
    LAST_DIFF_HASH[$i]="$CURRENT_DIFF_HASH"
    LAST_ERROR_HASH[$i]="$CURRENT_ERROR_HASH"

    if [ "${STALL_COUNT[$i]}" -ge 3 ]; then
      STALLED_THIS_ROUND[$i]=1
      echo "[$(date)] MAIN_LOOP: P0 STALLED! t${i} (${BRANCH}) 连续 3 轮哈希一致，停滞熔断" >> "$LOG"
    fi
  done

  # === Phase 3 — 仅合并 APPROVED 且 QA PASS 且非 STALLED ===
  MERGED_COUNT=0
  # 保存 WORKDIR（worktree 循环可能改变 cwd）
  _SAVE_WD="$WORKDIR"
  cd "$WORKDIR"
  for i in $(seq 1 "$N"); do
    WT_DIR="${WORKTREES[$((i-1))]}"
    BRANCH="${BRANCHES[$((i-1))]}"
    DECISION="${REVIEW_DECISION[$i]}"
    STALLED="${STALLED_THIS_ROUND[$i]:-0}"

    if [ "$DECISION" = "APPROVED" ] && [ "${QA_DECISION[$i]:-PASS}" = "PASS" ] && [ "$STALLED" != "1" ]; then
      echo "[$(date)] MAIN_LOOP: 合并分支 ${BRANCH}" >> "$LOG"
      if ! git merge "$BRANCH" --no-ff -m "merge: ${BRANCH}" 2>/dev/null; then
        git merge --abort 2>/dev/null
        agy -p "分支 main 与 ${BRANCH} 合并冲突，请用 merge-reconciler 解决。" \
          --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 5m
      fi
      MERGED_COUNT=$((MERGED_COUNT + 1))
    else
      echo "[$(date)] MAIN_LOOP: 分支 ${BRANCH} ${DECISION}/STALLED，跳过合并" >> "$LOG"
    fi
    git worktree remove "$WT_DIR" 2>/dev/null
  done

  git status --porcelain 2>/dev/null | grep -q . && \
    git commit -a -m "evolution round ${ROUND}: ${N} agents merged, ${MERGED_COUNT} approved" 2>/dev/null

  # === P2: state.json 写入（本轮结束） ===
  STALLED_TASKS_JSON="["
  FIRST=true
  for i in $(seq 1 "$N"); do
    if [ "${STALLED_THIS_ROUND[$i]:-0}" = "1" ]; then
      if [ "$FIRST" = "true" ]; then FIRST=false; else STALLED_TASKS_JSON="${STALLED_TASKS_JSON},"; fi
      STALLED_TASKS_JSON="${STALLED_TASKS_JSON}\"${BRANCHES[$((i-1))]}\""
    fi
  done
  STALLED_TASKS_JSON="${STALLED_TASKS_JSON}]"
  echo "{ \"round\": ${ROUND}, \"stage\": \"${STAGE}\", \"phase\": \"Completed\", \"status\": \"IDLE\", \"stalled_tasks\": ${STALLED_TASKS_JSON} }" > "$STATE_DIR/state.json"

  # === P3: ledger.json 任务指标双记录（安全 JSON 追加） ===
  ROUND_END_TIME=$(date +%s)
  DURATION=$((ROUND_END_TIME - ROUND_START_TIME))
  DIFF_STAT=$(git diff HEAD~1 --shortstat 2>/dev/null || echo "0 files changed")
  DIFF_STAT_ESC=$(echo "$DIFF_STAT" | sed 's/\\/\\\\/g; s/"/\\"/g')
  TS=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
  RECORD="{\"round\":${ROUND},\"stage\":\"${STAGE}\",\"duration_sec\":${DURATION},\"tasks\":${N},\"merged\":${MERGED_COUNT},\"diff_stat\":\"${DIFF_STAT_ESC}\",\"timestamp\":\"${TS}\"}"
  # 检测 Python（兼容 python / python3）
  PY="python3"
  command -v python3 >/dev/null 2>&1 || PY="python"

  if [ -f "$STATE_DIR/ledger.json" ]; then
    $PY -c "import json,sys; p=sys.argv[1]; d=json.load(open(p)); d.append(json.loads(sys.argv[2])); open(p,'w').write(json.dumps(d))" "$STATE_DIR/ledger.json" "$RECORD"
  else
    echo "[${RECORD}]" > "$STATE_DIR/ledger.json"
  fi

  echo "[$(date)] MAIN_LOOP: 第 ${ROUND} 轮完成，${N} 个 agent，合并 ${MERGED_COUNT}/${N}，耗时 ${DURATION}s" >> "$LOG"

  # === 对话压缩：stdout 只输出一行摘要，其余全部进文件 ===
  # 主会话通过 process poll 只看到这一行，避免上下文膨胀
  echo "ROUND ${ROUND} DONE: ${N} agents, ${MERGED_COUNT} merged, ${DURATION}s"

  RECENT_FAILS=0
  for i in $(seq 1 "$N"); do
    grep -q "429\|Too Many" "/tmp/evolution_round${ROUND}_task${i}.log" 2>/dev/null && RECENT_FAILS=$((RECENT_FAILS+1))
  done
  if [ "$RECENT_FAILS" -eq "$N" ]; then
    echo "ROUND ${ROUND} WARN: all 429, sleeping 1800s"
    sleep 1800
  fi

  sleep 10
done
