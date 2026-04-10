"""
Verification and Fixer Loop implementation.

Implements CC's verification-gate + Fixer Loop pattern.
"""
from typing import Dict, Any, Optional, List
from langgraph.types import Command, interrupt
from langgraph.checkpoint.memory import MemorySaver

from .state import (
    OrchestrateState,
    DeltaContext,
    update_feature_result,
)


class VerificationGate:
    """
    Verification gate that blocks exit until all features pass.

    Equivalent to CC's verification-gate.sh hook.
    """

    def __init__(self, max_attempts: int = 3):
        self.max_attempts = max_attempts

    def check(self, state: OrchestrateState) -> Dict[str, Any]:
        """
        Check if verification should block exit.

        Returns:
            Dict with 'block' flag and reason
        """
        # No features = no block
        if not state.get("features"):
            return {"block": False}

        # Check for pending features
        pending = [f for f in state["features"] if f.get("passes") is None]
        if pending:
            return {
                "block": True,
                "reason": f"{len(pending)} features pending verification",
                "action": "spawn_reviewer"
            }

        # Check for failed features under max_attempts
        failed = [
            f for f in state["features"]
            if f.get("passes") is False
            and f.get("attempt_count", 0) < self.max_attempts
        ]
        if failed:
            return {
                "block": True,
                "reason": f"{len(failed)} features need fixing",
                "action": "spawn_fixer"
            }

        # Check for exceeded max_attempts
        exceeded = [
            f for f in state["features"]
            if f.get("passes") is False
            and f.get("attempt_count", 0) >= self.max_attempts
        ]
        if exceeded:
            return {
                "block": False,  # Allow exit, but log warning
                "reason": f"{len(exceeded)} features exceeded max attempts",
                "action": "manual_intervention_required"
            }

        # All passed
        return {"block": False}


class FixerLoop:
    """
    Fixer loop that handles failed verifications.

    Equivalent to CC's delta_context -> implementer loop.
    """

    def __init__(self, max_iterations: int = 5):
        self.max_iterations = max_iterations
        self.verification_gate = VerificationGate()

    def create_delta_context(
        self,
        state: OrchestrateState,
        failed_feature_id: str
    ) -> Optional[DeltaContext]:
        """
        Create delta context for fixer.

        This is what the reviewer agent produces in CC.
        """
        feature = next(
            (f for f in state["features"] if f["id"] == failed_feature_id),
            None
        )

        if not feature:
            return None

        # In production, this would be populated by reviewer agent
        # Demo: Create a placeholder delta context
        return DeltaContext(
            problem_location={
                "file": "(to be determined)",
                "lines": "(to be determined)",
                "code_snippet": "(to be determined)",
            },
            root_cause="Feature verification failed",
            fix_suggestion={
                "action": "fix",
                "target": feature["description"],
                "details": "Address the failing acceptance criteria",
                "reference_example": None,
            },
            files_to_read=[],
            files_to_skip=[],
        )

    def should_continue_fixing(self, state: OrchestrateState) -> bool:
        """Check if fixer loop should continue."""
        gate_result = self.verification_gate.check(state)

        # Continue if blocked and under max iterations
        if gate_result.get("block") and gate_result.get("action") == "spawn_fixer":
            iteration = state.get("fixer_iteration", 0)
            return iteration < self.max_iterations

        return False

    def get_next_feature_to_fix(self, state: OrchestrateState) -> Optional[str]:
        """Get the next feature ID that needs fixing."""
        for feature in state.get("features", []):
            if feature.get("passes") is False:
                if feature.get("attempt_count", 0) < self.max_iterations:
                    return feature["id"]
        return None


# Interrupt-based verification flow

async def run_verification_with_interrupt(
    graph,
    initial_state: OrchestrateState,
    thread_id: str = "default"
) -> OrchestrateState:
    """
    Run verification with interrupt pattern.

    This mimics CC's:
    1. Run until verification node
    2. Interrupt (stop before exiting)
    3. External approval
    4. Resume with Command(resume=...)
    """
    compiled = graph
    if not hasattr(compiled, "get_state"):
        checkpointer = MemorySaver()
        compiled = graph.compile(
            checkpointer=checkpointer,
            interrupt_before=["verify"]
        )

    # Run until interrupt
    result = await compiled.ainvoke(
        initial_state,
        config={"configurable": {"thread_id": thread_id}}
    )

    return result


async def resume_with_approval(
    graph,
    thread_id: str,
    approved: bool,
    feature_results: Optional[Dict[str, bool]] = None
) -> OrchestrateState:
    """
    Resume verification with external approval.

    Args:
        graph: The compiled graph
        thread_id: Thread ID to resume
        approved: Whether to approve
        feature_results: Optional per-feature results

    Returns:
        Updated state
    """
    command = Command(
        resume={
            "approved": approved,
            "feature_results": feature_results or {},
        },
        update={
            "verification_approved": approved,
            "verification_feature_results": feature_results or {},
        },
    )
    return await graph.ainvoke(
        command,
        config={"configurable": {"thread_id": thread_id}}
    )


# Feature status helpers

def get_feature_summary(state: OrchestrateState) -> Dict[str, int]:
    """Get summary of feature status."""
    features = state.get("features", [])

    return {
        "total": len(features),
        "passed": len([f for f in features if f.get("passes") is True]),
        "failed": len([f for f in features if f.get("passes") is False]),
        "pending": len([f for f in features if f.get("passes") is None]),
    }


def has_pending_features(state: OrchestrateState) -> bool:
    """Check if there are pending features."""
    summary = get_feature_summary(state)
    return summary["pending"] > 0


def has_failed_features(state: OrchestrateState) -> bool:
    """Check if there are failed features."""
    summary = get_feature_summary(state)
    return summary["failed"] > 0


def all_features_passed(state: OrchestrateState) -> bool:
    """Check if all features have passed."""
    summary = get_feature_summary(state)
    return summary["total"] > 0 and summary["pending"] == 0 and summary["failed"] == 0


def get_exceeded_features(state: OrchestrateState, max_attempts: int = 3) -> List[str]:
    """Get feature IDs that exceeded max attempts."""
    return [
        f["id"]
        for f in state.get("features", [])
        if f.get("passes") is False
        and f.get("attempt_count", 0) >= max_attempts
    ]


# Integration with reviewer agent

async def reviewer_verify_feature(
    state: OrchestrateState,
    feature_id: str,
    verification_result: bool,
    notes: str = "",
    delta_context: Optional[DeltaContext] = None
) -> Dict[str, Any]:
    """
    Update state after reviewer verification.

    This is called by the reviewer agent after verifying a feature.
    """
    return update_feature_result(
        state,
        feature_id,
        passes=verification_result,
        notes=notes,
        delta_context=delta_context if not verification_result else None
    )
