"""
Main StateGraph implementation for the multi-model-agent migration.

The graph intentionally models only the routing policy layer.
"""
from __future__ import annotations

from typing import Literal, Optional

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.types import Command

from .nodes import (
    analyze_task_runnable,
    apply_fallback_runnable,
    select_model_runnable,
    summarize_runnable,
)
from .state import MultiModelState, create_initial_state


def create_multi_model_graph():
    """Create the routing graph."""
    graph = StateGraph(MultiModelState)

    graph.add_node("analyze_task", analyze_task_runnable)
    graph.add_node("select_model", select_model_runnable)
    graph.add_node("apply_fallback", apply_fallback_runnable)
    graph.add_node("summarize", summarize_runnable)

    graph.set_entry_point("analyze_task")
    graph.add_edge("analyze_task", "select_model")
    graph.add_conditional_edges(
        "select_model",
        route_after_selection,
        {
            "fallback": "apply_fallback",
            "summarize": "summarize",
        },
    )
    graph.add_edge("apply_fallback", "summarize")
    graph.add_edge("summarize", END)

    return graph


def route_after_selection(state: MultiModelState) -> Literal["fallback", "summarize"]:
    """Decide whether to apply fallback before summarizing."""
    decision = state.get("routing_decision")
    monitoring = state.get("monitoring_snapshot")

    if not decision or not monitoring:
        return "summarize"

    if state.get("force_fallback"):
        return "fallback"

    if decision["selected_model"] not in monitoring["available_models"]:
        return "fallback"

    if not monitoring["healthy"]:
        return "fallback"

    return "summarize"


def compile_multi_model_graph():
    """Compile the graph without persistence."""
    return create_multi_model_graph().compile()


def compile_multi_model_graph_with_checkpoint():
    """Compile the graph with MemorySaver persistence."""
    graph = create_multi_model_graph()
    checkpointer = MemorySaver()
    return graph.compile(checkpointer=checkpointer)


def compile_multi_model_graph_with_interrupt():
    """
    Compile the graph with an interrupt before fallback.

    This preserves room for future human approval before changing the route.
    """
    graph = create_multi_model_graph()
    checkpointer = MemorySaver()
    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["apply_fallback"],
    )


def resume_after_fallback_review(
    compiled_graph,
    thread_id: str,
    approved: bool,
    override_force_fallback: Optional[bool] = None,
):
    """Resume execution after the optional fallback interrupt."""
    payload = {"approved": approved}
    if override_force_fallback is not None:
        payload["force_fallback"] = override_force_fallback
    return compiled_graph.invoke(
        Command(resume=payload),
        config={"configurable": {"thread_id": thread_id}},
    )


async def run_multi_model_routing(
    task_request: str,
    agent_role: str = "implementer",
    current_agent_model: Optional[str] = None,
    force_fallback: bool = False,
    checkpoint: bool = False,
) -> MultiModelState:
    """Convenience helper to run the routing graph end to end."""
    initial_state = create_initial_state(
        task_request=task_request,
        agent_role=agent_role,
        current_agent_model=current_agent_model,
        force_fallback=force_fallback,
    )

    compiled_graph = (
        compile_multi_model_graph_with_checkpoint()
        if checkpoint
        else compile_multi_model_graph()
    )
    return await compiled_graph.ainvoke(initial_state)
