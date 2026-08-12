#!/bin/bash
# kill-remaining.sh - only kill agy, leave Hermes bash alone
cd /c/Users/20269/Desktop/项目文件夹/翻译软件

# Kill remaining agy
for pid in $(tasklist 2>/dev/null | grep agy.exe | awk '{print $2}'); do
  taskkill /F /PID "$pid" 2>/dev/null
done

sleep 1

echo "bash: $(tasklist 2>/dev/null | grep bash.exe | wc -l)"
echo "agy: $(tasklist 2>/dev/null | grep agy.exe | wc -l)"

# Fix state
echo '{"round":16,"stage":"Stage 02 交互体验与快捷键优化","phase":"P0","status":"RUNNING"}' > .agent/state.json
sed -i '/^STOP_REQUESTED=true/d' .agent/evolution.log

echo "cleaned"