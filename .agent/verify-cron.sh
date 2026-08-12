#!/bin/bash
# verify-cron.sh — 校验两个 cron job 是否正确配置
# 从 project.json 读配置，对比 cron job 实际状态
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$PROJECT_DIR/.agent/project.json"

if [ ! -f "$CONFIG" ]; then
  echo "❌ project.json not found at $CONFIG"
  exit 1
fi

PASS=0; FAIL=0
check() {
  local desc="$1"; local cond="$2"
  if [ "$cond" = "true" ]; then
    echo "✅ $desc"
    PASS=$((PASS+1))
  else
    echo "❌ $desc"
    FAIL=$((FAIL+1))
  fi
}

echo "=== 校验 Cron Jobs ==="
echo ""

# quota-switcher
QSID=$(grep '"job_id"' <<< "$(grep -A3 '"name": "quota-switcher"' "$CONFIG")" | sed 's/.*"\([^"]*\)".*/\1/')
QS_ENABLED=$(cronjob list 2>/dev/null | grep -A10 "quota-switcher" | grep '"enabled"' | grep -o 'true\|false')
QS_SCHEDULE=$(cronjob list 2>/dev/null | grep -A10 "quota-switcher" | grep 'every ' | head -1)

check "quota-switcher cron exists" "$( [ -n "$(cronjob list 2>/dev/null | grep 'quota-switcher')" ] && echo true || echo false )"
check "quota-switcher schedule=every 1m" "$( echo "$QS_SCHEDULE" | grep -q '1m' && echo true || echo false )"
check "quota-switcher enabled" "$( [ "$QS_ENABLED" = "true" ] && echo true || echo false )"
check "quota-switcher trigger file path exists" "$( [ -d "$PROJECT_DIR/.agent" ] && echo true || echo false )"

echo ""

# loop-progress-check
LP_ENABLED=$(cronjob list 2>/dev/null | grep -A10 "loop-progress-check" | grep '"enabled"' | grep -o 'true\|false')
LP_SCHEDULE=$(cronjob list 2>/dev/null | grep -A10 "loop-progress-check" | grep 'every ' | head -1)

check "loop-progress-check cron exists" "$( [ -n "$(cronjob list 2>/dev/null | grep 'loop-progress-check')" ] && echo true || echo false )"
check "loop-progress-check schedule=every 5m" "$( echo "$LP_SCHEDULE" | grep -q '5m' && echo true || echo false )"
check "loop-progress-check enabled" "$( [ "$LP_ENABLED" = "true" ] && echo true || echo false )"
check "evolution.log exists" "$( [ -f "$PROJECT_DIR/.agent/evolution.log" ] && echo true || echo false )"

echo ""
echo "=== 校验 loop_v2.sh ==="
LS=$(grep '"loop_script"' "$CONFIG" | sed 's/.*"\([^"]*\)"/\1/')
check "loop script exists at $LS" "$( [ -f "$LS" ] && echo true || echo false )"
check "loop script syntax valid" "$( bash -n "$LS" 2>/dev/null && echo true || echo false )"
check "loop script has no git conflict markers" "$( grep -q '<<<<<<<' "$LS" && echo false || echo true )"
check "loop script reads from project.json" "$( grep -q 'project.json' "$LS" && echo true || echo false )"

echo ""
echo "=== 结果: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1