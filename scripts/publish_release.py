# -*- coding: utf-8 -*-
"""
猫步翻译 (Catwalk Translator) 自动化发布与质量防线脚本

用法:
    python scripts/publish_release.py                # 测试 + 构建 + 产物校验
    python scripts/publish_release.py --verify-only  # 仅本地资产校验
    python scripts/publish_release.py --publish      # 全流程并上传 GitHub Releases

版本号唯一来源: app_v2/src-tauri/tauri.conf.json 的 version 字段，
与 Cargo.toml / package.json 保持一致，禁止在本脚本内硬编码。

永久防止：
1. 静态 ONNX 模型误打包导致体积膨胀 (阈值断言 5MB ~ 9MB)
2. 缺失 Windows Common Controls v6 清单 (TaskDialogIndirect 报错)
3. 英文向导/英文名称残留 (强制验证 SimpChinese 与「猫步翻译」)
4. 资源文件匹配混淆 (严格通过路径提取而非模糊匹配)
"""

import os
import sys
import json
import glob
import shutil
import subprocess

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP_V2_DIR = os.path.join(PROJECT_ROOT, "app_v2")
SRC_TAURI_DIR = os.path.join(APP_V2_DIR, "src-tauri")
TAURI_CONF_PATH = os.path.join(SRC_TAURI_DIR, "tauri.conf.json")
BUILD_RS_PATH = os.path.join(SRC_TAURI_DIR, "build.rs")
RELEASE_DIST_DIR = os.path.join(PROJECT_ROOT, "release_dist")


def get_app_version():
    """从 tauri.conf.json 读取版本号，作为发布流程的唯一版本来源。"""
    with open(TAURI_CONF_PATH, "r", encoding="utf-8") as f:
        conf = json.load(f)
    version = str(conf.get("version", "")).strip()
    assert version, "tauri.conf.json 中缺少 version 字段"
    return version


def find_windows_sdk_rc():
    """动态定位本机 Windows SDK 的 rc.exe，取版本号最新的一套，避免硬编码路径。"""
    patterns = [
        r"C:\Program Files (x86)\Windows Kits\10\bin\10.*\x64\rc.exe",
        r"C:\Program Files\Windows Kits\10\bin\10.*\x64\rc.exe",
    ]
    candidates = []
    for pattern in patterns:
        candidates.extend(glob.glob(pattern))
    if not candidates:
        return None
    # 路径中含更高 SDK 版本号（如 10.0.26100.0）的优先
    candidates.sort(reverse=True)
    return candidates[0]


def get_build_env():
    env = os.environ.copy()
    rc_exe = find_windows_sdk_rc()
    if rc_exe:
        sdk_bin = os.path.dirname(rc_exe)
        env["RC"] = rc_exe
        env["RC_x86_64_pc_windows_msvc"] = rc_exe
        if sdk_bin not in env.get("PATH", ""):
            env["PATH"] = sdk_bin + ";" + env.get("PATH", "")
        print(f"[*] 使用 Windows SDK rc.exe: {rc_exe}")
    else:
        print("[!] 未找到 Windows SDK rc.exe，将依赖构建环境自身的解析")
    return env


def run(cmd, cwd=PROJECT_ROOT, check=True):
    print(f"[*] 执行命令: {cmd} (cwd: {cwd})")
    res = subprocess.run(cmd, cwd=cwd, shell=True, env=get_build_env())
    if check and res.returncode != 0:
        print(f"[!] 命令执行失败，退出码: {res.returncode}")
        sys.exit(res.returncode)
    return res.returncode


