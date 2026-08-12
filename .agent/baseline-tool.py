#!/usr/bin/env python3
"""baseline-tool.py — Baseline → After 双层对比

用法：
  python baseline-tool.py baseline <dir>          # 采集 baseline 截图+性能
  python baseline-tool.py after    <dir> <base>   # 采集 after 并对比
  python baseline-tool.py diff     <base> <after> # 只做 diff（已有 baseline）

输出 JSON：
{
  "regression_score": 0.85,
  "visual_diff": {"home": {"score": 0.92, "pixels_changed_pct": 12.3}, ...},
  "log_diff": {"new_errors": 3, "new_warnings": 1},
  "performance_diff": {"cpu": {"delta_pct": 5.2}, "memory_mb": {"delta_mb": 45}},
  "verdict": "PASS"
}
"""
import json, os, sys, time, hashlib
from pathlib import Path
from PIL import Image
import numpy as np
import psutil

APP_DIR = "/c/Users/20269/Desktop/项目文件夹/翻译软件/app_v2"
APP_EXE = f"{APP_DIR}/src-tauri/target/debug/app_v2.exe"
SCREENSHOT_DIR = "/c/Users/20269/AppData/Local/Temp"
LOG_FILE = None  # 运行 app 时手动指定


# ──────────────────────────── 工具函数 ────────────────────────────

def screenshot(name: str, dir_path: str) -> str:
    """截屏并保存。用 PIL + subprocess 调 Power Shell 截屏命令。"""
    import subprocess
    out = os.path.join(dir_path, f"{name}.png")
    # PowerShell 截屏：
    cmd = (
        "powershell -NoProfile -Command \"Add-Type -AssemblyName System.Windows.Forms; "
        f"$bmp=[System.Drawing.Bitmap]::new([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); "
        "$g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0,0,0,0,$bmp.Size); "
        f"$bmp.Save('{out}'); $g.Dispose(); $bmp.Dispose()\""
    )
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    return out if os.path.exists(out) else ""


def get_perf_snapshot() -> dict:
    """采集 app 进程 CPU/内存快照。"""
    result = {"cpu_pct": 0, "memory_mb": 0, "threads": 0, "cmdline": ""}
    try:
        for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_info', 'num_threads', 'cmdline']):
            if proc.info['name'] == 'app_v2.exe':
                result['cpu_pct'] = proc.info['cpu_percent'] or 0
                result['memory_mb'] = round(proc.info['memory_info'].rss / 1024 / 1024, 1)
                result['threads'] = proc.info['num_threads'] or 0
                result['cmdline'] = ' '.join(proc.info['cmdline'] or [])[:100]
                break
    except Exception:
        pass
    return result


def collect_log(log_path: str) -> dict:
    """收集日志文件：error/warning 计数 + 最近50行"""
    result = {"error_count": 0, "warning_count": 0, "tail": []}
    if not log_path or not os.path.exists(log_path):
        return result
    try:
        with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
        result['error_count'] = sum(1 for l in lines if 'error' in l.lower() or 'fail' in l.lower())
        result['warning_count'] = sum(1 for l in lines if 'warn' in l.lower())
        result['tail'] = [l.rstrip() for l in lines[-50:]]
    except Exception:
        pass
    return result


# ──────────────────────────── 视觉对比 ────────────────────────────

def visual_diff(base_path: str, after_path: str) -> dict:
    """
    对比两张截图，返回差异指标。
    score: 0~1（1=完全相同）
    pixels_changed_pct: 像素变化百分比
    """
    if not base_path or not after_path or not os.path.exists(base_path) or not os.path.exists(after_path):
        return {"score": None, "pixels_changed_pct": None, "error": "missing_image"}
    try:
        img_b = np.array(Image.open(base_path).convert('RGB'))
        img_a = np.array(Image.open(after_path).convert('RGB'))
        # 统一尺寸
        if img_b.shape != img_a.shape:
            img_a = np.array(Image.open(after_path).convert('RGB').resize(
                Image.open(base_path).size))
        diff = np.abs(img_b.astype(int) - img_a.astype(int))
        total_pixels = diff.shape[0] * diff.shape[1]
        # 任一通道变化>30 即视为该像素变化
        changed_pixels = np.sum(np.any(diff > 30, axis=2))
        pct = round(changed_pixels / total_pixels * 100, 2)
        score = round(1.0 - pct / 100.0, 4)
        return {"score": score, "pixels_changed_pct": pct}
    except Exception as e:
        return {"score": None, "pixels_changed_pct": None, "error": str(e)}


# ──────────────────────────── 主流程 ────────────────────────────

