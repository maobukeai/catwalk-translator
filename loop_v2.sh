#!/bin/bash
# loop_v3.sh — Product Evolution 主控循环 v3.2（全面修复版）
# 修复内容：
#   1. Bug#1 Stage空转 → 从backlog.md In Progress标题解析阶段
#   2. Bug#2 Reviewer全驳回 → 宽松关键词匹配（不要求严格格式）
#   3. Bug#3 冲突标记 → 已清除
#   4. Bug#4 额度耗尽不停 → 立即停，等切号cron处理后恢复
#   5. 改进#1 Reviewer输出 → 自由文本+关键词匹配
#   6. 改进#2 阶段推进 → backlog.md加-In Progress标记+自动推进
cd /c/Users/20269/Desktop/项目文件夹/翻译软件
WORKDIR=$(pwd)
STATE_DIR="$WORKDIR/.agent"
CONFIG="$STATE_DIR/project.json"

# 从 project.json 读取配置（单一配置源）
if [ -f "$CONFIG" ]; then
  LOG=$(grep '"log_file"' "$CONFIG" | sed 's/.*"\([^"]*\)"/\1/')
  TRIGGER=$(grep '"quota_trigger"' "$CONFIG" | sed 's/.*"\([^"]*\)"/\1/')
fi
LOG="${LOG:-$STATE_DIR/evolution.log}"
TRIGGER="${TRIGGER:-$STATE_DIR/.quota_switch}"
ROUND=0

mkdir -p "$STATE_DIR"

# 启动时自动校验 + 修复 cron（保证 cron 就绪）
if [ -f "$STATE_DIR/verify-cron.py" ]; then
  python "$STATE_DIR/verify-cron.py" >> "$LOG" 2>&1
fi

# === 工具函数 ===
notify() {
  echo "🔄 Loop${ROUND}: $1" | hermes send --to weixin 2>/dev/null
}

# 解析阶段：从backlog.md的 "## N. In Progress" 标题提取
get_stage() {
  local bl="$STATE_DIR/backlog.md"
  local s=""
  if [ -f "$bl" ]; then
    s=$(grep "In Progress" "$bl" | head -1 | sed 's/.*In Progress .*- //' | sed 's/).*//' | xargs)
    [ -n "$s" ] && { echo "$s"; return; }
    s=$(grep "^- Stage:" "$bl" | head -1 | cut -d' ' -f3-)
    [ -n "$s" ] && { echo "$s"; return; }
    s=$(grep -o "Stage [0-9][0-9][^)]*" "$bl" | head -1)
    [ -n "$s" ] && { echo "$s"; return; }
  fi
  echo "01/09 UI/UX"
}

# Dynamic Priority Wheel：用 priority-engine.py 动态计算优先级
# 旧 get_stage 保留为 fallback（coverage mechanism）
get_dynamic_stage() {
  local engine="$STATE_DIR/priority-engine.py"
  local domain="${DOMAIN:-translation}"

  if [ ! -f "$engine" ]; then
    notify "⚠️ priority-engine.py 不存在，回退到 backlog Stage"
    get_stage
    return
  fi

  # 用 priority-engine.py 计算推荐阶段
  local result
  result=$(python "$engine" recommend "$STATE_DIR" "$domain" 2>&1)
  local recommended
  recommended=$(echo "$result" | grep -o "推荐下一阶段: [^ ]*" | head -1 | sed 's/推荐下一阶段: //')
  if [ -n "$recommended" ]; then
    echo "$recommended"
  else
    notify "⚠️ priority-engine 计算失败，回退到 backlog Stage"
    get_stage
  fi
}

# 写触发切号文件 + 立即停止，等切号完成后才恢复
quota_trigger() {
  touch "$TRIGGER"
  echo "[$(date)] QUOTA: 额度耗尽，已触发切号，立即暂停" >> "$LOG"
  notify "🚨 额度耗尽！已暂停，等待自动切号恢复..."
}

