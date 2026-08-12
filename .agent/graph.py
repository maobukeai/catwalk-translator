#!/usr/bin/env python3
"""graph.py — LangGraph-style State Machine

提供：State / Checkpoint / Interrupt / Resume / Conditional Edges / Human Approval

Hermes = 图编排器（Brain）
Agents = 图节点（Worker）
State = 每个节点可读写
Edges = 条件路由（由节点返回值决定下一节点）
Checkpoint = 每节点完成自动保存，支持断点续跑
Interrupt = 人工介入（HITL），暂停后持久化，恢复时从 checkpoint 继续

用法：
  python graph.py run         <state_dir>          # 运行一轮
  python graph.py resume      <state_dir>          # 从 checkpoint 恢复
  python graph.py checkpoint  <state_dir>          # 查看当前 checkpoint
  python graph.py history     <state_dir>          # 查看执行历史
"""
import json, os, sys, time, subprocess
from pathlib import Path
from dataclasses import dataclass, field, asdict, is_dataclass
from typing import Any, Callable, Optional
from enum import Enum

WORKDIR = "/c/Users/20269/Desktop/项目文件夹/翻译软件"
APP_DIR = "/c/Users/20269/Desktop/项目文件夹/翻译软件/app_v2"

# ═══════════════════════════════════════════════════════════
# 1. State — 强类型状态
# ═══════════════════════════════════════════════════════════


class Phase(str, Enum):
    RESEARCH = "research"
    PLAN = "plan"
    DEVELOP = "develop"
    VERIFY = "verify"
    REVIEW = "review"
    QA = "qa"
    REGRESSION = "regression"
    BUDGET = "budget"
    MERGE = "merge"
    NOTIFY = "notify"
    WAIT_QUOTA = "wait_quota"


