#!/usr/bin/env python3
"""executor.py — OpenHands-style Agent Executor Abstraction

设计原则（来自 OpenHands SDK）：
1. Executor 统一接口：run(agent_type, prompt, config) -> Result
2. Tool Registry：标准化工具注册与发现
3. Sandbox：每个 agent 独立工作空间
4. Agent Runtime：生命周期管理（start/pause/resume/kill）

不依赖 OpenHands SDK 本身，采用其设计模式，底层仍用 agy (Antigravity)。

用法：
  python executor.py run dev "任务描述" --timeout 15m
  python executor.py run reviewer "审查任务" --timeout 5m
  python executor.py run qa "测试任务" --timeout 10m
  python executor.py tools list
"""
import json, os, sys, subprocess, time, signal
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional

WORKDIR = "/c/Users/20269/Desktop/项目文件夹/翻译软件"
LOG_DIR = "/tmp"

# ──────────────────────────── Executor Abstraction ────────────────────────────


@dataclass
class ToolConfig:
    name: str
    description: str
    args: list = field(default_factory=list)


@dataclass
class ExecutionConfig:
    model: str = "gemini-3.6-flash-high"
    timeout: int = 900  # seconds
    output_format: str = "json"
    sandbox: str = ""  # worktree path for isolation


@dataclass
class ExecutionResult:
    agent_type: str
    status: str  # SUCCESS / ERROR / TIMEOUT / QUOTA_EXHAUSTED
    response: str = ""
    error: str = ""
    duration_s: float = 0
    tokens_used: int = 0
    cost_usd: float = 0
    quota_exhausted: bool = False

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, ensure_ascii=False)


class Executor:
    """
    OpenHands 风格 Executor：统一代理执行入口。

    使用模式：
      executor = Executor()
      result = executor.run("dev", "任务描述", config)
      result = executor.run("reviewer", "审查", config)
    """

    AGENT_TYPES = {"research", "planner", "dev", "reviewer", "qa"}
    AGY_BIN = "agy"

    def run(self, agent_type: str, prompt: str, config: ExecutionConfig = None,
            label: str = "") -> ExecutionResult:
        if agent_type not in self.AGENT_TYPES:
            raise ValueError(f"未知 agent 类型: {agent_type}")

        config = config or ExecutionConfig()
        log_path = os.path.join(LOG_DIR, f"exec_{agent_type}_{int(time.time())}.log")
        label = label or agent_type

        # 构建 agy 命令（与 loop_v2.sh 保持一致）
        cmd = [
            self.AGY_BIN,
            "-p", prompt,
            "--model", config.model,
            "--output-format", config.output_format,
            "--dangerously-skip-permissions",
            "--print-timeout", f"{config.timeout}s",
        ]

        start = time.time()
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=open(log_path, 'w'),
                stderr=subprocess.STDOUT,
                cwd=WORKDIR,
                preexec_fn=os.setsid if os.name == "posix" else None,
            )
            proc.wait(timeout=config.timeout)
            duration = time.time() - start

            # 解析结果
            result = self._parse_result(log_path)
            result.duration_s = round(duration, 1)
            return result

        except subprocess.TimeoutExpired:
            proc.kill()
            return ExecutionResult(agent_type=agent_type, status="TIMEOUT",
                                    error="超时", duration_s=config.timeout)
        except Exception as e:
            return ExecutionResult(agent_type=agent_type, status="ERROR",
                                    error=str(e), duration_s=time.time()-start)

    def _parse_result(self, log_path: str) -> ExecutionResult:
        """解析 agy 输出 JSON"""
        if not os.path.exists(log_path):
            return ExecutionResult(agent_type="", status="ERROR", error="日志文件不存在")

        content = open(log_path).read()
        try:
            meta = json.loads(content)
            status = meta.get("status", "ERROR")
            response = meta.get("response", "")
            error = meta.get("error", "")
        except json.JSONDecodeError:
            # 降级：裸文本输出
            status = "SUCCESS" if content.strip() else "ERROR"
            response = content
            error = ""

        # 检测额度耗尽
        quota = "quota" in error.lower() or "429" in error.lower() or \
                "Individual quota" in error.lower()

        return ExecutionResult(
            agent_type="",
            status=status,
            response=response,
            error=error,
            quota_exhausted=quota,
        )


# ──────────────────────────── Tool Registry ───────────────────────────────────


class ToolRegistry:
    """
    OpenHands 风格 Tool 注册与发现。

    Agent 运行时可查询可用工具，按标准协议调用。
    """

    def __init__(self):
        self._tools: dict = {}

    def register(self, name: str, description: str, args: list = None):
        self._tools[name] = ToolConfig(name, description, args or [])

    def list_tools(self) -> list:
        return [asdict(t) for t in self._tools.values()]

    def get(self, name: str) -> Optional[ToolConfig]:
        return self._tools.get(name)


