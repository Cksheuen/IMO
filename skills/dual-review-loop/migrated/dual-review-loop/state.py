"""
State definitions for Dual Review Loop LangGraph migration.

Maps CC's dual-review-report.json to LangGraph State.

Migration Notes:
- dual-review-report.json becomes State fields
- max_rounds becomes a configuration parameter
- rounds[] becomes an accumulated list
- CC/Codex agent interactions become nodes
"""
from typing import TypedDict, Annotated, Optional, List, Dict, Any
from datetime import datetime
from operator import add
from langgraph.graph import add_messages
from langchain_core.messages import BaseMessage
from skills.migrated.shared_runtime.agent_protocols import (
    ImplementerAgentResult,
    ReviewerAgentResult,
    ReviewIssue,
)


class Finding(TypedDict):
    """Single finding from Codex review."""
    severity: str  # critical, high, medium, low
    title: str
    file: str
    line_start: int
    line_end: int
    recommendation: str


class CodexReviewResult(TypedDict):
    """Result from Codex review call."""
    verdict: str  # approve, needs-attention
    findings: List[Finding]
    raw_output: str  # Original output for debugging
    error: Optional[str]


class CodexRescueResult(TypedDict):
    """Result from Codex rescue call."""
    ran: bool
    summary: str
    root_causes: List[str]
    fix_suggestions: List[str]
    raw_output: str
    error: Optional[str]


class CCReviewResult(ReviewerAgentResult):
    """Result from CC reviewer agent."""


class CCFixResult(ImplementerAgentResult):
    """Result from CC implementer agent."""


class RoundResult(TypedDict):
    """Complete result of a single review round."""
    round: int
    codex_review: CodexReviewResult
    codex_rescue: Optional[CodexRescueResult]
    cc_review: CCReviewResult
    cc_fix: CCFixResult
    timestamp: str


class DualReviewState(TypedDict):
    """
    Main state for the Dual Review Loop LangGraph.

    Corresponds to CC's dual-review-report.json + runtime state.
    """
    # Metadata
    created_at: str
    max_rounds: int
    scope: str  # auto, working-tree, branch
    base: Optional[str]  # Base ref for review
    skip_rescue: bool

    # Current state
    current_round: int
    status: str  # in_progress, passed, max_rounds_reached, error
    fix_approved: Optional[bool]

    # Aggregated results
    rounds: List[RoundResult]

    # Current round data (cleared each round)
    current_codex_review: Optional[CodexReviewResult]
    current_codex_rescue: Optional[CodexRescueResult]
    current_cc_review: Optional[CCReviewResult]
    current_cc_fix: Optional[CCFixResult]

    # Statistics
    total_findings: int
    total_confirmed_issues: int
    total_false_positives: int
    total_fixed: int

    # Conversation history (for LLM interactions)
    messages: Annotated[List[BaseMessage], add_messages]

    # Error handling
    errors: Annotated[List[str], add]


# Helper functions for state manipulation

def create_initial_state(
    max_rounds: int = 3,
    scope: str = "auto",
    base: Optional[str] = None,
    skip_rescue: bool = False
) -> DualReviewState:
    """Create initial state for a new dual review loop."""
    return DualReviewState(
        created_at=datetime.now().isoformat(),
        max_rounds=max_rounds,
        scope=scope,
        base=base,
        skip_rescue=skip_rescue,
        current_round=0,
        status="in_progress",
        fix_approved=None,
        rounds=[],
        current_codex_review=None,
        current_codex_rescue=None,
        current_cc_review=None,
        current_cc_fix=None,
        total_findings=0,
        total_confirmed_issues=0,
        total_false_positives=0,
        total_fixed=0,
        messages=[],
        errors=[]
    )


def create_finding(
    severity: str,
    title: str,
    file: str,
    line_start: int,
    line_end: int,
    recommendation: str
) -> Finding:
    """Create a new finding."""
    return Finding(
        severity=severity,
        title=title,
        file=file,
        line_start=line_start,
        line_end=line_end,
        recommendation=recommendation
    )


def has_critical_or_high_findings(state: DualReviewState) -> bool:
    """Check if current review has critical or high severity findings."""
    review = state.get("current_codex_review")
    if not review:
        return False

    for finding in review.get("findings", []):
        if finding["severity"] in ("critical", "high"):
            return True
    return False


def is_verdict_approved(state: DualReviewState) -> bool:
    """Check if current review verdict is approve without critical/high findings."""
    review = state.get("current_codex_review")
    if not review:
        return False

    if review.get("verdict") != "approve":
        return False

    # Double-check no critical/high findings
    return not has_critical_or_high_findings(state)


