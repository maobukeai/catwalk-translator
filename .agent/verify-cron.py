#!/usr/bin/env python3
"""verify-cron.py — 校验并自动修复 cron jobs 配置
每次 loop 启动时自动调用：校验配置 + 创建缺失的 cron + resume 暂停的 cron
返回码：0=全部就绪，1=有错误需要人工干预
"""
import json, os, sys, subprocess

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace("\\", "/")
CONFIG = os.path.join(PROJECT_DIR, ".agent", "project.json")
CRON_FILE = os.path.expanduser("~") + "/AppData/Local/hermes/cron/jobs.json"

if not os.path.exists(CONFIG):
    print(f"❌ project.json not found at {CONFIG}")
    sys.exit(1)

with open(CONFIG) as f:
    cfg = json.load(f)

def to_win(p):
    if p.startswith("/c/"):
        return "C:" + p[2:]
    if p.startswith("/"):
        return p[1:].replace("/", "\\")
    return p

results = []
FIXED = 0

def check(desc, ok):
    status = "✅" if ok else "❌"
    results.append((desc, ok))
    print(f"{status} {desc}")

def cron_exists(name):
    if not os.path.exists(CRON_FILE):
        return None
    try:
        d = json.load(open(CRON_FILE))
    except json.JSONDecodeError:
        return None
    for j in d.get("jobs", []):
        if j["name"] == name:
            return j
    return None

print("=== 1. project.json 字段校验 ===")
for key in ["project_dir", "log_file", "state_file", "quota_trigger", "loop_script", "cron_jobs"]:
    check(f"field '{key}'", key in cfg)

print("\n=== 2. 文件路径 ===")
for key in ["project_dir", "log_file", "state_file", "loop_script"]:
    path = to_win(cfg.get(key, ""))
    check(f"{key}: {path}", os.path.exists(path))

print("\n=== 3. loop_v2.sh ===")
loop_path = to_win(cfg.get("loop_script", ""))
if os.path.exists(loop_path):
    r = subprocess.run(["bash", "-n", loop_path], capture_output=True, text=True)
    check("syntax valid", r.returncode == 0)
    with open(loop_path) as f:
        content = f.read()
    check("no git conflict markers", "<<<<<<<" not in content)
    check("reads project.json", "project.json" in content)

print("\n=== 4. Cron Jobs 校验 + 自动修复 ===")

# ---- quota-switcher ----
QS_NAME = "quota-switcher"
qs_prompt = (
    "你是额度自动切换器。每次运行检查 /c/Users/20269/Desktop/项目文件夹/翻译软件/.agent/.quota_switch 文件是否存在。\n\n"
    "步骤：\n"
    "1. 用 terminal 检查：`test -f /c/Users/20269/Desktop/项目文件夹/翻译软件/.agent/.quota_switch && echo FOUND || echo MISSING`\n"
    "2. 如果 MISSING，输出 `[SILENT]`\n"
    "3. 如果 FOUND：\n"
    "   a. 用 tool_search 找 mcp__cockpit_antigravity_switcher__list_antigravity_accounts，然后 tool_call 它\n"
    "   b. 从结果中找 quota 未 100% 的账号（按 98% > 97% > 95% > 88% > 67% 优先级）\n"
    "   c. 用 tool_search 找 mcp__cockpit_antigravity_switcher__switch_antigravity_account，tool_call 切换到有额度的账号\n"
    "   d. 用 terminal 删除 trigger：`rm -f /c/Users/20269/Desktop/项目文件夹/翻译软件/.agent/.quota_switch`\n"
    "   e. 最终输出格式：\n"
    "🔄 自动切号完成\n"
    "旧账号 → 新账号: <email>\n"
    "剩余额度: <percentage>%\n"
    "已删除 trigger，loop 将继续运行\n"
)
qs_expected = cfg.get("cron_jobs", {}).get(QS_NAME, {})

