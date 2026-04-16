"""Shared reviewer / implementer protocol types and helpers."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict

from .types import DeltaContext


class ReviewIssue(TypedDict, total=False):
    """Single issue confirmed by a reviewer."""

    severity: str
    title: str
    file: str
    line_start: int
    line_end: int
    recommendation: str
    delta_context: DeltaContext


class ReviewerAgentResult(TypedDict):
    """Common shape for reviewer-like outputs."""

    confirmed_issues: int
    false_positives: int
    issues: List[ReviewIssue]
    raw_output: str


class ImplementerAgentResult(TypedDict):
    """Common shape for implementer-like outputs."""

    fixed: int
    commits: List[str]
    files_changed: List[str]
    raw_output: str


def build_delta_context(
    *,
    file: str,
    lines: str,
    code_snippet: str,
    root_cause: str,
    target: str,
    details: str,
    files_to_read: Optional[List[str]] = None,
    files_to_skip: Optional[List[str]] = None,
    action: str = "fix",
    reference_example: Optional[str] = None,
) -> DeltaContext:
    """Construct a normalized delta_context payload."""

    return DeltaContext(
        problem_location={
            "file": file,
            "lines": lines,
            "code_snippet": code_snippet,
        },
        root_cause=root_cause,
        fix_suggestion={
            "action": action,
            "target": target,
            "details": details,
            "reference_example": reference_example,
        },
        files_to_read=files_to_read or [],
        files_to_skip=files_to_skip or [],
    )


def build_review_issue(
    *,
    severity: str,
    title: str,
    file: str,
    line_start: int,
    line_end: int,
    recommendation: str,
    delta_context: DeltaContext,
    extra_fields: Optional[Dict[str, Any]] = None,
) -> ReviewIssue:
    """Construct a normalized reviewer issue with optional extra fields."""

    issue: ReviewIssue = {
        "severity": severity,
        "title": title,
        "file": file,
        "line_start": line_start,
        "line_end": line_end,
        "recommendation": recommendation,
        "delta_context": delta_context,
    }
    if extra_fields:
        issue.update(extra_fields)
    return issue
