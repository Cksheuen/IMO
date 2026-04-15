"""
LangGraph State definitions for the Generator-Evaluator pattern.

迁移自: ~/.claude/rules/pattern/generator-evaluator-pattern.md
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional, TypedDict


ReviewStatus = Literal["pending", "passed", "failed", "needs_revision"]


class EvaluationFeedback(TypedDict):
    """Structured evaluator feedback for another generation pass."""

    summary: str
    issues: List[str]
    actionable_changes: List[str]


class EvaluationResult(TypedDict):
    """Evaluator output stored in state."""

    status: ReviewStatus
    score: int
    rationale: str
    feedback: Optional[EvaluationFeedback]


class GeneratorEvaluatorState(TypedDict):
    """Shared state for a generator/evaluator loop."""

    task: str
    acceptance_criteria: List[str]
    created_at: str
    draft_output: str
    generation_notes: List[str]
    evaluation_result: Optional[EvaluationResult]
    review_round: int
    max_rounds: int
    status: Literal["in_progress", "passed", "failed"]


def create_initial_state(
    task: str,
    acceptance_criteria: Optional[List[str]] = None,
    max_rounds: int = 3,
) -> GeneratorEvaluatorState:
    """Create an initial state for a new generator/evaluator run."""

    return GeneratorEvaluatorState(
        task=task,
        acceptance_criteria=acceptance_criteria or [],
        created_at=datetime.now().isoformat(),
        draft_output="",
        generation_notes=[],
        evaluation_result=None,
        review_round=0,
        max_rounds=max_rounds,
        status="in_progress",
    )
