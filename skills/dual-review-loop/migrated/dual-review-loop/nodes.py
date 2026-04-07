"""
Node implementations for Dual Review Loop LangGraph migration.

Implements the core nodes: codex_review, rescue, cc_review, cc_fix, finalize_round.
"""
from typing import Dict, Any, List, Optional
from langchain_core.runnables import RunnableLambda
from langchain_core.messages import HumanMessage, AIMessage

from .state import (
    DualReviewState,
    create_initial_state,
    create_finding,
    has_critical_or_high_findings,
    is_verdict_approved,
    can_continue_loop,
    finalize_round,
    mark_as_passed,
    mark_as_max_rounds_reached,
    generate_summary_report,
    CodexReviewResult,
    CodexRescueResult,
    CCReviewResult,
    CCFixResult,
)
from .tools import get_codex_review_tool, get_codex_rescue_tool


# Node functions

async def codex_review_node(state: DualReviewState) -> Dict[str, Any]:
    """
    Step 1: Run Codex review.

    Equivalent to CC's Step 1: Codex Review.

    Maps to:
    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" review --wait [--scope <scope>] [--base <base>]
    ```
    """
    # Get tool instance
    review_tool = get_codex_review_tool()

    # Run review
    result = review_tool.invoke(
        scope=state["scope"],
        base=state.get("base")
    )

    # Convert to state format
    codex_review_result: CodexReviewResult = {
        "verdict": result.verdict,
        "findings": [
            create_finding(
                severity=f.get("severity", "low"),
                title=f.get("title", ""),
                file=f.get("file", ""),
                line_start=f.get("line_start", 0),
                line_end=f.get("line_end", 0),
                recommendation=f.get("recommendation", "")
            )
            for f in result.findings
        ],
        "raw_output": result.raw_output,
        "error": result.error
    }

    return {"current_codex_review": codex_review_result}


async def evaluate_verdict_node(state: DualReviewState) -> Dict[str, Any]:
    """
    Step 2: Evaluate if review passed.

    Equivalent to CC's Step 2: 判断是否通过.

    Pass criteria:
    - verdict == "approve"
    - No critical or high severity findings
    """
    if is_verdict_approved(state):
        # Review passed - finalize and end
        return {
            **finalize_round(state),
            **mark_as_passed(state)
        }

    # Review did not pass - continue to rescue or CC review
    return {}


async def codex_rescue_node(state: DualReviewState) -> Dict[str, Any]:
    """
    Step 3: Run Codex rescue for diagnosis.

    Equivalent to CC's Step 3: Codex Rescue 诊断.

    Only runs if:
    - --skip-rescue is NOT set
    - There ARE critical/high findings

    Maps to:
    ```
    /codex:rescue --wait [findings summary]
    ```
    """
    # Check if rescue should run
    if state.get("skip_rescue"):
        return {"current_codex_rescue": None}

    if not has_critical_or_high_findings(state):
        return {"current_codex_rescue": None}

    # Get tool instance
    rescue_tool = get_codex_rescue_tool()

    # Get findings from current review
    review = state.get("current_codex_review")
    if not review:
        return {"current_codex_rescue": None}

    findings = review.get("findings", [])

    # Run rescue
    result = rescue_tool.invoke(findings=findings)

    # Convert to state format
    rescue_result: CodexRescueResult = {
        "ran": True,
        "summary": result.summary,
        "root_causes": result.root_causes,
        "fix_suggestions": result.fix_suggestions,
        "raw_output": result.raw_output,
        "error": result.error
    }

    return {"current_codex_rescue": rescue_result}


async def cc_review_node(state: DualReviewState) -> Dict[str, Any]:
    """
    Step 4: Run CC reviewer agent.

    Equivalent to CC's Step 4: CC Reviewer 审查.

    In production, this would:
    1. Start a reviewer subagent
    2. Pass findings and rescue results
    3. Get confirmation on real issues vs false positives

    Maps to:
    ```
    Agent(subagent_type: "reviewer", prompt: "审查以下 Codex review...")
    ```
    """
    # In production, this would call the reviewer agent
    # For demo, we simulate the review

    review = state.get("current_codex_review")
    rescue = state.get("current_codex_rescue")

    findings = review.get("findings", []) if review else []

    # Simulate false positive filtering
    # In production, reviewer agent would analyze each finding
    confirmed_issues = []
    false_positives = []

    for finding in findings:
        # Simple heuristic for demo:
        # Critical/High findings are usually real
        # Medium/Low might be false positives
        if finding["severity"] in ("critical", "high"):
            confirmed_issues.append({
                **finding,
                "delta_context": {
                    "problem_location": {
                        "file": finding["file"],
                        "lines": f"{finding['line_start']}-{finding['line_end']}",
                        "code_snippet": "(to be extracted)"
                    },
                    "root_cause": rescue.get("root_causes", ["Unknown"])[0] if rescue else "Unknown",
                    "fix_suggestion": {
                        "action": "fix",
                        "target": finding["title"],
                        "details": finding["recommendation"],
                        "reference_example": None
                    },
                    "files_to_read": [finding["file"]],
                    "files_to_skip": []
                }
            })
        else:
            # Medium/low might be false positive - simulate 50% rate
            # In production, reviewer decides based on context
            if len(false_positives) < len(findings) // 3:
                false_positives.append(finding)
            else:
                confirmed_issues.append({
                    **finding,
                    "delta_context": {
                        "problem_location": {
                            "file": finding["file"],
                            "lines": f"{finding['line_start']}-{finding['line_end']}",
                            "code_snippet": "(to be extracted)"
                        },
                        "root_cause": "Minor issue",
                        "fix_suggestion": {
                            "action": "fix",
                            "target": finding["title"],
                            "details": finding["recommendation"],
                            "reference_example": None
                        },
                        "files_to_read": [finding["file"]],
                        "files_to_skip": []
                    }
                })

    cc_review_result: CCReviewResult = {
        "confirmed_issues": len(confirmed_issues),
        "false_positives": len(false_positives),
        "issues": confirmed_issues,
        "raw_output": "Simulated CC review output"
    }

    return {"current_cc_review": cc_review_result}