# 等切号完成（轮询 trigger 文件被删除）
wait_quota_restore() {
  local waited=0
  while [ -f "$TRIGGER" ] && [ "$waited" -lt 900 ]; do
    sleep 15
    waited=$((waited + 15))
    if [ $((waited % 60)) -eq 0 ]; then
      notify "⏳ 已等待 ${waited}s，切号中..."
    fi
  done
  notify "🔄 切号已恢复（等待${waited}s），继续运行"
}

# 包装agy：执行+检查+推送+额度触发
agy_run() {
  local label="$1"; shift
  local outfile="$1"; shift

  "$@" > "$outfile" 2>&1

  local status error_json response_len
  status=$(grep -o '"status":"[A-Z]*"' "$outfile" 2>/dev/null | head -1 | cut -d'"' -f4)
  error_json=$(grep -o '"error":"[^"]*"' "$outfile" 2>/dev/null | head -1 | cut -d'"' -f4)
  response_len=$(grep -o '"response":"' "$outfile" 2>/dev/null | wc -l)

  # 检查是否额度耗尽（先检查error再检查status）
  if echo "$error_json" | grep -qi "quota\|Individual quota reached\|429"; then
    quota_trigger
    return 1
  fi

  case "${status:-UNKNOWN}" in
    SUCCESS)
      [ "$response_len" -gt 0 ] && {
        echo "[$(date)] ${label}: SUCCESS" >> "$LOG"
        notify "✅ ${label} SUCCESS"
      } || {
        echo "[$(date)] ${label}: SUCCESS 但无输出（后端超时）" >> "$LOG"
        notify "⚠️ ${label}: 成功但无输出（后端超时）"
      }
      ;;
    ERROR)
      echo "[$(date)] ${label}: ERROR — ${error_json}" >> "$LOG"
      notify "❌ ${label}: ${error_json:0:120}"
      ;;
    *)
      echo "[$(date)] ${label}: status=${status:-MISSING}" >> "$LOG"
      notify "⚠️ ${label}: 状态异常 (${status:-未识别})"
      ;;
  esac
  # ERROR/UNKNOWN 返回 1，让调用方决定跳过本轮；SUCCESS 返回 0
  [ "${status:-UNKNOWN}" = "SUCCESS" ] && return 0 || return 1
}

# Schema Validator：严格解析 Reviewer 输出的 JSON
# 不再用宽松关键词匹配，防止 "APPROVED is not recommended" 被误判
parse_review_decision_json() {
  local task_idx="$1"
  local logfile="$2"
  # 检测 python 可用性
  local PY=python
  command -v python3 >/dev/null 2>&1 && PY=python3
  $PY -c "
import json, sys
try:
    # 从 agy 的 json 输出提取 response 字段
    raw = open(sys.argv[1]).read()
    meta = json.loads(raw)
    resp = meta.get('response', raw)
    # 响应可能包含多行 JSON，尝试每行解析
    for line in resp.strip().split('\n'):
        line = line.strip()
        if not line or line == 'DONE':
            continue
        try:
            obj = json.loads(line)
            if obj.get('task_id') == 't${task_idx}' or obj.get('task_id') == '${task_idx}':
                d = obj.get('decision', '').strip().upper()
                r = obj.get('reason', '无原因')
                if d == 'APPROVED':
                    sys.exit(0)
                elif d == 'REJECTED':
                    sys.stderr.write(f'REJECTED: {r}')
                    sys.exit(1)
                else:
                    sys.stderr.write(f'REJECTED: 无效decision={d}')
                    sys.exit(1)
        except json.JSONDecodeError:
            continue
    sys.stderr.write('REJECTED: Reviewer 未输出该任务的有效JSON')
    sys.exit(1)
except Exception as e:
    sys.stderr.write(f'REJECTED: JSON解析失败 {str(e)[:80]}')
    sys.exit(1)
" "$logfile" 2>&1
}