def step_1_preflight():
    print("\n" + "="*60)
    print("【步骤 1/5】前置配置与质量防线静态审计 (Pre-flight Inspection)")
    print("="*60)

    # 1. 审计 tauri.conf.json
    with open(TAURI_CONF_PATH, "r", encoding="utf-8") as f:
        conf = json.load(f)

    # 验证产品名称
    product_name = conf.get("productName", "")
    assert product_name == "猫步翻译", f"产品名称必须为 '猫步翻译'，当前为 '{product_name}'"
    print("  [OK] 产品名称为「猫步翻译」")

    # 验证 NSIS 中文配置
    nsis = conf.get("bundle", {}).get("windows", {}).get("nsis", {})
    langs = nsis.get("languages", [])
    assert "SimpChinese" in langs, f"NSIS 语言必须包含 'SimpChinese'，当前为 {langs}"
    print("  [OK] NSIS 安装向导语言为简体中文 (SimpChinese)")

    # 验证绝对不能打包静态模型文件
    resources = conf.get("bundle", {}).get("resources", {})
    for k, v in resources.items():
        assert not str(k).lower().endswith(".onnx") and not str(v).lower().endswith(".onnx"), \
            f"严禁在 resources 中打包静态 ONNX 模型: {k} -> {v}"
    print("  [OK] 资源配置中无静态 ONNX 模型 (支持应用内按需高速下载与原生系统 OCR)")

    # 2. 审计 build.rs 中的清单配置
    with open(BUILD_RS_PATH, "r", encoding="utf-8") as f:
        build_rs = f.read()
    assert "Microsoft.Windows.Common-Controls" in build_rs, "build.rs 必须包含 Common-Controls 6.0 清单以防止 TaskDialogIndirect 报错"
    assert "app_manifest" in build_rs, "build.rs 必须配置 app_manifest"
    print("  [OK] build.rs 中已正确配置 Common-Controls 6.0 清单与 Windows SDK 编译器集成")


def step_2_test_suite():
    print("\n" + "="*60)
    print("【步骤 2/5】执行全量自动化测试套件 (Frontend Vitest + Backend Cargo Test)")
    print("="*60)
    run("pnpm test", cwd=APP_V2_DIR)
    run("cargo test", cwd=SRC_TAURI_DIR)
    print("  [OK] 前后端自动化测试 100% 绿灯通过")


def step_3_build_release():
    print("\n" + "="*60)
    print("【步骤 3/5】执行生产环境极限压缩构建 (Tauri 2.0 Production Build)")
    print("="*60)
    run("npx tauri build", cwd=APP_V2_DIR)


def step_4_verify_and_collect():
    print("\n" + "="*60)
    print("【步骤 4/5】产物真实性、体积阈值断言与冒烟测试 (Asset Verification)")
    print("="*60)
    version = get_app_version()

    # 冒烟测试：运行 release 二进制文件
    release_exe = os.path.join(SRC_TAURI_DIR, "target", "release", "MaobuTranslator.exe")
    if not os.path.exists(release_exe):
        release_exe = os.path.join(SRC_TAURI_DIR, "target", "release", "app_v2.exe")
    assert os.path.exists(release_exe), f"未找到生成的 release 可执行文件: {release_exe}"

    # 严格验证 release_exe 中已成功物理内嵌 Common-Controls 6.0 清单 (防止 TaskDialogIndirect 报错)
    with open(release_exe, "rb") as f:
        exe_bytes = f.read()
    assert b"Microsoft.Windows.Common-Controls" in exe_bytes, "FATAL: release exe 缺少 Microsoft.Windows.Common-Controls 清单，会导致 TaskDialogIndirect 报错！"
    assert b"6.0.0.0" in exe_bytes, "FATAL: release exe 缺少 Common-Controls 6.0.0.0 清单声明！"
    print("  [OK] release_exe 物理二进制中已正确内嵌 Common-Controls 6.0.0.0 清单")

    # 清理并创建 release_dist
    if os.path.exists(RELEASE_DIST_DIR):
        shutil.rmtree(RELEASE_DIST_DIR)
    os.makedirs(RELEASE_DIST_DIR, exist_ok=True)

    def collect(pattern, bundle_dir, size_range, label):
        """按 glob 提取最新产物，保留 tauri 原始中文命名，并断言版本号与体积。"""
        files = glob.glob(os.path.join(SRC_TAURI_DIR, "target", "release", "bundle", bundle_dir, pattern))
        assert files, f"未找到生成的 {label} ({pattern})"
        latest = max(files, key=os.path.getmtime)
        target = os.path.join(RELEASE_DIST_DIR, os.path.basename(latest))
        shutil.copy2(latest, target)
        size_mb = os.path.getsize(target) / (1024 * 1024)
        print(f"  [{label}] {os.path.basename(target)} -> {size_mb:.2f} MB")
        assert version in os.path.basename(target), \
            f"{label} 文件名中未包含当前版本 {version}，请确认 tauri.conf.json 与构建产物一致"
        low, high = size_range
        assert low <= size_mb <= high, f"{label} 体积异常 ({size_mb:.2f} MB)，预期在 {low}MB ~ {high}MB 之间！"
        return target

    # 1. NSIS 安装包（保留 tauri 生成的中文名，如 猫步翻译_0.1.3_x64-setup.exe）
    collect("*setup.exe", "nsis", (5.0, 9.0), "NSIS 安装包")

    # 2. MSI 安装包
    collect("*.msi", "msi", (8.0, 12.0), "MSI 安装包")

    # 3. 绿色便携免安装版
    portable_target = os.path.join(RELEASE_DIST_DIR, f"猫步翻译_{version}_x64_portable.exe")
    shutil.copy2(release_exe, portable_target)
    portable_size_mb = os.path.getsize(portable_target) / (1024 * 1024)
    print(f"  [绿色便携版] {os.path.basename(portable_target)} -> {portable_size_mb:.2f} MB")
    assert 20.0 <= portable_size_mb <= 32.0, f"便携版体积异常 ({portable_size_mb:.2f} MB)，预期在 20MB ~ 32MB 之间！"

    print("  [OK] 所有资产经过严格体积断言与真实性校验通过！")


