"""
Main Dual Review Loop StateGraph implementation.

Wires together all nodes into a complete review loop graph.

Migration Notes:
- CC's Step 1-7 flow becomes a StateGraph with conditional edges
- Loop control (max_rounds) becomes a conditional edge
- dual-review-report.json updates happen in State transitions
"""
from typing import Literal, Optional
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command, interrupt

from .state import DualReviewState, is_verdict_approved, can_continue_loop
from .nodes import (
    codex_review_runnable,
    evaluate_verdict_runnable,
    codex_rescue_runnable,
    cc_review_runnable,
    cc_fix_runnable,
    finalize_round_runnable,
    check_continue_runnable,
    generate_report_runnable,
)


def create_dual_review_graph():
    """
    Create the main Dual Review Loop StateGraph.

    Graph structure:
    ```
    START -> codex_review -> evaluate_verdict
                                     |
                     +---------------+---------------+
                     |                               |
                  (passed)                      (needs-attention)
                     |                               |
                     v                               v
                generate_report             codex_rescue
                                                   |
                                                   v
                                              cc_review
                                                   |
                                                   v
                                               cc_fix
                                                   |
                                                   v
                                            finalize_round
                                                   |
                                                   v
                                           check_continue
                                                   |
                     +---------------+---------------+
                     |                               |
                (continue)                     (max_rounds)
                     |                               |
                     v                               v
                codex_review                  generate_report
                     |                               |
                     +-------------------------------+
                                                     |
                                                     v
                                                    END
    ```
    """
    # Create the graph
    graph = StateGraph(DualReviewState)

    # Add nodes
    graph.add_node("codex_review", codex_review_runnable)
    graph.add_node("evaluate_verdict", evaluate_verdict_runnable)
    graph.add_node("codex_rescue", codex_rescue_runnable)
    graph.add_node("cc_review", cc_review_runnable)
    graph.add_node("cc_fix", cc_fix_runnable)
    graph.add_node("finalize_round", finalize_round_runnable)
    graph.add_node("check_continue", check_continue_runnable)
    graph.add_node("generate_report", generate_report_runnable)

    # Define entry point
    graph.set_entry_point("codex_review")

    # Main flow edges
    graph.add_edge("codex_review", "evaluate_verdict")

    # Conditional edge after evaluate_verdict: passed or needs-attention
    graph.add_conditional_edges(
        "evaluate_verdict",
        route_after_verdict,
        {
            "passed": "generate_report",
            "needs_attention": "codex_rescue",
        }
    )

    # After rescue, go to CC review
    graph.add_edge("codex_rescue", "cc_review")

    # After CC review, go to CC fix
    graph.add_edge("cc_review", "cc_fix")

    # After CC fix, finalize the round
    graph.add_edge("cc_fix", "finalize_round")

    # After finalize, check if loop continues
    graph.add_edge("finalize_round", "check_continue")

    # Conditional edge after check_continue: continue or end
    graph.add_conditional_edges(
        "check_continue",
        route_after_check_continue,
        {
            "continue": "codex_review",
            "end": "generate_report",
        }
    )

    # After generate_report, end
    graph.add_edge("generate_report", END)

    return graph


# Conditional edge functions

def route_after_verdict(state: DualReviewState) -> Literal["passed", "needs_attention"]:
    """
    Route based on Codex review verdict.

    Equivalent to CC's Step 2: 判断是否通过.
    """
    if state.get("status") == "passed":
        return "passed"
    return "needs_attention"


def route_after_check_continue(state: DualReviewState) -> Literal["continue", "end"]:
    """
    Route based on whether loop should continue.

    Equivalent to CC's Step 7: 循环判断.
    """
    # Check if max rounds reached
    if state.get("status") == "max_rounds_reached":
        return "end"

    # Check if we can continue
    if can_continue_loop(state):
        return "continue"

    return "end"


def compile_dual_review_graph_with_checkpoint():
    """Compile the graph with memory checkpointing."""
    graph = create_dual_review_graph()
    checkpointer = MemorySaver()
    return graph.compile(checkpointer=checkpointer)