# === P2: 断点续跑 ===
if [ -f "$STATE_DIR/state.json" ]; then
  SAVED_ROUND=$(grep '"round":' "$STATE_DIR/state.json" 2>/dev/null | head -1 | sed 's/.*"round": *\([0-9]*\).*/\1/')
  SAVED_STAGE=$(grep '"stage":' "$STATE_DIR/state.json" 2>/dev/null | head -1 | sed 's/.*"stage": *"\([^"]*\)".*/\1/')
  [ -n "$SAVED_ROUND" ] && ROUND=$SAVED_ROUND
  [ -n "$SAVED_STAGE" ] && { STAGE="$SAVED_STAGE"; LAST_SAVED_STAGE="$STAGE"; }
  echo "[$(date)] MAIN_LOOP: P2 恢复 ROUND=${ROUND}, STAGE=${STAGE}" >> "$LOG"
fi

declare -A LAST_DIFF_HASH
declare -A LAST_ERROR_HASH
declare -A STALL_COUNT

while true; do
  if grep -q "STOP_REQUESTED=true" "$LOG" 2>/dev/null; then
    echo "[$(date)] STOP_REQUESTED 退出" >> "$LOG"
    break
  fi

  # 检查切号 trigger（上次额度耗尽遗留）
  if [ -f "$TRIGGER" ]; then
    notify "⏳ 检测到遗留切号trigger，等待恢复..."
    wait_quota_restore
  fi

  ROUND=$((ROUND + 1))
  ROUND_START_TIME=$(date +%s)
  echo "[$(date)] MAIN_LOOP: 第 ${ROUND} 轮开始" >> "$LOG"

  # 解析阶段：优先用 Dynamic Priority Wheel，失败才回退到 backlog Stage
  STAGE=$(get_dynamic_stage)
  echo "{\"round\":${ROUND},\"stage\":\"${STAGE}\",\"phase\":\"P0\",\"status\":\"RUNNING\"}" > "$STATE_DIR/state.json"

  # Phase 0: Research
  if ! agy_run "Phase0-Research" /tmp/ev_r${ROUND}_research.log agy -p "Product Evolution R${ROUND}，阶段：${STAGE}。你是【研究Agent】，只研究不写代码。读 /.agent/ 全部文件，联网搜索，读代码，输出方案到 /.agent/research.md。完成后只输出 DONE。" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 8m; then
    wait_quota_restore
    continue
  fi
  notify "📖 第${ROUND}轮 Phase0 研究完成"

  # Phase 1: Planner
  if ! agy_run "Phase1-Planner" /tmp/ev_r${ROUND}_planner.log agy -p "Product Evolution R${ROUND}，阶段：${STAGE}。你是【规划Agent】，只拆任务。读 /.agent/research.md 和 backlog.md，拆 N>=2 个并行任务，每个任务文件名不重叠。输出格式：
N: 5
## Task 1
name: 任务名
prompt: 详细任务描述