class Decision(str, Enum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    SKIPPED = "SKIPPED"
    PASS = "PASS"
    FAIL = "FAIL"


@dataclass
class TaskState:
    task_id: str
    name: str
    branch: str = ""
    worktree: str = ""
    status: str = "pending"          # pending / running / done / failed
    review_decision: str = ""
    qa_decision: str = ""
    runtime_verify: dict = field(default_factory=dict)
    errors: list = field(default_factory=list)
    diff_hash: str = ""
    error_hash: str = ""
    stall_count: int = 0


@dataclass
class RoundState:
    """LangGraph State — 每一轮迭代的核心状态"""
    round: int = 0
    phase: Phase = Phase.RESEARCH
    status: str = "RUNNING"          # RUNNING / IDLE / INTERRUPTED / DONE
    stage: str = ""                  # 来自 Dynamic Priority Wheel
    tasks: list = field(default_factory=list)
    # Review 决策
    review_decisions: dict = field(default_factory=dict)  # task_id -> APPROVED/REJECTED
    # QA 决策
    qa_decisions: dict = field(default_factory=dict)      # task_id -> PASS/FAIL
    # Runtime Verifier
    verifier_results: dict = field(default_factory=dict)  # task_id -> {status, passed, failed}
    # Regression
    regression_score: float = 1.0
    regression_verdict: str = "SKIP"
    # Budget
    budget: dict = field(default_factory=dict)
    budget_continue: bool = True
    budget_reason: str = ""
    # Stalled
    stalled_tasks: list = field(default_factory=list)
    # Round summary
    merged_count: int = 0
    total_tasks: int = 0
    duration_s: float = 0
    round_start: float = 0
    # Checkpoint
    checkpoint_at: float = 0
    # History
    phase_history: list = field(default_factory=list)

    def to_json(self) -> str:
        return dataclass_to_json(self)

    @classmethod
    def from_json(cls, text: str) -> "RoundState":
        return json_to_dataclass(text, cls)


# ═══════════════════════════════════════════════════════════
# 2. Graph — 有向图
# ═══════════════════════════════════════════════════════════


class NodeResult:
    """节点执行结果，包含状态更新 + 条件边选择"""
    def __init__(self, state_updates: dict, edge: str = "default"):
        self.state_updates = state_updates
        self.edge = edge

    def __repr__(self):
        return f"NodeResult(edge={self.edge!r}, updates={list(self.state_updates.keys())})"


class Interrupt(BaseException):
    """人工介入中断。继承 BaseException 避免被通用 except Exception 吞掉。"""
    def __init__(self, reason: str, state_snapshot: dict):
        super().__init__(reason)
        self.reason = reason
        self.state_snapshot = state_snapshot


class ConditionalEdge:
    """
    LangGraph Conditional Edge。

    条件函数接收当前 state，返回下一个节点名。
    支持优先级：多个 edge 匹配时按注册顺序取第一个。
    """
    def __init__(self, source_node: str, condition_fn: Callable, target_nodes: dict):
        self.source = source_node
        self.condition_fn = condition_fn
        self.target_nodes = target_nodes  # condition_result -> target_node_name

    def route(self, state: dict) -> str:
        result = self.condition_fn(state)
        return self.target_nodes.get(result, "default")


class Graph:
    """
    LangGraph 风格有向图。

    - add_node(name, fn): 注册节点
    - add_conditional_edge(source, fn, targets): 条件边
    - add_edge(source, target): 固定边
    - run(state): 执行整图

    每节点执行后自动 checkpoint 保存。
    """

    def __init__(self, state_dir: str):
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.nodes: dict = {}
        self.edges: dict = {}      # source -> list of ConditionalEdge / str
        self._current_node = None
        self._state: dict = {}
        self._history: list = []

    def add_node(self, name: str, fn: Callable):
        self.nodes[name] = fn

    def add_conditional_edge(self, source: str, condition_fn: Callable,
                              targets: dict, default: str = "default"):
        edge = ConditionalEdge(source, condition_fn, targets)
        self.edges.setdefault(source, []).append(edge)
        # 固定默认边
        self.edges[source].append(default)

    def add_edge(self, source: str, target: str):
        self.edges.setdefault(source, []).append(target)

    def _checkpoint(self):
        """保存当前状态到 checkpoint"""
        ck_path = self.state_dir / "checkpoint.json"
        with open(ck_path, 'w') as f:
            json.dump({
                "timestamp": time.time(),
                "node": self._current_node,
                "state": self._state,
                "history": self._history[-50:],
            }, f, indent=2, ensure_ascii=False, default=str)

    def _load_checkpoint(self) -> Optional[dict]:
        ck_path = self.state_dir / "checkpoint.json"
        if not ck_path.exists():
            return None
        try:
            data = json.load(open(ck_path))
            return {"state": data["state"], "node": data["node"]}
        except Exception:
            return None

    def _interrupt(self, reason: str):
        """人工介入中断"""
        self._state["status"] = "INTERRUPTED"
        self._state["interrupt_reason"] = reason
        self._checkpoint()
        print(f"⏸️  [Interrupt] {reason}")
        print(f"    Checkpoint 已保存: {self.state_dir / 'checkpoint.json'}")
        raise Interrupt(reason, dict(self._state))

    def _resolve_next(self, current: str) -> str:
        """根据 edges 确定下一个节点"""
        if current not in self.edges:
            return ""
        targets = self.edges[current]
        for edge in targets:
            if isinstance(edge, ConditionalEdge):
                return edge.route(self._state)
            if isinstance(edge, str) and edge != "default":
                return edge
        return ""

    def run(self, initial_state: dict = None, start_node: str = None) -> dict:
        """执行整图。start_node 指定起始节点（默认取第一个注册节点）"""
        if initial_state:
            self._state = initial_state
        else:
            self._state = self._load_checkpoint() or {}

        if not self._state:
            self._state = {"round": 0, "phase": "research", "status": "RUNNING"}

        # 确定起始节点：优先参数 > checkpoint > 第一个注册节点
        if start_node and start_node in self.nodes:
            start = start_node
        else:
            ck = self._load_checkpoint()
            if ck and ck.get("node") and ck["node"] in self.nodes:
                start = ck["node"]
            else:
                start = next(iter(self.nodes.keys()), "")

        self._current_node = start
        while self._current_node and self._current_node in self.nodes:
            node_name = self._current_node
            print(f"→ 执行节点: {node_name}")
            self._state["_current_node"] = node_name
            self._state["_phase"] = node_name

            try:
                result = self.nodes[node_name](self._state)
                if isinstance(result, NodeResult):
                    self._state.update(result.state_updates)
                    self._current_node = result.edge
                    print(f"   → edge: {result.edge}")
                else:
                    # 节点返回 dict 作为更新
                    if isinstance(result, dict):
                        self._state.update(result)
                    self._current_node = self._resolve_next(node_name)
                self._history.append({"node": node_name, "timestamp": time.time()})
                self._checkpoint()

            except Interrupt as e:
                self._state["status"] = "INTERRUPTED"
                self._state["interrupt_reason"] = e.reason
                self._checkpoint()
                print(f"⏸️  [Interrupt] {e.reason}")
                print(f"    Checkpoint 已保存: {self.state_dir / 'checkpoint.json'}")
                raise
            except Exception as e:
                self._state["_error"] = str(e)
                self._state["_error_node"] = node_name
                self._checkpoint()
                print(f"❌ 节点 {node_name} 异常: {e}")
                self._current_node = ""

        print(f"✅ 图执行完成（终态节点: {self._current_node or 'END'}）")
        return self._state


# ═══════════════════════════════════════════════════════════
# 3. Dataclass JSON 序列化辅助
# ═══════════════════════════════════════════════════════════


def dataclass_to_json(obj) -> str:
    if is_dataclass(obj) and not isinstance(obj, type):
        d = {}
        for f in obj.__dataclass_fields__.values():
            v = getattr(obj, f.name)
            if is_dataclass(v) and not isinstance(v, type):
                d[f.name] = dataclass_to_json(v)
            elif isinstance(v, list):
                d[f.name] = [dataclass_to_json(x) if is_dataclass(x) else x for x in v]
            elif isinstance(v, Enum):
                d[f.name] = v.value
            elif isinstance(v, dict):
                d[f.name] = v
            else:
                d[f.name] = v
        return json.dumps(d, indent=2, ensure_ascii=False, default=str)
    return json.dumps(obj, indent=2, ensure_ascii=False, default=str)


def json_to_dataclass(text: str, cls) -> Any:
    d = json.loads(text)
    if is_dataclass(cls) and isinstance(d, dict):
        kwargs = {}
        for f_name, f_info in cls.__dataclass_fields__.items():
            if f_name in d:
                v = d[f_name]
                f_type = f_info.type
                if is_dataclass(f_type) and isinstance(v, dict):
                    kwargs[f_name] = json_to_dataclass(json.dumps(v), f_type)
                elif hasattr(f_type, '__args__') and is_dataclass(f_type.__args__[0]):
                    kwargs[f_name] = [json_to_dataclass(json.dumps(x), f_type.__args__[0]) for x in v]
                else:
                    kwargs[f_name] = v
        return cls(**kwargs)
    return d


# ═══════════════════════════════════════════════════════════
# 4. CLI
# ═══════════════════════════════════════════════════════════


def cmd_run(state_dir: str):
    ck = load_checkpoint(state_dir)
    round_num = (ck.get("state", {}).get("round", 0) or 0) + 1 if ck else 1
    print(f"启动第 {round_num} 轮")
    # 仅输出启动信息，真正执行由 loop_v2.sh 调度


def cmd_resume(state_dir: str):
    ck = load_checkpoint(state_dir)
    if not ck:
        print("❌ 无 checkpoint，无法恢复")
        return
    state = ck.get("state", {})
    node = ck.get("node", "")
    print(f"🔄 从 checkpoint 恢复")
    print(f"   Round: {state.get('round', '?')}")
    print(f"   Phase: {state.get('_phase', '?')}")
    print(f"   Node: {node}")
    print(f"   Status: {state.get('status', '?')}")


def cmd_checkpoint(state_dir: str):
    ck = load_checkpoint(state_dir)
    if not ck:
        print("无 checkpoint")
        return
    print(json.dumps({k: ck[k] for k in ["timestamp", "node"] if k in ck},
                     indent=2, ensure_ascii=False, default=str))
    state = ck.get("state", {})
    print(f"   Round: {state.get('round', '?')}")
    print(f"   Phase: {state.get('_phase', '?')}")
    print(f"   Status: {state.get('status', '?')}")
    print(f"   Tasks: {len(state.get('tasks', []))}")
    print(f"   Merged: {state.get('merged_count', 0)}/{state.get('total_tasks', 0)}")


def cmd_history(state_dir: str):
    ck = load_checkpoint(state_dir)
    if not ck:
        print("无 history")
        return
    hist = ck.get("history", [])
    print(f"执行历史 ({len(hist)} 条):")
    for h in hist:
        print(f"  [{h.get('timestamp', '?')}] {h.get('node', '?')}")


def load_checkpoint(state_dir: str):
    path = Path(state_dir) / "checkpoint.json"
    if not path.exists():
        return None
    try:
        return json.load(open(path))
    except Exception:
        return None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    state_dir = sys.argv[2] if len(sys.argv) > 2 else ".agent"

    commands = {
        "run": cmd_run,
        "resume": cmd_resume,
        "checkpoint": cmd_checkpoint,
        "history": cmd_history,
    }

    fn = commands.get(cmd)
    if fn:
        fn(state_dir)
    else:
        print(f"未知命令: {cmd}")