#!/bin/bash
# restart-v3.sh — kill old loop + agy, fix state, restart
cd /c/Users/20269/Desktop/项目文件夹/翻译软件

# Kill all bash except Hermes system ones (Hermes = PIDs 3052, 37008, 4436)
for pid in $(tasklist 2>/dev/null | grep bash.exe | awk '{print $2}'); do
  taskkill /F /PID "$pid" 2>/dev/null
done
for pid in $(tasklist 2>/dev/null | grep agy.exe | awk '{print $2}'); do
  taskkill /F /PID "$pid" 2>/dev/null
done
sleep 2

echo "bash: $(tasklist 2>/dev/null | grep bash.exe | wc -l)"
echo "agy: $(tasklist 2>/dev/null | grep agy.exe | wc -l)"

# Fix state
echo '{"round":18,"stage":"Stage 02 交互体验与快捷键优化","phase":"P0","status":"RUNNING"}' > .agent/state.json
sed -i '/^STOP_REQUESTED=true/d' .agent/evolution.log

echo "ready"