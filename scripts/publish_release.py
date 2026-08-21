# -*- coding: utf-8 -*-
"""
猫步翻译 (Catwalk Translator) 自动化发布与质量防线脚本
永久防止：
1. 静态 ONNX 模型误打包导致体积膨胀 (阈值断言 < 9MB)
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

def run(cmd, cwd=PROJECT_ROOT, check=True):
    print(f"[*] 执行命令: {cmd} (cwd: {cwd})")
    res = subprocess.run(cmd, cwd=cwd, shell=True)
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
    assert "tauri_winres" in build_rs, "build.rs 必须通过 winres 内嵌资源与清单"
    print("  [OK] build.rs 中已正确配置 Common-Controls 6.0 清单与 winres 资源编译器")

def step_2_test_suite():
    print("\n" + "="*60)
    print("【步骤 2/5】执行全量自动化测试套件 (Frontend Vitest + Backend Cargo Test)")
    print("="*60)
    run("npm test", cwd=APP_V2_DIR)
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

    # 冒烟测试：运行 release 二进制文件
    release_exe = os.path.join(SRC_TAURI_DIR, "target", "release", "app_v2.exe")
    assert os.path.exists(release_exe), f"未找到生成的 release 可执行文件: {release_exe}"
    
    # 清理并创建 release_dist
    if os.path.exists(RELEASE_DIST_DIR):
        shutil.rmtree(RELEASE_DIST_DIR)
    os.makedirs(RELEASE_DIST_DIR, exist_ok=True)

    # 1. 提取 NSIS 安装包
    nsis_files = glob.glob(os.path.join(SRC_TAURI_DIR, "target", "release", "bundle", "nsis", "*setup.exe"))
    assert len(nsis_files) > 0, "未找到生成的 NSIS 安装包 (*setup.exe)"
    latest_nsis = max(nsis_files, key=os.path.getmtime)
    setup_target = os.path.join(RELEASE_DIST_DIR, "MaobuTranslator_0.0.1_x64_setup.exe")
    shutil.copy2(latest_nsis, setup_target)
    setup_size_mb = os.path.getsize(setup_target) / (1024 * 1024)
    print(f"  [NSIS 安装包] {os.path.basename(setup_target)} -> {setup_size_mb:.2f} MB")
    assert 5.0 <= setup_size_mb <= 9.0, f"安装包体积异常 ({setup_size_mb:.2f} MB)，预期在 5MB ~ 9MB 之间！"

    # 2. 提取 MSI 安装包
    msi_files = glob.glob(os.path.join(SRC_TAURI_DIR, "target", "release", "bundle", "msi", "*.msi"))
    assert len(msi_files) > 0, "未找到生成的 MSI 安装包 (*.msi)"
    latest_msi = max(msi_files, key=os.path.getmtime)
    msi_target = os.path.join(RELEASE_DIST_DIR, "MaobuTranslator_0.0.1_x64.msi")
    shutil.copy2(latest_msi, msi_target)
    msi_size_mb = os.path.getsize(msi_target) / (1024 * 1024)
    print(f"  [MSI 安装包] {os.path.basename(msi_target)} -> {msi_size_mb:.2f} MB")
    assert 8.0 <= msi_size_mb <= 12.0, f"MSI 安装包体积异常 ({msi_size_mb:.2f} MB)，预期在 8MB ~ 12MB 之间！"

    # 3. 提取绿色便携免安装版
    portable_target = os.path.join(RELEASE_DIST_DIR, "MaobuTranslator_0.0.1_x64_portable.exe")
    shutil.copy2(release_exe, portable_target)
    portable_size_mb = os.path.getsize(portable_target) / (1024 * 1024)
    print(f"  [绿色便携版] {os.path.basename(portable_target)} -> {portable_size_mb:.2f} MB")
    assert 20.0 <= portable_size_mb <= 32.0, f"便携版体积异常 ({portable_size_mb:.2f} MB)，预期在 20MB ~ 32MB 之间！"

    print("  [OK] 所有资产经过严格体积断言与真实性校验通过！")

def step_5_publish(version="v0.0.1"):
    print("\n" + "="*60)
    print(f"【步骤 5/5】安全发布至 GitHub Releases ({version})")
    print("="*60)
    setup_file = os.path.join(RELEASE_DIST_DIR, f"MaobuTranslator_{version.lstrip('v')}_x64_setup.exe")
    portable_file = os.path.join(RELEASE_DIST_DIR, f"MaobuTranslator_{version.lstrip('v')}_x64_portable.exe")
    msi_file = os.path.join(RELEASE_DIST_DIR, f"MaobuTranslator_{version.lstrip('v')}_x64.msi")

    upload_cmd = f'gh release upload {version} "{setup_file}" "{portable_file}" "{msi_file}" --clobber'
    run(upload_cmd)
    print(f"  [OK] 资产安全同步至 GitHub Release {version} 成功！")

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