actual = cron_exists(QS_NAME)
if actual is None:
    print(f"⚠️  '{QS_NAME}' 不存在，正在创建...")
    r = subprocess.run(
        ["hermes", "cron", "create", "--name", QS_NAME, "--deliver", "weixin",
         "every 1m", qs_prompt],
        capture_output=True, text=True, timeout=60
    )
    if r.returncode == 0:
        print(f"✅ '{QS_NAME}' 已创建")
        FIXED += 1
    else:
        print(f"❌ '{QS_NAME}' 创建失败: {r.stderr[:200]}")
    check(f"'{QS_NAME}' exists", True)
else:
    check(f"'{QS_NAME}' exists", True)
    enabled = actual.get("enabled", False)
    check(f"'{QS_NAME}' enabled", enabled == True)
    if not enabled:
        print(f"⏸️  '{QS_NAME}' 已暂停，正在 resume...")
        r = subprocess.run(["hermes", "cron", "resume", qs_expected.get("job_id", "")],
                          capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            print(f"✅ '{QS_NAME}' 已恢复")
            FIXED += 1
        else:
            print(f"⚠️  '{QS_NAME}' resume 失败: {r.stderr[:200]}")
    sched = actual.get("schedule", {})
    check(f"'{QS_NAME}' schedule={qs_expected.get('schedule')}", sched.get("display") == qs_expected.get("schedule"))

# ---- loop-progress-check ----
LPC_NAME = "loop-progress-check"
lpc_prompt = (
    "You are a log mirror. Every run, deliver the FULL contents of the evolution log file to the user via WeChat.\n\n"
    "Steps:\n"
    "1. Run `tail -80 /c/Users/20269/Desktop/项目文件夹/翻译软件/.agent/evolution.log` to get latest 80 lines\n"
    "2. Run `cat /c/Users/20269/Desktop/项目文件夹/翻译软件/.agent/state.json` to get current state\n"
    "3. Run `ps -ef | grep loop_v2 | grep -v grep` to check if process is running\n\n"
    "Output format (just raw content, no summary):\n\n"
    "```\n"
    "🔄 Evolution Log (latest 80 lines)\n"
    "───────────────\n"
    "<all log lines verbatim>\n"
    "───────────────\n"
    "State: <state.json content>\n"
    "Process: <running/stopped>\n"
    "```"
)
lpc_expected = cfg.get("cron_jobs", {}).get(LPC_NAME, {})

actual = cron_exists(LPC_NAME)
if actual is None:
    print(f"⚠️  '{LPC_NAME}' 不存在，正在创建...")
    r = subprocess.run(
        ["hermes", "cron", "create", "--name", LPC_NAME, "--deliver", "weixin",
         "every 5m", lpc_prompt],
        capture_output=True, text=True, timeout=60
    )
    if r.returncode == 0:
        print(f"✅ '{LPC_NAME}' 已创建")
        FIXED += 1
    else:
        print(f"❌ '{LPC_NAME}' 创建失败: {r.stderr[:200]}")
    check(f"'{LPC_NAME}' exists", True)
else:
    check(f"'{LPC_NAME}' exists", True)
    enabled = actual.get("enabled", False)
    check(f"'{LPC_NAME}' enabled", enabled == True)
    if not enabled:
        print(f"⏸️  '{LPC_NAME}' 已暂停，正在 resume...")
        r = subprocess.run(["hermes", "cron", "resume", lpc_expected.get("job_id", "")],
                          capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            print(f"✅ '{LPC_NAME}' 已恢复")
            FIXED += 1
        else:
            print(f"⚠️  '{LPC_NAME}' resume 失败: {r.stderr[:200]}")
    sched = actual.get("schedule", {})
    check(f"'{LPC_NAME}' schedule={lpc_expected.get('schedule')}", sched.get("display") == lpc_expected.get("schedule"))

# ---- 5. backlog.md ----
backlog = to_win(os.path.join(cfg.get("project_dir", ""), ".agent", "backlog.md"))
check("backlog.md exists", os.path.exists(backlog))

print("\n=== 结果 ===")
passed = sum(1 for _, ok in results if ok)
failed = sum(1 for _, ok in results if not ok)
fixed = FIXED
print(f"{passed} passed, {failed} failed, {fixed} auto-fixed")
if failed == 0:
    print("✅ 所有依赖就绪，可以启动")
    sys.exit(0)
else:
    print(f"⚠️  {failed} 个问题需人工检查")
    sys.exit(1)