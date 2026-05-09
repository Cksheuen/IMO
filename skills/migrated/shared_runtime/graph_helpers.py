"""Helpers for compiling migrated LangGraph runtimes consistently."""

from __future__ import annotations

from typing import Optional, Sequence

from langgraph.checkpoint.memory import MemorySaver


def compile_graph(builder, checkpointer: Optional[MemorySaver] = None, interrupt_before: Optional[Sequence[str]] = None):
    """
    Compile a StateGraph with consistent checkpoint/interrupt semantics.

    - No `checkpointer` and no `interrupt_before`: plain compile
    - `checkpointer` provided: compile with that checkpointer
    - `interrupt_before` provided without a checkpointer: create MemorySaver automatically
    """

    if checkpointer is None and not interrupt_before:
        return builder.compile()

    active_checkpointer = checkpointer or MemorySaver()
    kwargs = {"checkpointer": active_checkpointer}
    if interrupt_before:
        kwargs["interrupt_before"] = list(interrupt_before)
    return builder.compile(**kwargs)
