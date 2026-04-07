"""
Self-Verification Mechanism - LangGraph Implementation

迁移自 Claude Code 的 self-verification-mechanism.md

使用方式:

    from rules.pattern.migrated.self_verification import VerificationGate, create_initial_state

    # 创建 gate
    gate = VerificationGate(max_iterations=10)

    # 创建初始状态
    initial_state = create_initial_state(
        task_id="auth-implementation",
        session_id="session-001",
        features=[...],
    )

    # 运行
    result = gate.run(initial_state, thread_id="auth-001")

    # 恢复执行（如果被中断）
    if result["gate_decision"] == "trigger_reviewer":
        result = gate.resume_with_input(
            thread_id="auth-001",
            node_name="reviewer",
            input_data={"passes": True},
        )

模块结构:
- state.py: State 定义 (FeatureList, DeltaContext, etc.)
- nodes.py: 节点函数 (gate_check, reviewer, implementer)
- graph.py: StateGraph 定义和 VerificationGate 类
"""

from .state import (
    Feature,
    FeatureList,
    FeatureListSummary,
    DeltaContext,
    ProblemLocation,
    FixSuggestion,
    VerificationGateState,
    VerificationStatus,
)

from .nodes import (
    gate_check,
    reviewer,
    implementer,
    mark_completed,
    mark_blocked,
)

from .graph import (
    VerificationGate,
    build_verification_graph,
    create_initial_state,
)

__all__ = [
    # State types
    "Feature",
    "FeatureList",
    "FeatureListSummary",
    "DeltaContext",
    "ProblemLocation",
    "FixSuggestion",
    "VerificationGateState",
    "VerificationStatus",
    # Nodes
    "gate_check",
    "reviewer",
    "implementer",
    "mark_completed",
    "mark_blocked",
    # Graph
    "VerificationGate",
    "build_verification_graph",
    "create_initial_state",
]