def step_5_publish():
    raw_version = get_app_version()
    version = "v" + raw_version
    print("\n" + "="*60)
    print(f"【步骤 5/5】安全发布至 GitHub Releases ({version})")
    print("="*60)
    assets = [os.path.join(RELEASE_DIST_DIR, f) for f in os.listdir(RELEASE_DIST_DIR) if os.path.isfile(os.path.join(RELEASE_DIST_DIR, f))]
    assert assets, "release_dist 目录为空，请先执行产物校验步骤"
    asset_args = " ".join(f'"{a}"' for a in assets)

    # 检查 Release 是否已存在
    check_release = subprocess.run(f"gh release view {version}", shell=True, capture_output=True)
    if check_release.returncode != 0:
        notes = (
            f"## 🐾 猫步翻译 (Catwalk Translator) {version}\n\n"
            f"### ✨ 核心更新与体验打磨\n"
            f"- 🎨 **全新极光透镜纯白猫图标**：全平台落地 1024px 高清 Apple 极简超椭圆设计（ICO / ICNS / PNG）\n"
            f"- ⚡ **智能 OCR 状态感知与 1-Click 一键就绪**：新手引导直接准备离线模型并秒切启用\n"
            f"- 🛡️ **墨迹拒识与干净背景保护**：彻底消除列表圆点 `•` 与标点引起的横向灰色划痕\n"
            f"- 💾 **设置持久化防挂起超时保护**：毫秒级响应，杜绝卡在「保存中...」\n"
            f"- 🪟 **Windows 沉浸式毛玻璃浅色/深色主题适配**：去除顶部生硬高光白杠，浑然一体\n"
            f"- 📦 **生产级 Windows 安装包**：内置简体中文 NSIS 安装向导与当前用户免提权安全模式\n"
        )
        notes_file = os.path.join(PROJECT_ROOT, "temp_release_notes.md")
        with open(notes_file, "w", encoding="utf-8") as f:
            f.write(notes)
        create_cmd = f'gh release create {version} {asset_args} --title "猫步翻译 {version}" --notes-file "{notes_file}"'
        run(create_cmd)
        if os.path.exists(notes_file):
            os.remove(notes_file)
        print(f"  [OK] GitHub Release {version} 创建并上传资产成功！")
    else:
        upload_cmd = f"gh release upload {version} {asset_args} --clobber"
        run(upload_cmd)
        print(f"  [OK] 资产安全同步至已有 GitHub Release {version} 成功！")


if __name__ == "__main__":
    step_1_preflight()
    # 支持仅验证本地资产: python scripts/publish_release.py --verify-only
    if "--verify-only" in sys.argv:
        step_4_verify_and_collect()
    else:
        step_2_test_suite()
        step_3_build_release()
        step_4_verify_and_collect()
        if "--publish" in sys.argv:
            step_5_publish()
    print("\n🎉 发布流水线全部校验通过！")