def compile_dual_review_graph_with_interrupt():
    """
    Compile with interrupt_before for verification gate.

    This matches CC's verification-gate behavior:
    - Interrupt before each round's fix
    - Allow external control to approve fixes
    """
    graph = create_dual_review_graph()
    checkpointer = MemorySaver()
    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["cc_fix"]  # Interrupt before applying fixes
    )


# Resume function (for external control)

def resume_after_fix(
    compiled_graph,
    thread_id: str,
    approved: bool,
    fix_results: dict = None
):
    """
    Resume after fix interrupt.

    Equivalent to CC's:
    - verification-gate blocking exit
    - External Command(resume=...) to continue
    """
    if approved:
        return compiled_graph.invoke(
            Command(
                resume={"approved": True, "fix_results": fix_results},
                update={"fix_approved": True},
            ),
            config={"configurable": {"thread_id": thread_id}}
        )
    else:
        return compiled_graph.invoke(
            Command(
                resume={"approved": False},
                update={"fix_approved": False},
            ),
            config={"configurable": {"thread_id": thread_id}}
        )


# Convenience function to run full review loop

async def run_dual_review_loop(
    max_rounds: int = 3,
    scope: str = "auto",
    base: str = None,
    skip_rescue: bool = False,
    checkpoint: bool = False,
    thread_id: Optional[str] = None,
) -> DualReviewState:
    """
    Run a complete dual review loop.

    Args:
        max_rounds: Maximum number of review rounds (default: 3)
        scope: Review scope - auto, working-tree, branch (default: auto)
        base: Base ref for comparison (optional)
        skip_rescue: Skip Codex rescue step (default: False)
        checkpoint: Whether to use checkpointing for persistence
        thread_id: Optional thread ID required when using checkpoint persistence

    Returns:
        Final state after review loop completes
    """
    from .state import create_initial_state

    # Create initial state
    initial_state = create_initial_state(
        max_rounds=max_rounds,
        scope=scope,
        base=base,
        skip_rescue=skip_rescue
    )

    # Create and compile graph
    if checkpoint:
        graph = compile_dual_review_graph_with_checkpoint()
    else:
        graph = create_dual_review_graph().compile()

    # Run the graph
    invoke_config = None
    if checkpoint:
        invoke_config = {
            "configurable": {
                "thread_id": thread_id or f"dual-review:{initial_state['created_at']}",
            }
        }

    result = await graph.ainvoke(initial_state, config=invoke_config)

    return result


# Integration with feature-list.json (CC's verification-gate)

def sync_with_feature_list(state: DualReviewState, feature_list_path: str) -> None:
    """
    Sync dual review results with feature-list.json.

    Equivalent to CC's 与 feature-list.json 集成.

    Rules:
    - Codex review found critical/high → feature.passes = false
    - CC implementer fixed → feature.passes = null (pending next round)
    - Final pass → feature.passes = true
    """
    import json

    try:
        with open(feature_list_path, 'r') as f:
            feature_list = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return

    # Update features based on current state
    review = state.get("current_codex_review")
    fix = state.get("current_cc_fix")

    if review and has_critical_or_high_findings(state):
        # Mark related features as failed
        for feature in feature_list.get("features", []):
            # In production, would match findings to features
            feature["passes"] = False

    elif fix and fix.get("fixed", 0) > 0:
        # Reset features for next round verification
        for feature in feature_list.get("features", []):
            if feature.get("passes") is False:
                feature["passes"] = None  # Pending verification

    elif state.get("status") == "passed":
        # All features passed
        for feature in feature_list.get("features", []):
            feature["passes"] = True

    # Write back
    with open(feature_list_path, 'w') as f:
        json.dump(feature_list, f, indent=2)


def has_critical_or_high_findings(state: DualReviewState) -> bool:
    """Check if current review has critical or high findings."""
    from .state import has_critical_or_high_findings as check
    return check(state)
