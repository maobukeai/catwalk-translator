#!/usr/bin/env python3
"""priority-engine.py — Dynamic Priority Wheel

传统九阶段轮盘 → 动态优先级引擎

输入：
  - User Feedback（feedback_queue.md）
  - Security scan 结果
  - 项目领域指标
  - 各阶段 Last Touched 时间

公式：
  Priority Score = Risk × UserImpact × BusinessValue × Evidence

输出：
  sorted priority list（最高分先做）

用法：
  python priority-engine.py evaluate <state_dir>      # 输出排序后的阶段列表
  python priority-engine.py recommend <state_dir>     # 输出推荐下一阶段
"""
import json, os, sys, time
from pathlib import Path

# ───────────────────────────── 配置 ─────────────────────────────

# 9 个阶段及其默认权重（覆盖机制保证全部被触达）
STAGES = [
    "UI/UX", "交互体验", "前端代码", "后端代码", "业务逻辑",
    "代码质量", "性能", "测试", "新功能"
]

# 每阶段默认权重（领域无关基线）
BASE_WEIGHTS = {
    "UI/UX": 0.15,
    "交互体验": 0.10,
    "前端代码": 0.12,
    "后端代码": 0.12,
    "业务逻辑": 0.20,
    "代码质量": 0.10,
    "性能": 0.10,
    "测试": 0.05,
    "新功能": 0.06,
}

# 领域权重覆写：不同项目类型有不同的优先重点
DOMAIN_WEIGHTS = {
    "translation": {
        # 翻译软件核心：OCR 精度 > 翻译延迟 > 截图定位 > Windows API
        "业务逻辑": 0.25,    # OCR/翻译核心逻辑
        "性能": 0.20,        # 翻译延迟
        "后端代码": 0.15,    # Windows API/截图定位
        "前端代码": 0.10,
        "UI/UX": 0.08,
        "交互体验": 0.05,
        "代码质量": 0.07,
        "测试": 0.07,
        "新功能": 0.03,
    },
    "chat": {
        "后端代码": 0.25, "业务逻辑": 0.20, "UI/UX": 0.15,
        "性能": 0.10, "交互体验": 0.10, "前端代码": 0.07,
        "代码质量": 0.05, "测试": 0.05, "新功能": 0.03,
    },
    "game": {
        "性能": 0.25, "业务逻辑": 0.20, "UI/UX": 0.15,
        "交互体验": 0.15, "前端代码": 0.10, "后端代码": 0.05,
        "代码质量": 0.05, "测试": 0.03, "新功能": 0.02,
    },
}

DEFAULT_DOMAIN = "translation"

# ──────────────────────────── 评分函数 ────────────────────────────


def load_user_feedback(state_dir: str) -> dict:
    """读取 feedback_queue.md，统计各阶段的反馈密度"""
    fb_path = Path(state_dir) / "feedback_queue.md"
    feedback = {s: 0 for s in STAGES}
    if not fb_path.exists():
        return feedback
    try:
        text = open(fb_path).read().lower()
        # 关键词映射
        mapping = {
            "UI/UX": ["ui", "ux", "界面", "美观", "颜色", "字体", "布局"],
            "交互体验": ["交互", "操作", "快捷键", "反馈", "流畅"],
            "前端代码": ["前端", "react", "vue", "组件", "渲染"],
            "后端代码": ["后端", "api", "接口", "服务器"],
            "业务逻辑": ["ocr", "翻译", "逻辑", "识别", "截图", "定位"],
            "代码质量": ["重构", "重复", "命名", "注释", "dead code"],
            "性能": ["性能", "慢", "延迟", "卡顿", "速度", "内存"],
            "测试": ["测试", "测试", "bug", "回归", "coverage"],
            "新功能": ["新功能", "feature", "新增"],
        }
        for stage, keywords in mapping.items():
            feedback[stage] = sum(1 for kw in keywords if kw in text)
    except Exception:
        pass
    return feedback


def load_last_touched(state_dir: str) -> dict:
    """各阶段最后被触达的时间"""
    path = Path(state_dir) / "last_touched.json"
    now = time.time()
    if not path.exists():
        return {s: now - 86400 * 7 for s in STAGES}  # 默认7天未触达
    try:
        data = json.load(open(path))
        return {s: data.get(s, now - 86400 * 7) for s in STAGES}
    except Exception:
        return {s: now - 86400 * 7 for s in STAGES}


def load_backlog_bugs(state_dir: str) -> dict:
    """从 backlog.md Bugs 部分统计各阶段 bug 数"""
    path = Path(state_dir) / "backlog.md"
    bugs = {s: 0 for s in STAGES}
    if not path.exists():
        return bugs
    try:
        text = open(path).read().lower()
        in_bugs = False
        for line in text.split('\n'):
            if line.startswith('## Bugs'):
                in_bugs = True
                continue
            if in_bugs and line.startswith('## '):
                break
            if in_bugs and line.strip().startswith('-'):
                # 简单关键词归属
                for stage, keywords in {
                    "UI/UX": ["ui", "界面", "美观"],
                    "交互体验": ["交互", "操作", "快捷键"],
                    "前端代码": ["前端", "组件"],
                    "后端代码": ["后端", "api"],
                    "业务逻辑": ["ocr", "翻译", "截图"],
                    "代码质量": ["重构", "dead"],
                    "性能": ["性能", "慢", "延迟"],
                    "测试": ["测试", "bug"],
                    "新功能": ["新功能"],
                }.items():
                    if any(kw in line for kw in keywords):
                        bugs[stage] += 1
                        break
    except Exception:
        pass
    return bugs