## Task 2
name: 任务名
prompt: 详细任务描述
（以此类推）
完成后只输出 DONE。" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 5m; then
    wait_quota_restore
    continue
  fi
  notify "📋 第${ROUND}轮 Phase1 规划完成"

  TASKS="$STATE_DIR/tasks.md"
  [ ! -f "$TASKS" ] && { notify "⚠️ 第${ROUND}轮 tasks.md 缺失，跳过"; sleep 30; continue; }

  N=$(grep "^N:" "$TASKS" | head -1 | awk '{print $2}')
  N=${N:-2}; [ "$N" -lt 2 ] 2>/dev/null && N=2

  PIDS=(); WORKTREES=(); BRANCHES=(); TASK_NAMES=()
  for i in $(seq 1 "$N"); do
    TASK_NAMES[$i]=$(sed -n "/^## Task ${i}$/,/^## Task /p" "$TASKS" | grep "^name:" | head -1 | cut -d' ' -f2- | tr -d '\r')
    TASK_PROMPT=$(sed -n "/^## Task ${i}$/,/^## Task /p" "$TASKS" | grep "^prompt:" | head -1 | cut -d' ' -f2- | tr -d '\r')
    BRANCH="feature/r${ROUND}-t${i}-${TASK_NAMES[$i]}"
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

  # 汇总Dev Agent结果，检测额度耗尽
  ANY_QUOTA_FAIL=0
  for i in $(seq 1 "$N"); do
    local_out="/tmp/ev_r${ROUND}_t${i}.log"
    st=$(grep -o '"status":"[A-Z]*"' "$local_out" 2>/dev/null | head -1 | cut -d'"' -f4)
    err=$(grep -o '"error":"[^"]*"' "$local_out" 2>/dev/null | head -1 | cut -d'"' -f4)
    if echo "$err" | grep -qi "quota\|Individual quota\|429"; then
      ANY_QUOTA_FAIL=1
      notify "🚨 t${i}: 额度耗尽，暂停等待切号"
    elif [ "$st" = "SUCCESS" ]; then
      notify "✅ t${i} (${TASK_NAMES[$i]}) SUCCESS"
    else
      notify "❌ t${i}: ${err:0:120}"
    fi
  done
  if [ "$ANY_QUOTA_FAIL" -eq 1 ]; then
    quota_trigger
    wait_quota_restore
    continue
  fi
  notify "👷 第${ROUND}轮 Phase2 开发完成（${N}个分支）"

  # === Phase 2.3: Runtime Verifier（强制独立验证，Agent说谎也无用） ===
  VERIFIER="$STATE_DIR/runtime-verify.sh"
  if [ ! -f "$VERIFIER" ]; then
    notify "⚠️ Runtime Verifier 不存在，跳过独立验证"
  else
    for i in $(seq 1 "$N"); do
      WT_DIR="${WORKTREES[$((i-1))]}"
      VERIFY_OUT="/tmp/ev_r${ROUND}_verify_t${i}.json"
      if [ -d "$WT_DIR" ]; then
        bash "$VERIFIER" "$WT_DIR" "$i" "$VERIFY_OUT" > /dev/null 2>&1
        V_STATUS=$(grep -o '"status":"[A-Z]*"' "$VERIFY_OUT" 2>/dev/null | head -1 | cut -d'"' -f4)
        V_PASS=$(grep -o '"passed":[0-9]*' "$VERIFY_OUT" 2>/dev/null | head -1 | cut -d: -f2)
        V_FAIL=$(grep -o '"failed":[0-9]*' "$VERIFY_OUT" 2>/dev/null | head -1 | cut -d: -f2)
        if [ "$V_STATUS" = "PASS" ]; then
          notify "✅ Runtime t${i}: ${V_PASS} PASS / ${V_FAIL} FAIL"
        else
          notify "❌ Runtime t${i}: ${V_PASS} PASS / ${V_FAIL} FAIL"
        fi
      fi
    done
    notify "🔬 第${ROUND}轮 Runtime Verifier 完成"
  fi

  # Phase 2.5: Reviewer — 注入Runtime Verifier结果
  REVIEW_INPUT=""
  for i in $(seq 1 "$N"); do
    WT_DIR="${WORKTREES[$((i-1))]}"
    VERIFY_JSON="/tmp/ev_r${ROUND}_verify_t${i}.json"
    if [ -f "$VERIFY_JSON" ]; then
      V_SUMMARY=$(grep -o '"status":"[A-Z]*","passed":[0-9]*,"failed":[0-9]*' "$VERIFY_JSON" 2>/dev/null | head -1)
      V_CHECKS=$(grep -o '"name":"[^"]*","status":"[A-Z]*"' "$VERIFY_JSON" 2>/dev/null | tr '\n' ' ')
    else
      V_SUMMARY="N/A（Runtime Verifier未执行）"
      V_CHECKS=""
    fi
    REVIEW_INPUT="${REVIEW_INPUT}
=== t${i}: ${TASK_NAMES[$i]} ===
DIFF:$(git -C "$WT_DIR" diff main --stat 2>/dev/null)
RUNTIME: ${V_SUMMARY}
CHECKS: ${V_CHECKS}
LOG_TAIL:$(tail -15 "/tmp/ev_r${ROUND}_t${i}.log" 2>/dev/null)
"
  done
  if ! agy_run "Reviewer" /tmp/ev_r${ROUND}_review.log agy -p "你是【独立Reviewer Gatekeeper】。审查以下${N}个开发分支是否达到交付标准。

