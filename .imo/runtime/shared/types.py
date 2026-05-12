"""Shared typed state fragments reused across migrated runtimes."""

from __future__ import annotations

from typing import List, Optional, TypedDict


class ProblemLocation(TypedDict):
    """Precise source location for a detected issue."""

    file: str
    lines: str
    code_snippet: str


class FixSuggestion(TypedDict):
    """Actionable remediation guidance from a reviewer/evaluator."""

    action: str
    target: str
    details: str
    reference_example: Optional[str]


class DeltaContext(TypedDict):
    """Structured repair context passed from evaluator to implementer."""

    problem_location: ProblemLocation
    root_cause: str
    fix_suggestion: FixSuggestion
    files_to_read: List[str]
    files_to_skip: List[str]


class RetryableFeature(TypedDict):
    """Minimal feature shape that supports iterative execution."""

    id: str
    category: str
    description: str
    passes: Optional[bool]
    notes: str
    attempt_count: int


class ReviewableFeature(RetryableFeature):
    """Feature shape used by verification-oriented runtimes."""

    acceptance_criteria: List[str]
    verification_method: str
    verified_at: Optional[str]
    max_attempts: int


class ProgressEvent(TypedDict):
    """Cross-session progress log entry."""

    timestamp: str
    stage: str
    summary: str


class HandoffPayload(TypedDict):
    """Compact payload for context reset or session handoff."""

    completed: List[str]
    in_progress: List[str]
    next_steps: List[str]
    key_decisions: List[str]