def load_evolution_log_errors(state_dir: str) -> dict:
    """从 evolution.log 统计各阶段错误频率"""
    path = Path(state_dir) / "evolution.log"
    errors = {s: 0 for s in STAGES}
    if not path.exists():
        return errors
    try:
        with open(path) as f:
            lines = f.readlines()
        recent = lines[-200:]  # 只看最近200行
        stage_keywords = {
            "UI/UX": ["ui", "ux", "界面"],
            "交互体验": ["交互", "操作"],
            "前端代码": ["前端", "frontend"],
            "后端代码": ["后端", "backend", "api"],
            "业务逻辑": ["ocr", "翻译", "logic"],
            "代码质量": ["重构", "refactor"],
            "性能": ["性能", "performance", "慢", "slow"],
            "测试": ["测试", "test", "ci"],
            "新功能": ["新功能", "feature"],
        }
        for line in recent:
            lower = line.lower()
            if 'error' not in lower and 'fail' not in lower and 'reject' not in lower:
                continue
            for stage, keywords in stage_keywords.items():
                if any(kw in lower for kw in keywords):
                    errors[stage] += 1
    except Exception:
        pass
    return errors


def compute_priority(domain: str, state_dir: str) -> list:
    """
    计算各阶段优先级分数。

    Priority Score = Risk × UserImpact × BusinessValue × Evidence

    - Risk: 由 backlog bugs + 近期错误频率决定（bug多=风险高）
    - UserImpact: 由用户反馈密度决定（反馈多=影响大）
    - BusinessValue: 由领域权重决定（翻译软件业务逻辑权重大）
    - Evidence: 由最后触达时间决定（久未触达=证据弱=需加强覆盖）

    返回：按 Priority Score 降序排序的 (stage, score, breakdown) 列表
    """
    weights = DOMAIN_WEIGHTS.get(domain, DOMAIN_WEIGHTS[DEFAULT_DOMAIN])
    feedback = load_user_feedback(state_dir)
    last_touched = load_last_touched(state_dir)
    bugs = load_backlog_bugs(state_dir)
    errors = load_evolution_log_errors(state_dir)
    now = time.time()

    results = []
    for stage in STAGES:
        # Risk: bug密度 + 错误频率，归一化到 1~3
        risk = 1.0 + (bugs.get(stage, 0) * 0.5) + (errors.get(stage, 0) * 0.3)
        risk = min(3.0, risk)

        # UserImpact: 反馈密度，归一化到 1~2
        user_impact = 1.0 + (feedback.get(stage, 0) * 0.3)
        user_impact = min(2.0, user_impact)

        # BusinessValue: 领域权重 * 10（放大区分度）
        business_value = weights.get(stage, 0.1) * 10

        # Evidence: 久未触达的惩罚因子（7天=1.0，0天=1.5）
        days_since = max(0, (now - last_touched.get(stage, 0))) / 86400
        evidence = min(1.5, 1.0 + (days_since / 7) * 0.5)

        # Priority Score
        score = round(risk * user_impact * business_value * evidence, 4)

        results.append({
            "stage": stage,
            "priority_score": score,
            "risk": round(risk, 2),
            "user_impact": round(user_impact, 2),
            "business_value": round(business_value, 2),
            "evidence": round(evidence, 2),
            "days_since_touched": round(days_since, 1),
            "bugs": bugs.get(stage, 0),
            "errors": errors.get(stage, 0),
            "feedback_count": feedback.get(stage, 0),
        })

    # 按 priority_score 降序排序
    results.sort(key=lambda x: x["priority_score"], reverse=True)
    return results


def cmd_evaluate(state_dir: str, domain: str = DEFAULT_DOMAIN):
    """输出完整排序后的阶段优先级列表"""
    results = compute_priority(domain, state_dir)
    print(f"Domain: {domain}")
    print(f"Time: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    print(f"{'Rank':<5} {'Stage':<12} {'Score':<8} {'Risk':<6} {'UI':<6} {'BV':<6} {'Ev':<6} {'Days':<6} {'Bugs':<5} {'Fb'}")
    print("-" * 75)
    for i, r in enumerate(results, 1):
        print(f"{i:<5} {r['stage']:<12} {r['priority_score']:<8} {r['risk']:<6} {r['user_impact']:<6} {r['business_value']:<6} {r['evidence']:<6} {r['days_since_touched']:<6} {r['bugs']:<5} {r['feedback_count']}")
    print()
    print(json.dumps(results, indent=2, ensure_ascii=False))
    return results


def cmd_recommend(state_dir: str, domain: str = DEFAULT_DOMAIN):
    """输出推荐下一阶段（JSON）"""
    results = compute_priority(domain, state_dir)
    top = results[0] if results else None
    if top:
        print(f"推荐下一阶段: {top['stage']} (Score={top['priority_score']}, Risk={top['risk']})")
    return top


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    state_dir = sys.argv[2] if len(sys.argv) > 2 else ".agent"
    domain = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_DOMAIN

    if cmd == "evaluate":
        cmd_evaluate(state_dir, domain)
    elif cmd == "recommend":
        cmd_recommend(state_dir, domain)
    else:
        print(f"未知命令: {cmd}")
        sys.exit(1)