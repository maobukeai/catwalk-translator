#!/usr/bin/env python3
"""verify-cron.py — 校验 cron jobs 和 loop 配置是否一致"""
import json, os, sys, subprocess

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace("\\", "/")
CONFIG = os.path.join(PROJECT_DIR, ".agent", "project.json")

# MSYS 路径转 Windows 原生路径：/c/Users/... → C:/Users/...
def to_win(p):
    if p.startswith("/c/"):
        return "C:" + p[2:]
    if p.startswith("/"):
        return p[1:].replace("/", "\\")
    return p

if not os.path.exists(CONFIG):
    print(f"❌ project.json not found at {CONFIG}")
    sys.exit(1)

with open(CONFIG) as f:
    cfg = json.load(f)

results = []

def check(desc, ok):
    status = "✅" if ok else "❌"
    results.append((desc, ok))
    print(f"{status} {desc}")

print("=== project.json 字段 ===")
for key in ["project_dir", "log_file", "state_file", "quota_trigger", "loop_script", "cron_jobs"]:
    check(f"field '{key}'", key in cfg)

print("\n=== 文件路径 ===")
for key in ["project_dir", "log_file", "state_file", "loop_script"]:
    path = to_win(cfg.get(key, ""))
    check(f"{key}: {path}", os.path.exists(path))

print("\n=== loop_v2.sh ===")
loop_path = cfg.get("loop_script", "")
if os.path.exists(loop_path):
    r = subprocess.run(["bash", "-n", loop_path], capture_output=True, text=True)
    check("syntax valid", r.returncode == 0)
    with open(loop_path) as f:
        content = f.read()
    check("no git conflict markers", "<<<<<<<" not in content)

print("\n=== cron jobs ===")
CRON_FILE = os.path.expanduser("~") + "/AppData/Local/hermes/cron/jobs.json"
try:
    if os.path.exists(CRON_FILE):
        cron_data = json.load(open(CRON_FILE))
    else:
        cron_data = {"jobs": []}
    cron_jobs = {j["name"]: j for j in cron_data.get("jobs", [])}
    for name, expected in cfg.get("cron_jobs", {}).items():
        actual = cron_jobs.get(name)
        check(f"'{name}' exists", actual is not None)
        if actual:
            check(f"'{name}' enabled", actual.get("enabled") == True)
            check(f"'{name}' schedule={expected['schedule']}", actual.get("schedule", {}).get("display") == expected["schedule"])
            check(f"'{name}' job_id={expected['job_id']}", actual.get("id") == expected["job_id"])
            check(f"'{name}' deliver={expected['deliver']}", actual.get("deliver") == expected["deliver"])
except (json.JSONDecodeError, KeyError) as e:
    check("cron jobs file readable", False)
    print(f"  (error: {e})")

print("\n=== 结果 ===")
passed = sum(1 for _, ok in results if ok)
failed = sum(1 for _, ok in results if not ok)
print(f"{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)