"""
LangGraph StateGraph 定义 - Self-Verification Mechanism

迁移自: ~/.claude/rules/pattern/self-verification-mechanism.md

关键 LangGraph 特性使用:
1. interrupt_before - Verification Gate 暂停等待外部输入
2. Command(resume=...) - 恢复执行
3. 条件边 - Fixer Loop 循环
4. StateGraph - 状态图管理
"""

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from typing import Any, Dict, List, Literal, Optional

from .state import VerificationGateState, FeatureList
from .nodes import (
    gate_check,
    reviewer,
    implementer,
    mark_completed,
    mark_blocked,
    route_after_gate,
    route_after_reviewer,
    route_after_implementer,
)


# ==================== Graph 构建器 ====================

def build_verification_graph() -> StateGraph:
    """
    构建 Verification Gate 子图

    架构:

    ```
    START ──► gate_check ──► [决策]
                   │              │
                   │              ├─ exit_completed ──► mark_completed ──► END
                   │              │
                   │              ├─ exit_no_features ──► END
                   │              │
                   │              ├─ exit_max_attempts ──► mark_blocked ──► END
                   │              │
                   │              ├─ trigger_reviewer ──► reviewer ──► [决策]
                   │              │                                    │
                   │              │                                    ├─ 继续 ──► gate_check (循环)
                   │              │                                    │
                   │              │                                    └─ 完成 ──► mark_completed ──► END
                   │              │
                   │              └─ trigger_fixer ──► implementer ──► gate_check (循环)
                   │
                   ▼
              [interrupt_before]
              等待外部输入
    ```
    """
    # 创建 StateGraph
    builder = StateGraph(VerificationGateState)

    # 添加节点
    builder.add_node("gate_check", gate_check)
    builder.add_node("reviewer", reviewer)
    builder.add_node("implementer", implementer)
    builder.add_node("mark_completed", mark_completed)
    builder.add_node("mark_blocked", mark_blocked)

    # 设置入口
    builder.set_entry_point("gate_check")

    # 添加条件边 - Gate 检查后路由
    builder.add_conditional_edges(
        "gate_check",
        route_after_gate,
        {
            "reviewer": "reviewer",
            "implementer": "implementer",
            "mark_completed": "mark_completed",
            "mark_blocked": "mark_blocked",
        }
    )

    # 添加条件边 - Reviewer 后路由
    builder.add_conditional_edges(
        "reviewer",
        route_after_reviewer,
        {
            "gate_check": "gate_check",
            "mark_completed": "mark_completed",
        }
    )

    # 添加条件边 - Implementer 后路由（总是回到 gate_check）
    builder.add_conditional_edges(
        "implementer",
        route_after_implementer,
        {
            "gate_check": "gate_check",
        }
    )

    # 终止节点
    builder.add_edge("mark_completed", END)
    builder.add_edge("mark_blocked", END)

    return builder


# ==================== VerificationGate 类 ====================

