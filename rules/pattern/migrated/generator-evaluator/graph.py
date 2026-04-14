"""
LangGraph graph definition for the Generator-Evaluator pattern.
"""

from __future__ import annotations

from typing import Optional

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from skills.migrated.shared_runtime.graph_helpers import compile_graph

from .nodes import (
    apply_feedback,
    evaluator_node,
    generator_node,
    mark_failed,
    mark_passed,
    route_after_evaluator,
)
from .state import GeneratorEvaluatorState, create_initial_state


def build_generator_evaluator_graph() -> StateGraph:
    """Build the generator/evaluator feedback loop graph."""

    graph = StateGraph(GeneratorEvaluatorState)
    graph.add_node("generator", generator_node)
    graph.add_node("evaluator", evaluator_node)
    graph.add_node("apply_feedback", apply_feedback)
    graph.add_node("mark_passed", mark_passed)
    graph.add_node("mark_failed", mark_failed)

    graph.set_entry_point("generator")
    graph.add_edge("generator", "evaluator")
    graph.add_conditional_edges(
        "evaluator",
        route_after_evaluator,
        {
            "apply_feedback": "apply_feedback",
            "mark_passed": "mark_passed",
            "mark_failed": "mark_failed",
        },
    )
    graph.add_edge("apply_feedback", "generator")
    graph.add_edge("mark_passed", END)
    graph.add_edge("mark_failed", END)
    return graph


class GeneratorEvaluatorLoop:
    """Thin runtime wrapper for compiling and invoking the graph."""

    def __init__(self, checkpointer: Optional[MemorySaver] = None):
        self._builder = build_generator_evaluator_graph()
        self._checkpointer = checkpointer

    def compile(self):
        """Compile the graph, optionally with a checkpointer."""

        return compile_graph(self._builder, checkpointer=self._checkpointer)


__all__ = [
    "GeneratorEvaluatorLoop",
    "build_generator_evaluator_graph",
    "create_initial_state",
]
