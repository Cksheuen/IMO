"""
LangGraph State definitions for long-running agent harnesses.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional, TypedDict

from skills.migrated.shared_runtime.types import HandoffPayload, ProgressEvent, RetryableFeature


class FeatureItem(RetryableFeature):
    """Single feature expanded from the original user request."""

    steps: List[str]


class LongRunningAgentState(TypedDict):
    """State for the initializer + coding-agent harness."""

    task_request: str
    created_at: str
    initialized: bool
    init_script: str
    feature_list: List[FeatureItem]
    progress_log: List[ProgressEvent]
    current_feature_id: Optional[str]
    environment_ok: bool
    context_anxiety: bool
    handoff: Optional[HandoffPayload]
    iteration_count: int
    max_iterations: int
    status: Literal["in_progress", "completed", "blocked", "handoff_required"]


def create_initial_state(
    task_request: str,
    max_iterations: int = 8,
) -> LongRunningAgentState:
    """Create the initial harness state."""

    return LongRunningAgentState(
        task_request=task_request,
        created_at=datetime.now().isoformat(),
        initialized=False,
        init_script="",
        feature_list=[],
        progress_log=[],
        current_feature_id=None,
        environment_ok=False,
        context_anxiety=False,
        handoff=None,
        iteration_count=0,
        max_iterations=max_iterations,
        status="in_progress",
    )
