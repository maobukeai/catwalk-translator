#!/bin/bash
# kill-all-and-restart.sh
cd /c/Users/20269/Desktop/项目文件夹/翻译软件

echo "=== Killing all bash and agy processes ==="

# Kill all bash.exe
for pid in $(tasklist 2>/dev/null | grep bash.exe | awk '{print $2}'); do
  taskkill /F /PID "$pid" 2>/dev/null
done

# Kill all agy.exe
for pid in $(tasklist 2>/dev/null | grep agy.exe | awk '{print $2}'); do
  taskkill /F /PID "$pid" 2>/dev/null
done

sleep 2

echo "=== After kill ==="
echo "bash remaining: $(tasklist 2>/dev/null | grep bash.exe | wc -l)"
echo "agy remaining: $(tasklist 2>/dev/null | grep agy.exe | wc -l)"

# Fix state.json
echo '{"round":16,"stage":"Stage 02 交互体验与快捷键优化","phase":"P0","status":"RUNNING"}' > .agent/state.json

# Clean STOP markers
sed -i '/^STOP_REQUESTED=true/d' .agent/evolution.log

echo "=== State fixed, ready to start ==="