async def cc_fix_node(state: DualReviewState) -> Dict[str, Any]:
    """
    Step 5: Run CC implementer to fix issues.

    Equivalent to CC's Step 5: CC Implementer 修复.

    In production, this would:
    1. Start implementer subagent(s) for each issue
    2. Use worktree isolation if multiple fixes needed
    3. Each fix gets committed separately

    Maps to:
    ```
    Agent(subagent_type: "implementer", prompt: "修复以下审查发现的问题...")
    ```
    """
    cc_review = state.get("current_cc_review")

    if not cc_review:
        return {"current_cc_fix": CCFixResult(
            fixed=0,
            commits=[],
            files_changed=[],
            raw_output="No issues to fix"
        )}

    issues = cc_review.get("issues", [])

    # In production, this would call implementer agents
    # For demo, we simulate fixes

    fixed = len(issues)
    commits = [f"fix_{i+1}" for i in range(fixed)]
    files_changed = list(set(
        issue.get("file", "")
        for issue in issues
        if issue.get("file")
    ))

    cc_fix_result: CCFixResult = {
        "fixed": fixed,
        "commits": commits,
        "files_changed": files_changed,
        "raw_output": f"Simulated fixes for {fixed} issues"
    }

    return {"current_cc_fix": cc_fix_result}


async def finalize_round_node(state: DualReviewState) -> Dict[str, Any]:
    """
    Step 6: Finalize current round.

    Equivalent to CC's Step 6: 记录本轮结果.
    """
    return finalize_round(state)


async def check_continue_node(state: DualReviewState) -> Dict[str, Any]:
    """
    Step 7: Check if loop should continue.

    Equivalent to CC's Step 7: 循环判断.
    """
    # Check if we hit max rounds
    if state["current_round"] >= state["max_rounds"]:
        return mark_as_max_rounds_reached(state)

    # Continue to next round
    return {}


async def generate_report_node(state: DualReviewState) -> Dict[str, Any]:
    """
    Generate final report.

    Called when loop ends (either passed or max rounds reached).
    """
    report = generate_summary_report(state)
    return {"final_report": report}


# Runnable wrappers for LangGraph

codex_review_runnable = RunnableLambda(codex_review_node)
evaluate_verdict_runnable = RunnableLambda(evaluate_verdict_node)
codex_rescue_runnable = RunnableLambda(codex_rescue_node)
cc_review_runnable = RunnableLambda(cc_review_node)
cc_fix_runnable = RunnableLambda(cc_fix_node)
finalize_round_runnable = RunnableLambda(finalize_round_node)
check_continue_runnable = RunnableLambda(check_continue_node)
generate_report_runnable = RunnableLambda(generate_report_node)


# Helper to format prompt for reviewer agent

def format_reviewer_prompt(state: DualReviewState) -> str:
    """Format the prompt for a CC reviewer agent."""
    review = state.get("current_codex_review")
    rescue = state.get("current_codex_rescue")

    prompt = """Review the following Codex review findings and diagnosis results to confirm which issues need fixing:

## Codex Review Findings
"""

    if review:
        for f in review.get("findings", []):
            prompt += f"""
- [{f.get('severity', 'unknown').upper()}] {f.get('title', 'Unknown')}
  File: {f.get('file')}:{f.get('line_start')}-{f.get('line_end')}
  Recommendation: {f.get('recommendation', 'N/A')}
"""

    if rescue:
        prompt += f"""

## Codex Rescue Diagnosis
{rescue.get('summary', 'No summary')}

### Root Causes
"""
        for i, cause in enumerate(rescue.get("root_causes", []), 1):
            prompt += f"{i}. {cause}\n"

        prompt += "\n### Fix Suggestions\n"
        for i, suggestion in enumerate(rescue.get("fix_suggestions", []), 1):
            prompt += f"{i}. {suggestion}\n"

    prompt += """

## Task Requirements
1. Confirm each finding is a real issue (filter false positives)
2. Sort confirmed issues by impact
3. Generate delta_context for each issue to be fixed
4. Output structured fix list
"""

    return prompt


def format_implementer_prompt(state: DualReviewState) -> str:
    """Format the prompt for a CC implementer agent."""
    cc_review = state.get("current_cc_review")

    if not cc_review:
        return ""

    issues = cc_review.get("issues", [])

    prompt = """Fix the following review findings:

## Fix List
"""

    for issue in issues:
        prompt += f"""
- [{issue.get('severity', 'unknown').upper()}] {issue.get('title', 'Unknown')}
  File: {issue.get('file')}:{issue.get('line_start')}-{issue.get('line_end')}
  Recommendation: {issue.get('recommendation', 'N/A')}
"""
        if "delta_context" in issue:
            dc = issue["delta_context"]
            prompt += f"""
  Root Cause: {dc.get('root_cause', 'Unknown')}
  Files to read: {dc.get('files_to_read', [])}
"""

    prompt += """

## Constraints
- Only fix issues listed above, no additional changes
- Git commit after each fix
- Follow change-scope-guard rules
"""

    return prompt
