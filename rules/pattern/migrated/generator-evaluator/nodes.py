"""
LangGraph nodes for the Generator-Evaluator pattern.

These nodes intentionally keep the LLM/tool layer abstract so the migration
focuses on control flow rather than provider-specific integrations.
"""

from __future__ import annotations

from typing import Literal

from .state import EvaluationFeedback, EvaluationResult, GeneratorEvaluatorState


def generator_node(state: GeneratorEvaluatorState) -> dict:
    """
    Produce a draft.

    The placeholder implementation shows how a generator node can incorporate
    evaluator feedback from the previous round without hard-wiring a provider.
    """

    previous_feedback = (state.get("evaluation_result") or {}).get("feedback")
    round_number = state["review_round"] + 1

    if previous_feedback:
        issue_summary = "; ".join(previous_feedback["actionable_changes"])
        draft_output = (
            f"Draft round {round_number} for: {state['task']}\n"
            f"Revisions applied: {issue_summary}"
        )
        note = f"round {round_number}: revised draft using evaluator feedback"
    else:
        draft_output = f"Draft round {round_number} for: {state['task']}"
        note = f"round {round_number}: created initial draft"

    return {
        "draft_output": draft_output,
        "review_round": round_number,
        "generation_notes": [*state["generation_notes"], note],
    }


def evaluator_node(state: GeneratorEvaluatorState) -> dict:
    """
    Evaluate the current draft against acceptance criteria.

    Real implementations would call an LLM judge or external verifier here.
    This scaffold keeps the result deterministic and state-driven.
    """

    criteria = state.get("acceptance_criteria", [])
    draft_output = state.get("draft_output", "")

    if not criteria:
        result = EvaluationResult(
            status="passed",
            score=10,
            rationale="No explicit acceptance criteria were provided.",
            feedback=None,
        )
    else:
        missing = [criterion for criterion in criteria if criterion not in draft_output]
        if missing and state["review_round"] < state["max_rounds"]:
            result = EvaluationResult(
                status="needs_revision",
                score=max(1, 10 - len(missing) * 2),
                rationale="The draft does not yet satisfy all acceptance criteria.",
                feedback=EvaluationFeedback(
                    summary="Revise the draft to cover the missing criteria.",
                    issues=missing,
                    actionable_changes=[
                        f"Address criterion: {criterion}" for criterion in missing
                    ],
                ),
            )
        elif missing:
            result = EvaluationResult(
                status="failed",
                score=max(1, 10 - len(missing) * 2),
                rationale="The loop reached the maximum number of review rounds.",
                feedback=EvaluationFeedback(
                    summary="Human intervention is needed.",
                    issues=missing,
                    actionable_changes=[
                        f"Manually resolve criterion: {criterion}"
                        for criterion in missing
                    ],
                ),
            )
        else:
            result = EvaluationResult(
                status="passed",
                score=10,
                rationale="The draft satisfies all acceptance criteria.",
                feedback=None,
            )

    return {"evaluation_result": result}


def apply_feedback(state: GeneratorEvaluatorState) -> dict:
    """Prepare the state for another generation pass."""

    result = state.get("evaluation_result")
    if not result or not result.get("feedback"):
        return {}

    summary = result["feedback"]["summary"]
    return {
        "generation_notes": [
            *state["generation_notes"],
            f"feedback queued: {summary}",
        ]
    }


def mark_passed(state: GeneratorEvaluatorState) -> dict:
    """Mark the loop as completed successfully."""

    return {"status": "passed"}


def mark_failed(state: GeneratorEvaluatorState) -> dict:
    """Mark the loop as failed and requiring human intervention."""

    return {"status": "failed"}


def route_after_evaluator(
    state: GeneratorEvaluatorState,
) -> Literal["apply_feedback", "mark_passed", "mark_failed"]:
    """Route based on evaluator verdict."""

    result = state.get("evaluation_result")
    if not result:
        return "mark_failed"

    status = result["status"]
    if status == "passed":
        return "mark_passed"
    if status == "failed":
        return "mark_failed"
    return "apply_feedback"
