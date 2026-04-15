"""
LangGraph graph definition for the long-running agent harness.
"""

from __future__ import annotations

from typing import Optional

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from skills.migrated.shared_runtime.graph_helpers import compile_graph

from .nodes import (
    create_handoff_node,
    environment_check_node,
    implement_feature_node,
    initializer_node,
    mark_blocked,
    mark_completed,
    pick_feature_node,
    restore_context_node,
    route_after_environment_check,
    route_after_pick_feature,
    route_after_progress_update,
    update_progress_node,
    verify_feature_node,
)
from .state import LongRunningAgentState, create_initial_state


def build_long_running_graph() -> StateGraph:
    """Build the initializer + coding-agent loop graph."""

    graph = StateGraph(LongRunningAgentState)
    graph.add_node("initializer", initializer_node)
    graph.add_node("restore_context", restore_context_node)
    graph.add_node("environment_check", environment_check_node)
    graph.add_node("pick_feature", pick_feature_node)
    graph.add_node("implement_feature", implement_feature_node)
    graph.add_node("verify_feature", verify_feature_node)
    graph.add_node("update_progress", update_progress_node)
    graph.add_node("create_handoff", create_handoff_node)
    graph.add_node("mark_completed", mark_completed)
    graph.add_node("mark_blocked", mark_blocked)

    graph.set_entry_point("initializer")
    graph.add_edge("initializer", "restore_context")
    graph.add_edge("restore_context", "environment_check")
    graph.add_conditional_edges(
        "environment_check",
        route_after_environment_check,
        {
            "pick_feature": "pick_feature",
            "mark_blocked": "mark_blocked",
        },
    )
    graph.add_conditional_edges(
        "pick_feature",
        route_after_pick_feature,
        {
            "implement_feature": "implement_feature",
            "mark_completed": "mark_completed",
        },
    )
    graph.add_edge("implement_feature", "verify_feature")
    graph.add_edge("verify_feature", "update_progress")
    graph.add_conditional_edges(
        "update_progress",
        route_after_progress_update,
        {
            "pick_feature": "pick_feature",
            "create_handoff": "create_handoff",
            "mark_completed": "mark_completed",
        },
    )
    graph.add_edge("create_handoff", END)
    graph.add_edge("mark_completed", END)
    graph.add_edge("mark_blocked", END)
    return graph


class LongRunningHarness:
    """Thin runtime wrapper for the migrated long-running graph."""

    def __init__(self, checkpointer: Optional[MemorySaver] = None):
        self._builder = build_long_running_graph()
        self._checkpointer = checkpointer

    def compile(self):
        """Compile the graph, optionally with a checkpointer."""

        return compile_graph(self._builder, checkpointer=self._checkpointer)


__all__ = [
    "LongRunningHarness",
    "build_long_running_graph",
    "create_initial_state",
]
