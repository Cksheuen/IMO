"""
Orchestrate LangGraph Migration

Migrated from CC skill orchestrate to LangGraph StateGraph.

Usage:
    from migrated.orchestrate import run_orchestration

    # Basic usage
    final_state = await run_orchestration(
        task_description="Implement authentication",
        checkpoint=True
    )

    # With interrupt-based verification
    from migrated.orchestrate import run_verification_with_interrupt, resume_with_approval

    result = await run_verification_with_interrupt(graph, initial_state)
    # ... external approval ...
    final = await resume_with_approval(graph, thread_id, approved=True)
"""

from .state import (
    OrchestrateState,
    PRD,
    Feature,
    Subtask,
    DeltaContext,
    create_initial_state,
    create_feature,
    create_subtask,
    can_execute_subtask,
    is_subtask_ready,  # Legacy alias
    update_feature_result,
    update_subtask_result,
)

from .nodes import (
    collect_context_node,
    decompose_node,
    execute_subtask_node,
    aggregate_node,
    verify_node,
    fixer_node,
    format_subtask_prompt,
)

from .graph import (
    create_orchestrate_graph,
    compile_orchestrate_graph,
    compile_orchestrate_graph_with_checkpoint,
    run_orchestration,
)

from .verification import (
    VerificationGate,
    run_verification_with_interrupt,
    resume_with_approval,
    get_feature_summary,
    has_pending_features,
    has_failed_features,
    all_features_passed,
    get_exceeded_features,
    reviewer_verify_feature,
)

__all__ = [
    # State
    "OrchestrateState",
    "PRD",
    "Feature",
    "Subtask",
    "DeltaContext",
    "create_initial_state",
    "create_feature",
    "create_subtask",
    "is_subtask_ready",
    "update_feature_result",
    "update_subtask_result",
    # Nodes
    "collect_context_node",
    "decompose_node",
    "execute_subtask_node",
    "aggregate_node",
    "verify_node",
    "fixer_node",
    "format_subtask_prompt",
    # Graph
    "create_orchestrate_graph",
    "compile_orchestrate_graph",
    "compile_orchestrate_graph_with_checkpoint",
    "run_orchestration",
    # Verification
    "VerificationGate",
    "run_verification_with_interrupt",
    "resume_with_approval",
    "get_feature_summary",
    "has_pending_features",
    "has_failed_features",
    "all_features_passed",
    "get_exceeded_features",
    "reviewer_verify_feature",
]