**关键：每个分支的 RUNTIME 行是 Runtime Verifier 独立执行的真实结果（cargo check/test/clippy/fmt/diff/commit 命令实际跑过），不是 Agent 自报。**
- RUNTIME 含 PASS → 该检查真实通过
- RUNTIME 含 FAIL → 该检查真实失败（Agent 自报PASS也不可信）
- 只看 RUNTIME + CHECKS 行做最终决策

判断依据：
1. diff是否非空且有实质性改动（看DIFF行）
2. Runtime Verifier 各检查是否PASS（看RUNTIME行）
3. 任务日志是否显示Agent完成了工作（看LOG_TAIL行）

**输出格式（必须是合法的 JSON，每个分支一行，严格如下）：**
{"task_id":"t1","decision":"APPROVED","reason":"简短理由","tests":{"build":true,"unit":true,"ui":true}}
{"task_id":"t2","decision":"REJECTED","reason":"diff 为空","tests":{"build":false,"unit":false,"ui":false}}
{"task_id":"t3","decision":"APPROVED","reason":"","tests":{"build":true,"unit":true,"ui":true}}
（以此类推，共N行，每行一个独立JSON对象）

**决策规则：**
- decision 只能是 "APPROVED" 或 "REJECTED"（大写）
- reason 必须是字符串
- tests 必须包含 build/unit/ui 三个布尔字段
- 不允许 "APPROVED is not recommended" 等否定语境

分支信息：
${REVIEW_INPUT}

只输出N行JSON，不要任何其他文字。" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 8m; then
    wait_quota_restore
    continue
  fi
  notify "🔍 第${ROUND}轮 Reviewer 审查完成"

  unset REVIEW_DECISION; declare -A REVIEW_DECISION
  for i in $(seq 1 "$N"); do
    DECISION=$(parse_review_decision_json "$i" /tmp/ev_r${ROUND}_review.log)
    if [ -z "$DECISION" ] || [ "${DECISION}" = "0" ]; then
      REVIEW_DECISION[$i]="APPROVED"
    else
      REVIEW_DECISION[$i]="REJECTED"
      notify "❌ Reviewer 驳回 t${i}: ${DECISION:0:80}"
    fi
  done

  # Phase 2.8: QA（仅对APPROVED分支）
  unset QA_DECISION; declare -A QA_DECISION
  QA_TARGETS=""
  for i in $(seq 1 "$N"); do
    [ "${REVIEW_DECISION[$i]}" != "APPROVED" ] && continue
    QA_TARGETS="${QA_TARGETS}
=== t${i}: ${TASK_NAMES[$i]} ===
WORKTREE: ${WORKTREES[$((i-1))]}
DIFF:$(git -C "${WORKTREES[$((i-1))]}" diff main --stat 2>/dev/null)
"
  done

  if [ -n "$QA_TARGETS" ]; then
    if ! agy_run "QA" /tmp/ev_r${ROUND}_qa.log agy -p "你是【独立QA智能体】。以下分支已通过Reviewer，需进行独立质量验证：

1. 进入每个worktree，运行cargo build/cargo test/cargo clippy
2. 若app可启动，用cua-driver模拟真人操作，截图核查UI
3. 检查console有无新增Error
4. 验证核心功能无回归

**输出格式（必须是合法JSON，每个分支一行，严格如下）：**
{"task_id":"t1","result":"PASS","reason":""}
{"task_id":"t2","result":"FAIL","reason":"编译失败"}
{"task_id":"t3","result":"PASS","reason":""}

**规则：**
- result 只能是 "PASS" 或 "FAIL"（大写）
- reason 必须是字符串

