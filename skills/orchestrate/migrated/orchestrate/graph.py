"""
Main Orchestrate StateGraph implementation.

Wires together all nodes into a complete orchestration graph.
"""
from typing import Literal, Optional
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command
from skills.migrated.shared_runtime.graph_helpers import compile_graph

from .state import OrchestrateState, DeltaContext
from .nodes import (
    collect_context_runnable,
    decompose_runnable,
    execute_subtask_runnable,
    aggregate_runnable,
    verify_runnable,
    fixer_runnable,
)


def create_orchestrate_graph():
    """Create the main orchestration StateGraph."""

    # Create the graph
    graph = StateGraph(OrchestrateState)

    # Add nodes
    graph.add_node("collect_context", collect_context_runnable)
    graph.add_node("decompose", decompose_runnable)
    graph.add_node("execute_subtask", execute_subtask_runnable)
    graph.add_node("aggregate", aggregate_runnable)
    graph.add_node("verify", verify_runnable)
    graph.add_node("fixer", fixer_runnable)

    # Define entry point
    graph.set_entry_point("collect_context")

    # Main flow edges
    graph.add_edge("collect_context", "decompose")

    # Conditional edge after decompose: check for user confirmation
    graph.add_conditional_edges(
        "decompose",
        should_proceed_after_decompose,
        {
            "execute": "execute_subtask",
            "wait": END,
        }
    )

    # Conditional edge after execute: check if more subtasks
    graph.add_conditional_edges(
        "execute_subtask",
        should_continue_execution,
        {
            "continue": "execute_subtask",
            "aggregate": "aggregate",
        }
    )

    # After aggregation, go to verification
    graph.add_edge("aggregate", "verify")

    # Conditional edge after verify: fixer loop or end
    graph.add_conditional_edges(
        "verify",
        should_run_fixer_loop,
        {
            "fix": "fixer",
            "end": END,
        }
    )

    # After fixer, go back to execute
    graph.add_edge("fixer", "execute_subtask")

    return graph


# Conditional edge functions

def should_proceed_after_decompose(state: OrchestrateState) -> Literal["execute", "wait"]:
    """Check if user has confirmed the decomposition plan."""
    if state.get("user_confirmed"):
        return "execute"
    return "wait"


def should_continue_execution(state: OrchestrateState) -> Literal["continue", "aggregate"]:
    """Check if there are more subtasks to execute."""
    subtasks = state.get("subtasks", [])

    # Check for pending subtasks with satisfied dependencies
    for subtask in subtasks:
        if subtask.get("status") == "pending":
            # Check dependencies
            deps_satisfied = all(
                any(s["id"] == dep_id and s.get("status") == "complete"
                    for s in subtasks)
                for dep_id in subtask.get("dependencies", [])
            )
            if deps_satisfied:
                return "continue"

    return "aggregate"


def should_run_fixer_loop(state: OrchestrateState) -> Literal["fix", "end"]:
    """Check if fixer loop should be activated."""
    features = state.get("features", [])

    # Check for failed features that can be retried
    for feature in features:
        if feature.get("passes") is False:
            if feature.get("attempt_count", 0) < feature.get("max_attempts", 3):
                return "fix"

    # Check if fixer loop is explicitly active
    if state.get("fixer_loop_active"):
        return "fix"

    return "end"


def compile_orchestrate_graph_with_checkpoint():
    """Compile the graph with memory checkpointing."""
    graph = create_orchestrate_graph()
    checkpointer = MemorySaver()
    return compile_graph(graph, checkpointer=checkpointer)


def compile_orchestrate_graph():
    """Compile the graph without checkpointing."""
    return compile_graph(create_orchestrate_graph())


def compile_orchestrate_graph_with_interrupt():
    """
    Compile with interrupt_before for verification gate.

    This matches CC's verification-gate.sh behavior:
    - Interrupt before verification
    - Allow external control to resume with approval
    """
    graph = create_orchestrate_graph()
    checkpointer = MemorySaver()
    return compile_graph(
        graph,
        checkpointer=checkpointer,
        interrupt_before=["verify"],
    )


# Resume function (for external control)

def resume_verification(
    compiled_graph,
    thread_id: str,
    approved: bool,
    feature_results: dict = None
):
    """
    Resume after verification interrupt.

    Equivalent to CC's:
    - verification-gate blocking exit
    - External Command(resume=...) to continue
    """
    if approved:
        return compiled_graph.invoke(
            Command(
                resume={"approved": True, "feature_results": feature_results},
                update={
                    "verification_approved": True,
                    "verification_feature_results": feature_results or {},
                },
            ),
            config={"configurable": {"thread_id": thread_id}}
        )
    else:
        return compiled_graph.invoke(
            Command(
                resume={"approved": False},
                update={
                    "verification_approved": False,
                    "verification_feature_results": {},
                },
            ),
            config={"configurable": {"thread_id": thread_id}}
        )


# Convenience function to run full orchestration

async def run_orchestration(
    task_description: str,
    task_id: str = None,
    llm=None,
    checkpoint: bool = False,
    thread_id: Optional[str] = None,
) -> OrchestrateState:
    """
    Run a complete orchestration.

    Args:
        task_description: The user's task description
        task_id: Optional task ID (auto-generated if not provided)
        llm: Optional LLM to use (defaults to Claude)
        checkpoint: Whether to use checkpointing for persistence
        thread_id: Optional thread ID required when using checkpoint persistence

    Returns:
        Final state after orchestration completes
    """
    from .state import create_initial_state

    # Create initial state
    initial_state = create_initial_state(task_description, task_id)
    initial_state["user_confirmed"] = True

    # Create and compile graph
    if checkpoint:
        graph = compile_orchestrate_graph_with_checkpoint()
    else:
        graph = compile_orchestrate_graph()

    # Run the graph
    invoke_config = None
    if checkpoint:
        invoke_config = {
            "configurable": {
                "thread_id": thread_id or task_id or f"orchestrate:{initial_state['created_at']}",
            }
        }

    result = await graph.ainvoke(initial_state, config=invoke_config)

    return result
