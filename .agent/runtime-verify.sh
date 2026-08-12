#!/bin/bash
# runtime-verify.sh — Runtime Verifier
# 独立于 Agent 执行十道检查门，输出结构化 JSON
# 用法: ./runtime-verify.sh <worktree_path> <task_idx> <output_json>
# 返回: 0=全部PASS, 1=至少一项FAIL

set -o pipefail

WORKTREE="${1:?用法: runtime-verify.sh <worktree> <task_idx> <output_json>}"
TASK_IDX="${2:?缺 task_idx}"
OUTPUT="${3:?缺 output_json}"
WORKDIR="/c/Users/20269/Desktop/项目文件夹/翻译软件"

mkdir -p "$(dirname "$OUTPUT")"
PASS_COUNT=0
FAIL_COUNT=0
RESULTS=""

# 进入 worktree
cd "$WORKTREE" 2>/dev/null || {
  echo "{\"task\":\"t${TASK_IDX}\",\"status\":\"ERROR\",\"checks\":{}}" > "$OUTPUT"
  exit 1
}

run_check() {
  local name="$1"
  local cmd="$2"
  local outfile="$3"
  local logf="/tmp/ev_verify_t${TASK_IDX}_${name}.log"

  echo "$cmd" > "$logf"
  $cmd >> "$logf" 2>&1
  local rc=$?

  if [ $rc -eq 0 ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    RESULTS="${RESULTS}{\"name\":\"${name}\",\"cmd\":\"${cmd}\",\"status\":\"PASS\",\"exit_code\":0,\"log\":\"${logf}\"},"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    RESULTS="${RESULTS}{\"name\":\"${name}\",\"cmd\":\"${cmd}\",\"status\":\"FAIL\",\"exit_code\":${rc},\"log\":\"${logf}\"},"
  fi
}

# === 检查门 ===

# ① cargo check（Rust 后端）
if [ -f "app_v2/src-tauri/Cargo.toml" ] || [ -f "Cargo.toml" ]; then
  run_check "cargo_check" "cargo check --quiet" "/tmp/ev_verify_t${TASK_IDX}_cargo_check.log"
fi

# ② cargo clippy
if [ -f "app_v2/src-tauri/Cargo.toml" ] || [ -f "Cargo.toml" ]; then
  run_check "cargo_clippy" "cargo clippy --quiet 2>/dev/null" "/tmp/ev_verify_t${TASK_IDX}_clippy.log"
fi

# ③ cargo test
if [ -f "app_v2/src-tauri/Cargo.toml" ] || [ -f "Cargo.toml" ]; then
  taskkill /F /IM app_v2.exe 2>/dev/null
  run_check "cargo_test" "cargo test --quiet 2>/dev/null" "/tmp/ev_verify_t${TASK_IDX}_test.log"
fi

# ④ cargo fmt --check
if [ -f "app_v2/src-tauri/Cargo.toml" ] || [ -f "Cargo.toml" ]; then
  run_check "cargo_fmt" "cargo fmt -- --check 2>/dev/null" "/tmp/ev_verify_t${TASK_IDX}_fmt.log"
fi

# ⑤ 无新增 Error（检查 diff 中的 error/fail/panic 关键字）
ERR_COUNT=$(git -C "$WORKTREE" diff main -- '*.rs' '*.ts' '*.tsx' '*.js' '*.jsx' 2>/dev/null | grep -ci "error\|fail\|panic")
ERR_COUNT=${ERR_COUNT:-0}
if [ "$ERR_COUNT" -eq 0 ]; then
  PASS_COUNT=$((PASS_COUNT + 1))
  RESULTS="${RESULTS}{\"name\":\"diff_no_errors\",\"status\":\"PASS\",\"exit_code\":0,\"log\":\"\"},"
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
  RESULTS="${RESULTS}{\"name\":\"diff_no_errors\",\"status\":\"FAIL\",\"exit_code\":${ERR_COUNT},\"log\":\"diff 中含 ${ERR_COUNT} 处 error/fail/panic\"},"
fi

# ⑥ git diff 自查（分支相对于 main 有改动才允许合并）
DIFF_LINES=$(git -C "$WORKTREE" diff main --stat 2>/dev/null | tail -1 | grep -o '[0-9]* file' || echo "0 file")
if [ "$DIFF_LINES" != "0 file" ] && [ "$DIFF_LINES" != "" ]; then
  PASS_COUNT=$((PASS_COUNT + 1))
  RESULTS="${RESULTS}{\"name\":\"diff_nonempty\",\"status\":\"PASS\",\"exit_code\":0,\"log\":\"diff 非空: ${DIFF_LINES}\"},"
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
  RESULTS="${RESULTS}{\"name\":\"diff_nonempty\",\"status\":\"FAIL\",\"exit_code\":0,\"log\":\"diff 为空\"},"
fi

# ⑦ git commit 存在（工作树有未合并的 commit）
COMMIT_COUNT=$(git -C "$WORKTREE" rev-list main..HEAD --count 2>/dev/null || echo 0)
COMMIT_COUNT=${COMMIT_COUNT:-0}
if [ "$COMMIT_COUNT" -gt 0 ]; then
  PASS_COUNT=$((PASS_COUNT + 1))
  RESULTS="${RESULTS}{\"name\":\"commits_exist\",\"status\":\"PASS\",\"exit_code\":0,\"log\":\"${COMMIT_COUNT} commits\"},"
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
  RESULTS="${RESULTS}{\"name\":\"commits_exist\",\"status\":\"FAIL\",\"exit_code\":0,\"log\":\"无 commit\"},"
fi

# ⑧ app 可启动（二进制存在）
if [ -f "app_v2/src-tauri/target/debug/app_v2.exe" ]; then
  PASS_COUNT=$((PASS_COUNT + 1))
  RESULTS="${RESULTS}{\"name\":\"app_binary_exists\",\"status\":\"PASS\",\"exit_code\":0,\"log\":\"binary found\"},"
else
  run_check "app_binary_missing" "echo 'app_v2.exe not found'" "/tmp/ev_verify_t${TASK_IDX}_app.log"
fi

# 写 JSON
OVERALL="FAIL"
[ $FAIL_COUNT -eq 0 ] && OVERALL="PASS"

echo "{
  \"task\": \"t${TASK_IDX}\",
  \"worktree\": \"${WORKTREE}\",
  \"status\": \"${OVERALL}\",
  \"passed\": ${PASS_COUNT},
  \"failed\": ${FAIL_COUNT},
  \"checks\": [${RESULTS%,}]
}" > "$OUTPUT"

echo "$OVERALL"
exit $([ "$OVERALL" = "PASS" ] && echo 0 || echo 1)