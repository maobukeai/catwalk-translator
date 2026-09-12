# -*- coding: utf-8 -*-
"""
猫步翻译 (Catwalk Translator) 标准化版本号修改与发布触发脚本

用法示例:
    python scripts/bump_version.py 0.3.10
    python scripts/bump_version.py 0.3.10 --notes "1. 优化自动更新体验\n2. 修复若干问题"
    python scripts/bump_version.py 0.3.10 --push
    python scripts/bump_version.py 0.3.10 --dry-run
"""

import os
import re
import sys
import json
import argparse
import datetime
import subprocess

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PACKAGE_JSON_PATH = os.path.join(PROJECT_ROOT, "app_v2", "package.json")
TAURI_CONF_PATH = os.path.join(PROJECT_ROOT, "app_v2", "src-tauri", "tauri.conf.json")
CARGO_TOML_PATH = os.path.join(PROJECT_ROOT, "app_v2", "src-tauri", "Cargo.toml")
VERSION_JSON_PATH = os.path.join(PROJECT_ROOT, "version.json")


def validate_version(ver: str) -> str:
    ver = ver.strip().lstrip("vV")
    if not re.match(r"^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$", ver):
        raise ValueError(f"无效的版本号格式: '{ver}'，必须符合语义化版本格式 (如 0.3.10)")
    return ver


def get_current_versions():
    versions = {}
    if os.path.exists(PACKAGE_JSON_PATH):
        with open(PACKAGE_JSON_PATH, "r", encoding="utf-8") as f:
            versions["package.json"] = json.load(f).get("version")
    if os.path.exists(TAURI_CONF_PATH):
        with open(TAURI_CONF_PATH, "r", encoding="utf-8") as f:
            versions["tauri.conf.json"] = json.load(f).get("version")
    if os.path.exists(CARGO_TOML_PATH):
        with open(CARGO_TOML_PATH, "r", encoding="utf-8") as f:
            content = f.read()
            m = re.search(r'(?m)^version\s*=\s*"([^"]+)"', content)
            if m:
                versions["Cargo.toml"] = m.group(1)
    if os.path.exists(VERSION_JSON_PATH):
        with open(VERSION_JSON_PATH, "r", encoding="utf-8") as f:
            versions["version.json"] = json.load(f).get("version")
    return versions