def cmd_baseline(out_dir: str):
    """采集 baseline 状态：截图 + 性能 + 日志"""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    shots = {"home": screenshot("baseline_home", out_dir),
             "translate": screenshot("baseline_translate", out_dir)}
    time.sleep(2)

    perf = get_perf_snapshot()
    log = collect_log(LOG_FILE if LOG_FILE else "")

    data = {
        "type": "baseline",
        "timestamp": time.time(),
        "screenshots": shots,
        "performance": perf,
        "log": log,
    }
    with open(out / "baseline.json", 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"\n✅ baseline 已保存至: {out_dir}")
    return data


def cmd_after(out_dir: str, base_dir: str):
    """采集 after 状态并立即 diff"""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    shots = {"home": screenshot("after_home", out_dir),
             "translate": screenshot("after_translate", out_dir)}
    time.sleep(2)

    perf = get_perf_snapshot()
    log = collect_log(LOG_FILE if LOG_FILE else "")

    data = {
        "type": "after",
        "timestamp": time.time(),
        "screenshots": shots,
        "performance": perf,
        "log": log,
    }
    with open(out / "after.json", 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print("✅ after 已保存，开始对比...")
    return cmd_diff(base_dir, out_dir)


def cmd_diff(base_dir: str, after_dir: str):
    """已有 baseline + after 目录，计算 regression score"""
    base_json = Path(base_dir) / "baseline.json"
    after_json = Path(after_dir) / "after.json"
    if not base_json.exists() or not after_json.exists():
        print("❌ 缺少 baseline.json 或 after.json")
        sys.exit(1)

    base = json.load(open(base_json))
    after = json.load(open(after_json))

    # ── 视觉 diff ──
    visual = {}
    for name in ["home", "translate"]:
        b_path = base["screenshots"].get(name, "")
        a_path = after["screenshots"].get(name, "")
        visual[name] = visual_diff(b_path, a_path)

    # ── 日志 diff ──
    b_log = base.get("log", {})
    a_log = after.get("log", {})
    log_diff = {
        "new_errors": max(0, a_log.get("error_count", 0) - b_log.get("error_count", 0)),
        "new_warnings": max(0, a_log.get("warning_count", 0) - b_log.get("warning_count", 0)),
    }

    # ── 性能 diff ──
    b_perf = base.get("performance", {})
    a_perf = after.get("performance", {})
    perf_diff = {
        "cpu_delta_pct": round(a_perf.get("cpu_pct", 0) - b_perf.get("cpu_pct", 0), 2),
        "memory_delta_mb": round(a_perf.get("memory_mb", 0) - b_perf.get("memory_mb", 0), 1),
        "threads_delta": a_perf.get("threads", 0) - b_perf.get("threads", 0),
    }

    # ── Regression Score ──
    # 计算公式：score = 1 - (visual_delta/100 * 0.4 + log_penalty/10 * 0.3 + perf_penalty/100 * 0.3)
    avg_visual_pct = np.mean([v.get("pixels_changed_pct", 0) or 0 for v in visual.values()])
    log_penalty = min(50, log_diff["new_errors"] * 10 + log_diff["new_warnings"] * 2)
    perf_penalty = min(50, abs(perf_diff["cpu_delta_pct"]) * 0.5 + perf_diff.get("memory_delta_mb", 0) / 10)
    score = max(0, 1.0 - (avg_visual_pct / 100 * 0.4 + log_penalty / 100 * 0.3 + perf_penalty / 100 * 0.3))

    # ── Verdict ──
    verdict = "PASS"
    if score < 0.5 or log_diff["new_errors"] > 5:
        verdict = "FAIL"
    elif score < 0.8 or log_diff["new_errors"] > 0:
        verdict = "WARN"

    result = {
        "regression_score": round(score, 4),
        "visual_diff": visual,
        "log_diff": log_diff,
        "performance_diff": perf_diff,
        "verdict": verdict,
        "score_breakdown": {
            "visual_penalty": round(avg_visual_pct / 100 * 0.4, 4),
            "log_penalty": round(log_penalty / 100 * 0.3, 4),
            "perf_penalty": round(perf_penalty / 100 * 0.3, 4),
        },
    }

    # 写 diff 结果
    diff_out = Path(after_dir) / "diff_result.json"
    with open(diff_out, 'w') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"\n{'✅' if verdict=='PASS' else '⚠️' if verdict=='WARN' else '❌'} Regression Score: {score:.4f} | Verdict: {verdict}")
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "baseline":
        cmd_baseline(sys.argv[2])
    elif cmd == "after":
        cmd_after(sys.argv[2], sys.argv[3])
    elif cmd == "diff":
        cmd_diff(sys.argv[2], sys.argv[3])
    else:
        print(f"未知命令: {cmd}")
        sys.exit(1)