def can_continue_loop(state: DualReviewState) -> bool:
    """Check if loop can continue (not max rounds, not passed)."""
    if state["status"] != "in_progress":
        return False
    if state["status"] == "passed":
        return False
    if state["current_round"] >= state["max_rounds"]:
        return False
    return True


def get_findings_by_severity(
    state: DualReviewState,
    severities: List[str]
) -> List[Finding]:
    """Filter findings by severity levels."""
    review = state.get("current_codex_review")
    if not review:
        return []

    return [
        f for f in review.get("findings", [])
        if f["severity"] in severities
    ]


def finalize_round(state: DualReviewState) -> Dict[str, Any]:
    """Finalize current round and prepare for next iteration."""
    round_result = RoundResult(
        round=state["current_round"],
        codex_review=state["current_codex_review"] or {},
        codex_rescue=state["current_codex_rescue"],
        cc_review=state["current_cc_review"] or {},
        cc_fix=state["current_cc_fix"] or {},
        timestamp=datetime.now().isoformat()
    )

    # Calculate stats
    review = state.get("current_codex_review")
    findings_count = len(review.get("findings", [])) if review else 0

    cc_review = state.get("current_cc_review")
    confirmed = cc_review.get("confirmed_issues", 0) if cc_review else 0
    false_positives = cc_review.get("false_positives", 0) if cc_review else 0

    cc_fix = state.get("current_cc_fix")
    fixed = cc_fix.get("fixed", 0) if cc_fix else 0

    return {
        "rounds": state["rounds"] + [round_result],
        "current_round": state["current_round"] + 1,
        "current_codex_review": None,
        "current_codex_rescue": None,
        "current_cc_review": None,
        "current_cc_fix": None,
        "total_findings": state["total_findings"] + findings_count,
        "total_confirmed_issues": state["total_confirmed_issues"] + confirmed,
        "total_false_positives": state["total_false_positives"] + false_positives,
        "total_fixed": state["total_fixed"] + fixed,
    }


def mark_as_passed(state: DualReviewState) -> Dict[str, Any]:
    """Mark the review as passed."""
    return {"status": "passed"}


def mark_as_max_rounds_reached(state: DualReviewState) -> Dict[str, Any]:
    """Mark as max rounds reached without passing."""
    return {"status": "max_rounds_reached"}


def generate_summary_report(state: DualReviewState) -> str:
    """Generate the final report in markdown format."""
    status_emoji = "✅" if state["status"] == "passed" else "⚠️"

    report = f"""## Dual Review Loop Report

### Overview
- Rounds: {state['current_round']}/{state['max_rounds']}
- Final Status: {state['status']} {status_emoji}
- Total Findings: {state['total_findings']}
- Confirmed Issues: {state['total_confirmed_issues']} (False positive rate: {_calc_false_positive_rate(state)}%)
- Fixed: {state['total_fixed']}

### Round Summaries
"""

    for round_result in state["rounds"]:
        review = round_result.get("codex_review", {})
        findings = review.get("findings", [])

        critical = sum(1 for f in findings if f.get("severity") == "critical")
        high = sum(1 for f in findings if f.get("severity") == "high")
        medium = sum(1 for f in findings if f.get("severity") == "medium")
        low = sum(1 for f in findings if f.get("severity") == "low")

        cc_review = round_result.get("cc_review", {})
        cc_fix = round_result.get("cc_fix", {})

        report += f"""
#### Round {round_result['round']}
- Codex Found: {critical} critical, {high} high, {medium} medium, {low} low
- CC Confirmed: {cc_review.get('confirmed_issues', 0)} real issues, {cc_review.get('false_positives', 0)} false positives
- Fixed: {cc_fix.get('fixed', 0)}
"""

    # Add remaining medium/low issues
    if state["status"] == "passed":
        last_round = state["rounds"][-1] if state["rounds"] else None
        if last_round:
            review = last_round.get("codex_review", {})
            medium_low = [
                f for f in review.get("findings", [])
                if f.get("severity") in ("medium", "low")
            ]
            if medium_low:
                report += "\n### Remaining Medium/Low Issues (logged only)\n"
                for f in medium_low:
                    report += f"- [{f.get('file')}:{f.get('line_start')}] {f.get('title')}\n"

    return report


def _calc_false_positive_rate(state: DualReviewState) -> int:
    """Calculate false positive rate as percentage."""
    total = state["total_confirmed_issues"] + state["total_false_positives"]
    if total == 0:
        return 0
    return int((state["total_false_positives"] / total) * 100)
