#!/usr/bin/env python3
"""budget.py — 有预算的连续进化系统

每个循环必须计算 Expected Gain, Risk, Cost
Improvement Value = Expected Benefit / Risk
预算耗尽或价值过低 → 自动停止

配置项（可被 loop_v2.sh 覆写）：
  max_iterations: 最大迭代轮数
  max_cost_usd:   最大 token 成本（美元）
  max_tokens:     最大 token 总数
  max_files_changed: 单轮最大改动文件数
  max_risk_level:  最大可接受风险等级（low/medium/high）
  max_failed_gates: 累计失败检查门次数上限
  min_improvement_value: 低于此值自动停止

用法：
  python budget.py config   <budget.json>                    # 显示配置
  python budget.py check    <budget.json> <round_report.json>  # 检查是否继续
  python budget.py update   <budget.json> <usage.json>        # 更新消耗
"""
import json, os, sys

BUDGET_DEFAULT = {
    "max_iterations": 10,
    "max_cost_usd": 20.0,
    "max_tokens": 2_000_000,
    "max_files_changed": 20,
    "max_risk_level": "medium",
    "max_failed_gates": 3,
    "min_improvement_value": 0.3,
}

RISK_ORDER = {"low": 1, "medium": 2, "high": 3, "critical": 4}


def load_config(path: str) -> dict:
    """加载 budget.json，缺失字段用默认值补充"""
    if not os.path.exists(path):
        return dict(BUDGET_DEFAULT)
    try:
        cfg = json.load(open(path))
    except Exception:
        return dict(BUDGET_DEFAULT)
    for k, v in BUDGET_DEFAULT.items():
        cfg.setdefault(k, v)
    return cfg


def compute_improvement_value(cost_usd: float, risk_level: str, expected_benefit: float) -> float:
    """
    Improvement Value = Expected Benefit / (Cost × RiskWeight)
    - cost_usd: 本轮实际 token 成本
    - risk_level: low/medium/high/critical
    - expected_benefit: 0~1 的预估收益分（来自 Reviewer 打分或估算）

    收益大 + 风险小 + 成本低 → 高 IV
    收益小 + 风险高 + 成本高 → 低 IV
    """
    if cost_usd <= 0:
        cost_usd = 0.01  # 防止除零
    risk_weight = RISK_ORDER.get(risk_level, 2) / 2.0  # low=0.5, medium=1.0, high=1.5
    if risk_weight <= 0:
        risk_weight = 1.0
    iv = expected_benefit / (cost_usd * risk_weight)
    return round(iv, 4)


def check_continue(cfg: dict, usage: dict) -> dict:
    """
    检查是否应该继续迭代。

    usage 格式：
    {
      "iteration": 7,
      "cost_usd": 12.5,
      "tokens_used": 1_500_000,
      "files_changed": 3,
      "risk_level": "medium",
      "expected_benefit": 0.7,
      "failed_gates": 1,
      "improvement_value": 0.45
    }

    返回：
    {
      "continue": true/false,
      "reason": "...",
      "warnings": ["..."]
    }
    """
    warnings = []
    reasons = []

    # 1. 迭代次数预算
    if usage.get("iteration", 0) >= cfg["max_iterations"]:
        reasons.append(f"已达最大迭代次数 {cfg['max_iterations']}")

    # 2. 成本预算（USD）
    if usage.get("cost_usd", 0) >= cfg["max_cost_usd"]:
        reasons.append(f"已达最大成本 ${cfg['max_cost_usd']}")

    # 3. Token 预算
    if usage.get("tokens_used", 0) >= cfg["max_tokens"]:
        reasons.append(f"已达最大 token 数 {cfg['max_tokens']}")

    # 4. 文件改动预算
    if usage.get("files_changed", 0) > cfg["max_files_changed"]:
        warnings.append(f"单轮改动 {usage['files_changed']} 个文件，超过上限 {cfg['max_files_changed']}")

    # 5. 风险等级预算
    risk_cfg = RISK_ORDER.get(cfg["max_risk_level"], 2)
    risk_act = RISK_ORDER.get(usage.get("risk_level", "low"), 1)
    if risk_act > risk_cfg:
        reasons.append(f"风险等级 {usage.get('risk_level')} 超过上限 {cfg['max_risk_level']}")

    # 6. 累计失败门预算
    if usage.get("failed_gates", 0) > cfg["max_failed_gates"]:
        reasons.append(f"累计失败门 {usage['failed_gates']} 超过上限 {cfg['max_failed_gates']}")

    # 7. Improvement Value 检查
    iv = usage.get("improvement_value", 0)
    if iv <= 0:
        # 自动计算：IV = Expected Benefit / (Cost × RiskWeight)
        iv = compute_improvement_value(
            usage.get("cost_usd", 1.0),
            usage.get("risk_level", "medium"),
            usage.get("expected_benefit", 0)
        )
    if iv < cfg["min_improvement_value"] and usage.get("iteration", 0) > 0:
        reasons.append(f"Improvement Value {iv} 低于最低要求 {cfg['min_improvement_value']}")

    return {
        "continue": len(reasons) == 0,
        "reason": "; ".join(reasons) if reasons else "预算充足，继续迭代",
        "warnings": warnings,
        "reasons": reasons,
        "budget_used": {
            "iterations_pct": round(usage.get("iteration", 0) / cfg["max_iterations"] * 100, 1),
            "cost_pct": round(usage.get("cost_usd", 0) / cfg["max_cost_usd"] * 100, 1),
            "tokens_pct": round(usage.get("tokens_used", 0) / cfg["max_tokens"] * 100, 1),
        },
    }


def cmd_config(path: str):
    cfg = load_config(path)
    print(json.dumps(cfg, indent=2, ensure_ascii=False))
    if not os.path.exists(path):
        with open(path, 'w') as f:
            json.dump(cfg, f, indent=2)
        print(f"\n✅ 已创建 {path}")
    return cfg


def cmd_check(path: str, usage_json: str):
    cfg = load_config(path)
    usage = json.load(open(usage_json)) if os.path.exists(usage_json) else {}
    result = check_continue(cfg, usage)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return result


def cmd_update(path: str, usage_json: str):
    """更新 budget.json 中的消耗记录"""
    cfg = load_config(path)
    usage = json.load(open(usage_json)) if os.path.exists(usage_json) else {}
    cfg["last_usage"] = usage
    with open(path, 'w') as f:
        json.dump(cfg, f, indent=2)
    print(f"✅ budget.json 已更新")
    return cfg


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "config":
        cmd_config(sys.argv[2] if len(sys.argv) > 2 else ".agent/budget.json")
    elif cmd == "check":
        cmd_check(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
    elif cmd == "update":
        cmd_update(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
    else:
        print(f"未知命令: {cmd}")
        sys.exit(1)