# 注册标准工具（与 loop_v2.sh 中使用的保持一致）
standard_tools = ToolRegistry()
standard_tools.register("cua_driver", "驱动桌面 UI 自动化测试",
                        ["screenshot", "click", "type", "get_desktop_state"])
standard_tools.register("git", "Git 操作（commit/push/merge/diff）",
                        ["commit", "push", "merge", "diff", "worktree"])
standard_tools.register("hermes_send", "微信消息推送",
                        ["--to weixin", "--file"])
standard_tools.register("hermes_send", "微信消息推送",
                        ["--to weixin", "--file"])
standard_tools.register("git_worktree", "独立开发分支隔离",
                        ["add", "remove", "list"])
standard_tools.register("runtime_verify", "Runtime 强制验证（cargo check/test/clippy/fmt）",
                        ["--quiet"])
standard_tools.register("baseline_tool", "Baseline→After 回归对比",
                        ["baseline", "after", "diff"])
standard_tools.register("budget_check", "迭代预算检查",
                        ["check", "update"])
standard_tools.register("priority_engine", "动态优先级计算",
                        ["evaluate", "recommend"])


# ──────────────────────────── Agent Runtime (Lifecycle) ───────────────────────


@dataclass
class AgentState:
    agent_type: str
    pid: Optional[int] = None
    status: str = "idle"  # idle / running / paused / killed / done
    created_at: float = 0
    started_at: float = 0
    completed_at: float = 0
    worktree: str = ""
    branch: str = ""


class AgentRuntime:
    """
    Agent 生命周期管理。

    每个 agent 有独立状态机：
      idle → running → done
      idle → running → paused → running → done
      running → killed
    """

    def __init__(self):
        self._agents: dict = {}  # agent_id -> AgentState

    def spawn(self, agent_type: str, worktree: str = "", branch: str = "") -> str:
        aid = f"{agent_type}_{int(time.time())}"
        self._agents[aid] = AgentState(
            agent_type=agent_type,
            created_at=time.time(),
            worktree=worktree,
            branch=branch,
        )
        return aid

    def start(self, aid: str, pid: int):
        if aid in self._agents:
            self._agents[aid].pid = pid
            self._agents[aid].status = "running"
            self._agents[aid].started_at = time.time()

    def done(self, aid: str):
        if aid in self._agents:
            self._agents[aid].status = "done"
            self._agents[aid].completed_at = time.time()

    def kill(self, aid: str):
        if aid in self._agents:
            state = self._agents[aid]
            if state.pid:
                try:
                    os.killpg(os.getpgid(state.pid), signal.SIGTERM)
                except Exception:
                    pass
            state.status = "killed"

    def get_state(self, aid: str) -> Optional[AgentState]:
        return self._agents.get(aid)

    def list_agents(self) -> list:
        return [asdict(s) for s in self._agents.values()]


# ──────────────────────────── Sandbox ─────────────────────────────────────────


class Sandbox:
    """
    Agent 沙箱隔离。

    当前用 git worktree 实现文件系统隔离。
    扩展方向：容器 / firecracker / gVisor
    """

    def __init__(self, base_dir: str):
        self.base_dir = base_dir

    def create(self, name: str, branch: str = "") -> str:
        """创建独立沙箱（git worktree）"""
        sandbox_dir = os.path.join(self.base_dir, f".worktrees/{name}")
        subprocess.run(["git", "worktree", "add", sandbox_dir, branch or "main"],
                       capture_output=True, timeout=30)
        return sandbox_dir

    def destroy(self, name: str):
        sandbox_dir = os.path.join(self.base_dir, f".worktrees/{name}")
        subprocess.run(["git", "worktree", "remove", sandbox_dir],
                       capture_output=True, timeout=10)

    def get_path(self, name: str) -> str:
        return os.path.join(self.base_dir, f".worktrees/{name}")


# ──────────────────────────── CLI ─────────────────────────────────────────────


def cmd_run():
    if len(sys.argv) < 3:
        print("用法: executor.py run <agent_type> <prompt>")
        sys.exit(1)

    agent_type = sys.argv[2]
    prompt = sys.argv[3]
    timeout = 900
    model = "gemini-3.6-flash-high"

    i = 4
    while i < len(sys.argv):
        if sys.argv[i] == "--timeout" and i + 1 < len(sys.argv):
            timeout = int(sys.argv[i+1])
            i += 2
        elif sys.argv[i] == "--model" and i + 1 < len(sys.argv):
            model = sys.argv[i+1]
            i += 2
        else:
            i += 1

    config = ExecutionConfig(model=model, timeout=timeout)
    exec_result = Executor().run(agent_type, prompt, config)
    print(exec_result.to_json())


def cmd_tools():
    action = sys.argv[2] if len(sys.argv) > 2 else "list"
    if action == "list":
        print(json.dumps(standard_tools.list_tools(), indent=2, ensure_ascii=False))
    else:
        print(f"未知工具操作: {action}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "run":
        cmd_run()
    elif cmd == "tools":
        cmd_tools()
    else:
        print(f"未知命令: {cmd}")