def update_package_json(new_ver: str, dry_run: bool):
    with open(PACKAGE_JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    old_ver = data.get("version")
    data["version"] = new_ver
    if not dry_run:
        with open(PACKAGE_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
    print(f"  [package.json] {old_ver} -> {new_ver}")


def update_tauri_conf(new_ver: str, dry_run: bool):
    with open(TAURI_CONF_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    old_ver = data.get("version")
    data["version"] = new_ver
    if not dry_run:
        with open(TAURI_CONF_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
    print(f"  [tauri.conf.json] {old_ver} -> {new_ver}")


def update_cargo_toml(new_ver: str, dry_run: bool):
    with open(CARGO_TOML_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    old_ver_match = re.search(r'(?m)^version\s*=\s*"([^"]+)"', content)
    old_ver = old_ver_match.group(1) if old_ver_match else "unknown"
    new_content = re.sub(r'(?m)^version\s*=\s*"[^"]+"', f'version = "{new_ver}"', content, count=1)
    if not dry_run:
        with open(CARGO_TOML_PATH, "w", encoding="utf-8") as f:
            f.write(new_content)
    print(f"  [Cargo.toml] {old_ver} -> {new_ver}")


def update_version_json(new_ver: str, notes: str | None, dry_run: bool):
    with open(VERSION_JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    old_ver = data.get("version")
    today_str = datetime.date.today().strftime("%Y-%m-%d")

    data["version"] = new_ver
    data["release_date"] = today_str
    if notes:
        data["release_notes"] = notes

    # 更新 assets 列表中的文件名与下载地址
    assets = data.get("assets", [])
    for asset in assets:
        old_name = asset.get("name", "")
        if "MaobuTranslator_" in old_name:
            asset["name"] = f"MaobuTranslator_{new_ver}_x64-setup.exe"
            asset["url"] = f"https://github.com/maobukeai/catwalk-translator/releases/download/v{new_ver}/MaobuTranslator_{new_ver}_x64-setup.exe"
        elif "猫步翻译_" in old_name:
            asset["name"] = f"猫步翻译_{new_ver}_x64-setup.exe"
            asset["url"] = f"https://github.com/maobukeai/catwalk-translator/releases/download/v{new_ver}/%E7%8C%AB%E6%AD%A5%E7%BF%BB%E8%AF%91_{new_ver}_x64-setup.exe"

    if not dry_run:
        with open(VERSION_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
    print(f"  [version.json] {old_ver} -> {new_ver} (date: {today_str})")


def sync_cargo_lock(dry_run: bool):
    if dry_run:
        print("  [Cargo.lock] (dry-run: 跳过 cargo check 同步)")
        return
    manifest_path = os.path.join(PROJECT_ROOT, "app_v2", "src-tauri", "Cargo.toml")
    cmd = f'cargo check --manifest-path "{manifest_path}" --quiet'
    print(f"[*] 正在自动刷新 Cargo.lock: {cmd}")
    res = subprocess.run(cmd, shell=True, cwd=PROJECT_ROOT)
    if res.returncode == 0:
        print("  [Cargo.lock] 同步更新成功")
    else:
        print("  [Cargo.lock] 警告: cargo check 返回非零状态，请手动核对 Cargo.lock")


def main():
    parser = argparse.ArgumentParser(description="猫步翻译版本号自动化更新工具")
    parser.add_argument("version", help="目标版本号，如 0.3.10")
    parser.add_argument("--notes", "-m", help="本次版本的更新说明内容", default=None)
    parser.add_argument("--dry-run", action="store_true", help="仅预览改动，不写盘")
    parser.add_argument("--push", action="store_true", help="修改后自动完成 Git 提交、打标签并推送至远程")

    args = parser.parse_args()

    try:
        new_version = validate_version(args.version)
    except ValueError as e:
        print(f"[!] 错误: {e}")
        sys.exit(1)

    print("=" * 60)
    print(f"📦 猫步翻译版本号更新 -> v{new_version}")
    print("=" * 60)

    current_versions = get_current_versions()
    print("[*] 当前各文件版本状态:")
    for file, ver in current_versions.items():
        print(f"    {file}: {ver}")

    print("\n[*] 正在原子化更新版本定义:")
    update_package_json(new_version, args.dry_run)
    update_tauri_conf(new_version, args.dry_run)
    update_cargo_toml(new_version, args.dry_run)
    update_version_json(new_version, args.notes, args.dry_run)
    sync_cargo_lock(args.dry_run)

    if args.dry_run:
        print("\n✅ Dry-run 预演完成，未修改物理文件。")
        return

    print("\n✨ 所有版本定义文件已成功同步修改！")

    tag_name = f"v{new_version}"
    commit_msg = f"chore(release): bump version to {tag_name}"

    if args.push:
        print("\n[*] 检测到 --push 参数，正在执行 Git 提交与推送...")
        commands = [
            'git add app_v2/package.json app_v2/src-tauri/Cargo.lock app_v2/src-tauri/Cargo.toml app_v2/src-tauri/tauri.conf.json version.json',
            f'git commit -m "{commit_msg}"',
            f'git tag -a {tag_name} -m "Release {tag_name}"',
            'git push origin main --follow-tags'
        ]
        for c in commands:
            print(f"  > {c}")
            res = subprocess.run(c, shell=True, cwd=PROJECT_ROOT)
            if res.returncode != 0:
                print(f"[!] Git 命令执行失败: {c}")
                sys.exit(res.returncode)
        print(f"\n🚀 已成功推送 {tag_name} 标签至 GitHub！将自动触发 GitHub Actions 云端打包发布。")
    else:
        print("\n💡 接下来您可运行以下命令提交并推送以触发云端打包:")
        print(f"   git add app_v2/package.json app_v2/src-tauri/Cargo.lock app_v2/src-tauri/Cargo.toml app_v2/src-tauri/tauri.conf.json version.json")
        print(f'   git commit -m "{commit_msg}"')
        print(f'   git tag -a {tag_name} -m "Release {tag_name}"')
        print(f"   git push origin main --follow-tags")


if __name__ == "__main__":
    main()