class VerificationGate:
    """
    Verification Gate 包装类

    提供:
    1. interrupt_before + resume 模式
    2. 状态持久化
    3. 迭代计数保护
    """

    def __init__(
        self,
        max_iterations: int = 10,
        checkpointer: Optional[MemorySaver] = None,
    ):
        """
        初始化 Verification Gate

        Args:
            max_iterations: 最大全局迭代次数（防止无限循环）
            checkpointer: 状态持久化器
        """
        self.max_iterations = max_iterations
        self.checkpointer = checkpointer or MemorySaver()

        # 构建图
        builder = build_verification_graph()

        # 编译图 - 关键: interrupt_before=["reviewer", "implementer"]
        # 允许外部在执行验证/修复前注入输入
        self.graph = builder.compile(
            checkpointer=self.checkpointer,
            interrupt_before=["reviewer", "implementer"],
        )

    def run(
        self,
        initial_state: VerificationGateState,
        thread_id: str = "default",
    ) -> VerificationGateState:
        """
        运行 Verification Gate

        使用 LangGraph 的 invoke 方法，自动处理 interrupt 和 resume。

        Args:
            initial_state: 初始状态
            thread_id: 线程 ID（用于状态持久化）

        Returns:
            最终状态
        """
        config = {"configurable": {"thread_id": thread_id}}

        # 添加迭代计数保护
        state = {
            **initial_state,
            "iteration_count": 0,
        }

        while state["iteration_count"] < self.max_iterations:
            # 运行到下一个 interrupt 或 END
            result = self.graph.invoke(state, config)

            # 检查是否结束
            gate_decision = result.get("gate_decision", "")
            if gate_decision.startswith("exit") or gate_decision.startswith("trigger"):
                return result

            # 增加迭代计数
            state = {
                **result,
                "iteration_count": state["iteration_count"] + 1,
                "resume_input": None,
            }

        # 超过最大迭代次数
        return {
            **state,
            "gate_decision": "exit_max_attempts",
        }

    def resume_with_input(
        self,
        thread_id: str,
        node_name: Literal["reviewer", "implementer"],
        input_data: dict,
    ) -> VerificationGateState:
        """
        恢复执行并注入输入

        使用 Command(resume=...) 模式。

        Args:
            thread_id: 线程 ID
            node_name: 要恢复的节点
            input_data: 输入数据

        Returns:
            更新后的状态
        """
        current_state = self.get_state(thread_id)
        if not current_state:
            raise ValueError(f"No saved state found for thread_id={thread_id}")

        state_with_input = {
            **current_state,
            "resume_input": input_data,
        }

        if node_name == "reviewer":
            node_result = reviewer(state_with_input)
        else:
            node_result = implementer(state_with_input)

        next_state = {
            **current_state,
            **node_result,
            "resume_input": None,
            "iteration_count": current_state.get("iteration_count", 0) + 1,
        }
        return self.run(next_state, thread_id=thread_id)

    def get_state(self, thread_id: str) -> Optional[VerificationGateState]:
        """
        获取当前状态

        Args:
            thread_id: 线程 ID

        Returns:
            当前状态或 None
        """
        config = {"configurable": {"thread_id": thread_id}}
        snapshot = self.graph.get_state(config)
        return snapshot.values if snapshot else None


# ==================== 便捷函数 ====================

def create_initial_state(
    task_id: str,
    session_id: str,
    features: List[dict],
) -> VerificationGateState:
    """
    创建初始状态

    Args:
        task_id: 任务 ID
        session_id: 会话 ID
        features: feature 列表

    Returns:
        初始 VerificationGateState
    """
    from datetime import datetime
    from .state import Feature

    feature_list: FeatureList = {
        "task_id": task_id,
        "created_at": datetime.now().isoformat(),
        "session_id": session_id,
        "status": "in_progress",
        "features": [
            {
                "id": f["id"],
                "category": f.get("category", "functional"),
                "description": f["description"],
                "acceptance_criteria": f.get("acceptance_criteria", []),
                "verification_method": f.get("verification_method", "e2e"),
                "passes": None,
                "verified_at": None,
                "attempt_count": 0,
                "max_attempts": f.get("max_attempts", 3),
                "notes": "",
                "delta_context": None,
            }
            for f in features
        ],
        "summary": {
            "total": len(features),
            "passed": 0,
            "pending": len(features),
            "failed": 0,
        },
    }

    return {
        "feature_list": feature_list,
        "current_feature_id": None,
        "stop_hook_active": False,
        "iteration_count": 0,
        "gate_decision": None,
        "reviewer_output": None,
        "implementer_output": None,
        "resume_input": None,
    }


# ==================== 使用示例 ====================

if __name__ == "__main__":
    # 创建 Verification Gate
    gate = VerificationGate(max_iterations=10)

    # 创建初始状态
    initial_state = create_initial_state(
        task_id="auth-implementation",
        session_id="session-001",
        features=[
            {
                "id": "F001",
                "description": "User can login with email and password",
                "acceptance_criteria": [
                    "Navigate to /login page",
                    "Fill email field",
                    "Fill password field",
                    "Click submit",
                    "Verify redirect to dashboard",
                ],
                "verification_method": "e2e",
            },
        ],
    )

    # 运行（会中断在 reviewer 节点）
    result = gate.run(initial_state, thread_id="auth-001")
    print(f"Gate decision: {result['gate_decision']}")

    # 恢复执行并注入 reviewer 输入
    if result["gate_decision"] == "trigger_reviewer":
        updated = gate.resume_with_input(
            thread_id="auth-001",
            node_name="reviewer",
            input_data={
                "passes": True,
                "notes": None,
                "delta_context": None,
            },
        )
        print(f"Final state: {updated['gate_decision']}")
