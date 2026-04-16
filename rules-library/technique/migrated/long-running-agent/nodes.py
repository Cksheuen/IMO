"""
LangGraph nodes for the long-running agent harness pattern.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from .state import FeatureItem, HandoffPayload, LongRunningAgentState, ProgressEvent


def initializer_node(state: LongRunningAgentState) -> dict:
    """Expand the task into a minimal feature list and init script."""

    if state["initialized"]:
        return {}

    features = [
        FeatureItem(
            id="F001",
            category="functional",
            description=f"Core delivery for: {state['task_request']}",
            steps=[
                "Restore prior state",
                "Implement one user-visible slice",
                "Verify the slice end-to-end",
            ],
            passes=None,
            notes="",
            attempt_count=0,
        )
    ]
    init_script = "npm run dev"
    progress = [
        ProgressEvent(
            timestamp=datetime.now().isoformat(),
            stage="initializer",
            summary="Created feature_list and init_script for the harness.",
        )
    ]
    return {
        "initialized": True,
        "init_script": init_script,
        "feature_list": features,
        "progress_log": [*state["progress_log"], *progress],
    }


def restore_context_node(state: LongRunningAgentState) -> dict:
    """Simulate reading progress notes and restoring context."""

    return {
        "progress_log": [
            *state["progress_log"],
            ProgressEvent(
                timestamp=datetime.now().isoformat(),
                stage="restore_context",
                summary="Restored progress log and prior task state.",
            ),
        ]
    }


def environment_check_node(state: LongRunningAgentState) -> dict:
    """Validate that the dev environment is still usable."""

    return {
        "environment_ok": True,
        "progress_log": [
            *state["progress_log"],
            ProgressEvent(
                timestamp=datetime.now().isoformat(),
                stage="environment_check",
                summary=f"Validated environment via init script: {state['init_script']}",
            ),
        ],
    }


def pick_feature_node(state: LongRunningAgentState) -> dict:
    """Pick exactly one unresolved feature."""

    for feature in state["feature_list"]:
        if feature["passes"] is not True:
            return {"current_feature_id": feature["id"]}
    return {"current_feature_id": None}


def implement_feature_node(state: LongRunningAgentState) -> dict:
    """Implement the currently selected feature."""

    current_id = state.get("current_feature_id")
    if not current_id:
        return {}

    updated = []
    for feature in state["feature_list"]:
        if feature["id"] == current_id:
            updated.append(
                {
                    **feature,
                    "notes": "Implementation pass completed in the current loop.",
                    "attempt_count": feature["attempt_count"] + 1,
                }
            )
        else:
            updated.append(feature)

    return {
        "feature_list": updated,
        "progress_log": [
            *state["progress_log"],
            ProgressEvent(
                timestamp=datetime.now().isoformat(),
                stage="implement",
                summary=f"Implemented feature {current_id}.",
            ),
        ],
    }


def verify_feature_node(state: LongRunningAgentState) -> dict:
    """Verify the current feature and update only its pass/fail status."""

    current_id = state.get("current_feature_id")
    if not current_id:
        return {}

    updated = []
    for feature in state["feature_list"]:
        if feature["id"] == current_id:
            updated.append(
                {
                    **feature,
                    "passes": True,
                    "notes": "Verified in harness demo.",
                }
            )
        else:
            updated.append(feature)

    return {"feature_list": updated}


def update_progress_node(state: LongRunningAgentState) -> dict:
    """Append loop progress and detect whether handoff is required."""

    next_iteration = state["iteration_count"] + 1
    unresolved = [f for f in state["feature_list"] if f["passes"] is not True]
    context_anxiety = next_iteration / state["max_iterations"] >= 0.7 and bool(unresolved)

    return {
        "iteration_count": next_iteration,
        "context_anxiety": context_anxiety,
        "progress_log": [
            *state["progress_log"],
            ProgressEvent(
                timestamp=datetime.now().isoformat(),
                stage="update_progress",
                summary=f"Recorded iteration {next_iteration}.",
            ),
        ],
    }


def create_handoff_node(state: LongRunningAgentState) -> dict:
    """Create a compact handoff payload for the next session."""

    completed = [f["description"] for f in state["feature_list"] if f["passes"] is True]
    unresolved = [f["description"] for f in state["feature_list"] if f["passes"] is not True]

    handoff = HandoffPayload(
        completed=completed,
        in_progress=unresolved[:1],
        next_steps=["Resume from the next unresolved feature."],
        key_decisions=[
            "Continue using the feature_list as the single progress source.",
            "Run environment validation before each feature attempt.",
        ],
    )
    return {"handoff": handoff, "status": "handoff_required"}


def mark_completed(state: LongRunningAgentState) -> dict:
    """Mark the harness as completed."""

    return {"status": "completed"}


def mark_blocked(state: LongRunningAgentState) -> dict:
    """Mark the harness as blocked."""

    return {"status": "blocked"}


def route_after_environment_check(
    state: LongRunningAgentState,
) -> Literal["pick_feature", "mark_blocked"]:
    """Stop early if the environment is broken."""

    return "pick_feature" if state.get("environment_ok") else "mark_blocked"


def route_after_pick_feature(
    state: LongRunningAgentState,
) -> Literal["implement_feature", "mark_completed"]:
    """Either run one more feature or finish."""

    return "implement_feature" if state.get("current_feature_id") else "mark_completed"


def route_after_progress_update(
    state: LongRunningAgentState,
) -> Literal["pick_feature", "create_handoff", "mark_completed"]:
    """Decide whether to continue, hand off, or finish."""

    unresolved = [f for f in state["feature_list"] if f["passes"] is not True]
    if not unresolved:
        return "mark_completed"
    if state.get("context_anxiety"):
        return "create_handoff"
    return "pick_feature"
