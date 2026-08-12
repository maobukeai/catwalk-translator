#!/bin/bash
# kill-and-restart-v2.sh
cd /c/Users/20269/Desktop/项目文件夹/翻译软件

# Kill all loop bash processes (find by command line)
for pid in $(tasklist 2>/dev/null | grep bash.exe | awk '{print $2}'); do
  taskkill /F /PID "$pid" 2>/dev/null
done

# Kill all agy
for pid in $(tasklist 2>/dev/null | grep agy.exe | awk '{print $2}'); do
  taskkill /F /PID "$pid" 2>/dev/null
done

sleep 2

echo "bash: $(tasklist 2>/dev/null | grep bash.exe | wc -l)"
echo "agy: $(tasklist 2>/dev/null | grep agy.exe | wc -l)"

# Fix state
echo '{"round":17,"stage":"Stage 02 交互体验与快捷键优化","phase":"P0","status":"RUNNING"}' > .agent/state.json
sed -i '/^STOP_REQUESTED=true/d' .agent/evolution.log

# Commit fix
git add loop_v2.sh
git commit -m "fix: Bug#10 timeout 5s kills hermes send → removed timeout, kept redirection" 2>&1 | tail -2

# Verify syntax
bash -n loop_v2.sh && echo "SYNTAX OK"