${QA_TARGETS}
只输出N行JSON，不要任何其他文字。" --model gemini-3.6-flash-high --output-format json --dangerously-skip-permissions --print-timeout 12m; then
      wait_quota_restore
      continue
    fi
    notify "🧪 第${ROUND}轮 QA 测试完成"
    for i in $(seq 1 "$N"); do
      [ "${REVIEW_DECISION[$i]}" != "APPROVED" ] && continue
      QA_PY=python; command -v python3 >/dev/null 2>&1 && QA_PY=python3
      RESULT=$($QA_PY -c "
import json,sys
raw=open(sys.argv[1]).read()
meta=json.loads(raw)
resp=meta.get('response',raw)
for line in resp.strip().split('\n'):
    line=line.strip()
    if not line or line=='DONE': continue
    try:
        obj=json.loads(line)
        if obj.get('task_id')=='t${i}':
            r=obj.get('result','').strip().upper()
            sys.stderr.write(r if r in ('PASS','FAIL') else f'FAIL:{r}')
            sys.exit(1 if r=='FAIL' else 0)
    except: continue
sys.exit(1)
" /tmp/ev_r${ROUND}_qa.log 2>&1)
      if [ "$RESULT" = "PASS" ] || [ -z "$RESULT" ]; then
        QA_DECISION[$i]="PASS"
      else
        QA_DECISION[$i]="FAIL"
        notify "❌ QA 未通过 t${i}: ${RESULT:0:80}"
      fi
    done
  fi

  # === Phase 2.7: Regression Diff (Baseline → After 对比) ===
  BASELINE_DIR="$STATE_DIR/baseline"
  AFTER_DIR="/tmp/regression_r${ROUND}"
  REGRESSION_TOOL="$STATE_DIR/baseline-tool.py"
  REGRESSION_SCORE=1.0
  REGRESSION_VERDICT="SKIP"

  # 首次运行：创建 baseline（如果不存在）
  if [ -f "$REGRESSION_TOOL" ] && [ ! -f "$BASELINE_DIR/baseline.json" ]; then
    mkdir -p "$BASELINE_DIR"
    python "$REGRESSION_TOOL" baseline "$BASELINE_DIR" > /dev/null 2>&1
    if [ -f "$BASELINE_DIR/baseline.json" ]; then
      notify "📸 Baseline 已创建（初始状态）"
      REGRESSION_VERDICT="SKIP"
    fi
  fi

  if [ -f "$REGRESSION_TOOL" ] && [ -f "$BASELINE_DIR/baseline.json" ]; then
    mkdir -p "$AFTER_DIR"
    python "$REGRESSION_TOOL" after "$AFTER_DIR" "$BASELINE_DIR" > /dev/null 2>&1
    if [ -f "$AFTER_DIR/diff_result.json" ]; then
      REGRESSION_SCORE=$(python -c "import json,sys; print(json.load(open(sys.argv[1])).get('regression_score',1.0))" "$AFTER_DIR/diff_result.json" 2>/dev/null)
      REGRESSION_VERDICT=$(python -c "import json,sys; print(json.load(open(sys.argv[1])).get('verdict','SKIP'))" "$AFTER_DIR/diff_result.json" 2>/dev/null)
      REGRESSION_SCORE=${REGRESSION_SCORE:-1.0}
      REGRESSION_VERDICT=${REGRESSION_VERDICT:-SKIP}
      if [ "$REGRESSION_VERDICT" = "PASS" ]; then
        notify "📊 Regression Score: ${REGRESSION_SCORE} | ✅ PASS"
      elif [ "$REGRESSION_VERDICT" = "WARN" ]; then
        notify "📊 Regression Score: ${REGRESSION_SCORE} | ⚠️ WARN"
      elif [ "$REGRESSION_VERDICT" = "FAIL" ]; then
        notify "📊 Regression Score: ${REGRESSION_SCORE} | ❌ FAIL"
        for i in $(seq 1 "$N"); do
          [ "${REVIEW_DECISION[$i]}" != "APPROVED" ] && continue
          [ "${QA_DECISION[$i]:-}" != "PASS" ] && continue
          QA_DECISION[$i]="FAIL"
        done
        notify "❌ Regression FAIL，已通过 QA 的分支自动降级为 FAIL"
      fi

      # 推送所有截图到微信（baseline + after，每张推送一次）
      push_screenshot() {
        local file="$1" label="$2"
        if [ -f "$file" ]; then
          hermes send --to weixin --file "$file" 2>/dev/null
          echo "[$(date)] PHASE 2.7: 推送截图 ${label}: ${file}" >> "$LOG"
        fi
      }
      for scene in home translate; do
        bfile=$(python -c "import json,sys; print(json.load(open(sys.argv[1])).get('screenshots',{}).get(sys.argv[2],''))" "$BASELINE_DIR/baseline.json" "$scene" 2>/dev/null)
        afile=$(python -c "import json,sys; print(json.load(open(sys.argv[1])).get('screenshots',{}).get(sys.argv[2],''))" "$AFTER_DIR/after.json" "$scene" 2>/dev/null)
        push_screenshot "$bfile" "R${ROUND}-${scene}-baseline"
        push_screenshot "$afile" "R${ROUND}-${scene}-after"
      done
    fi
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
📝 研究: $(tail -3 "$STATE_DIR/research.md" 2>/dev/null | tr '\n' ' ' | head -c 150)
🔍 Review: $(python -c "import json,sys; raw=open('/tmp/ev_r${ROUND}_review.log').read() if __import__('os').path.exists('/tmp/ev_r${ROUND}_review.log') else '{}'; meta=json.loads(raw); resp=meta.get('response',''); print(sum(1 for l in resp.split('\n') if '\"decision\":\"APPROVED\"' in l) or 0)" 2>/dev/null || echo 0)/${N} approved
🧪 QA: $(python -c "import json,sys; raw=open('/tmp/ev_r${ROUND}_qa.log').read() if __import__('os').path.exists('/tmp/ev_r${ROUND}_qa.log') else '{}'; meta=json.loads(raw); resp=meta.get('response',''); print(sum(1 for l in resp.split('\n') if '\"result\":\"PASS\"' in l) or 0)" 2>/dev/null || echo 0)/${N} passed"
  echo "[$(date)] $ROUND_REPORT" >> "$LOG"
  notify "$ROUND_REPORT"

  # === Budget Check: 有预算的连续进化 ===
  BUDGET_TOOL="$STATE_DIR/budget.py"
  BUDGET_JSON="$STATE_DIR/budget.json"
  if [ -f "$BUDGET_TOOL" ]; then
    # 估算本轮数据
    LOCAL_APPROVED=$(python -c "import json,sys; raw=open('/tmp/ev_r${ROUND}_review.log').read() if __import__('os').path.exists('/tmp/ev_r${ROUND}_review.log') else '{}'; meta=json.loads(raw); resp=meta.get('response',''); print(sum(1 for l in resp.split('\n') if '\"decision\":\"APPROVED\"' in l) or 0)" 2>/dev/null || echo 0)
    # Expected Benefit: 合并数/总数 + Regression Score 加权
    if [ "$N" -gt 0 ]; then
      BENEFIT=$(python -c "
m=${MERGED_COUNT}; n=${N}; rs=${REGRESSION_SCORE:-1.0}
merged_score = m/n if n>0 else 0
expected_benefit = round((merged_score * 0.5 + float(rs) * 0.5), 2)
expected_benefit = max(0.0, min(1.0, expected_benefit))
print(expected_benefit)")
    else
      BENEFIT=0.0
    fi

    # Risk Level: 基于 Regression Verdict + QA fail 数
    QA_FAIL_COUNT=0
    for i in $(seq 1 "$N"); do
      [ "${QA_DECISION[$i]:-}" = "FAIL" ] && QA_FAIL_COUNT=$((QA_FAIL_COUNT + 1))
    done
    if [ "$REGRESSION_VERDICT" = "FAIL" ] || [ "$QA_FAIL_COUNT" -ge 3 ]; then
      RISK_LEVEL="high"
    elif [ "$REGRESSION_VERDICT" = "WARN" ] || [ "$QA_FAIL_COUNT" -ge 1 ]; then
      RISK_LEVEL="medium"
    else
      RISK_LEVEL="low"
    fi

    # Cost: 基于 agy 调用次数估算（每轮约 2+3+N = N+5 次 agy，每次 ~$0.05 估算）
    ESTIMATED_COST=$(python -c "
calls = ${N} + 5
cost_per_call = 0.03  # 估算每 call 成本
round_cost = round(calls * cost_per_call, 2)
print(round_cost)")

    # 累加总成本（从 state.json 读取上轮累计）
    PREV_COST=$(python -c "import json,sys; d=json.load(open(sys.argv[1])) if __import__('os').path.exists(sys.argv[1]) else {}; print(d.get('cost_usd',0))" "$STATE_DIR/budget_usage.json" 2>/dev/null || echo 0)
    TOTAL_COST=$(python -c "print(round(${PREV_COST:-0} + ${ESTIMATED_COST}, 2))")
    TOTAL_TOKENS=$(python -c "
prev = 0
import json,os
p = '$STATE_DIR/budget_usage.json'
if os.path.exists(p): prev = json.load(open(p)).get('tokens_used', 0)
# 每 agy call ~5000 tokens
print(prev + (${N} + 5) * 5000)")

    # 累计失败门
    PREV_FAILED=$(python -c "import json,sys; d=json.load(open(sys.argv[1])) if __import__('os').path.exists(sys.argv[1]) else {}; print(d.get('failed_gates',0))" "$STATE_DIR/budget_usage.json" 2>/dev/null || echo 0)
    TOTAL_FAILED=$((PREV_FAILED + QA_FAIL_COUNT))

    # 文件改动数
    FILES_CHANGED=$(git diff HEAD~1 --shortstat 2>/dev/null | grep -o '[0-9]* file' | cut -d' ' -f1 || echo 1)
    FILES_CHANGED=${FILES_CHANGED:-1}

    # 写本轮 usage JSON
    USAGE_JSON="/tmp/budget_r${ROUND}_usage.json"
    python -c "
import json
json.dump({
    'iteration': ${ROUND},
    'cost_usd': ${TOTAL_COST},
    'tokens_used': ${TOTAL_TOKENS},
    'files_changed': ${FILES_CHANGED},
    'risk_level': '${RISK_LEVEL}',
    'expected_benefit': ${BENEFIT},
    'failed_gates': ${TOTAL_FAILED},
    'improvement_value': 0  # budget.py 会计算
}, open('$USAGE_JSON','w'), indent=2)"

    # 跑 budget check
    BUDGET_RESULT=$(python "$BUDGET_TOOL" check "$BUDGET_JSON" "$USAGE_JSON" 2>&1)
    BUDGET_CONTINUE=$(echo "$BUDGET_RESULT" | python -c "import json,sys; print(json.load(sys.stdin).get('continue','true'))" 2>/dev/null)
    BUDGET_REASON=$(echo "$BUDGET_RESULT" | python -c "import json,sys; print(json.load(sys.stdin).get('reason',''))" 2>/dev/null)

    # 保存累计数据
    python -c "
import json
json.dump({'cost_usd': ${TOTAL_COST}, 'tokens_used': ${TOTAL_TOKENS}, 'failed_gates': ${TOTAL_FAILED}}, open('$STATE_DIR/budget_usage.json','w'), indent=2)"

    if [ "$BUDGET_CONTINUE" = "False" ]; then
      echo "[$(date)] BUDGET: ${BUDGET_REASON}" >> "$LOG"
      notify "🛑 预算耗尽/价值不足，循环自动停止: ${BUDGET_REASON}"
      notify "📊 IV=${BENEFIT} Risk=${RISK_LEVEL} Cost=\$${TOTAL_COST} FailedGates=${TOTAL_FAILED}"
      echo "BUDGET_STOPPED=true" >> "$LOG"
      break
    else
      echo "[$(date)] BUDGET: ${BUDGET_REASON} (IV=${BENEFIT} Risk=${RISK_LEVEL})" >> "$LOG"
    fi
  fi

  # 全局配额检查
  QUOTA_COUNT=0
  for f in /tmp/ev_r${ROUND}_*.log; do
    [ -f "$f" ] || continue
    grep -qi "quota\|Individual quota\|429" "$f" 2>/dev/null && QUOTA_COUNT=$((QUOTA_COUNT+1))
  done
  if [ "$QUOTA_COUNT" -ge 1 ]; then
    quota_trigger
    wait_quota_restore
  fi

  sleep 10
done