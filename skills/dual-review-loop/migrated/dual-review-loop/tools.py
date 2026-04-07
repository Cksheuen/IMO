"""
Tool wrappers for Codex CLI operations in LangGraph.

Encapsulates Codex CLI calls as LangChain tools for use in LangGraph nodes.

Migration Notes:
- CC's node scripts/codex-companion.mjs becomes wrapped tools
- Each CLI command becomes a separate tool
- Error handling follows CC's error handling patterns
- Tools return structured data for State updates
"""
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
import subprocess
import json
import os


@dataclass
class CodexReviewOutput:
    """Parsed output from Codex review."""
    verdict: str  # approve, needs-attention
    findings: List[Dict[str, Any]]
    raw_output: str
    error: Optional[str] = None


@dataclass
class CodexRescueOutput:
    """Parsed output from Codex rescue."""
    summary: str
    root_causes: List[str]
    fix_suggestions: List[str]
    raw_output: str
    error: Optional[str] = None


class CodexReviewTool:
    """
    Tool wrapper for Codex review command.

    Corresponds to CC's Step 1: Codex Review:
    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" review --wait [--scope <scope>] [--base <base>]
    ```
    """

    name: str = "codex_review"
    description: str = "Run Codex code review on the current changes"

    def __init__(
        self,
        plugin_root: Optional[str] = None,
        timeout: int = 300
    ):
        """
        Initialize the tool.

        Args:
            plugin_root: Path to Claude plugin root (defaults to env CLAUDE_PLUGIN_ROOT)
            timeout: Timeout in seconds for the review
        """
        self.plugin_root = plugin_root or os.environ.get(
            "CLAUDE_PLUGIN_ROOT",
            os.path.expanduser("~/.claude/plugins/codex")
        )
        self.timeout = timeout

    def invoke(
        self,
        scope: str = "auto",
        base: Optional[str] = None
    ) -> CodexReviewOutput:
        """
        Run Codex review.

        Args:
            scope: Review scope (auto, working-tree, branch)
            base: Base ref for comparison

        Returns:
            Parsed review output
        """
        # Build command
        cmd = [
            "node",
            os.path.join(self.plugin_root, "scripts/codex-companion.mjs"),
            "review",
            "--wait",
            f"--scope={scope}"
        ]

        if base:
            cmd.append(f"--base={base}")

        try:
            # Run the command
            # NOTE: In production, this actually calls Codex CLI
            # For migration demo, we simulate the output
            result = self._run_command(cmd)

            # Parse the output
            return self._parse_review_output(result)

        except subprocess.TimeoutExpired:
            return CodexReviewOutput(
                verdict="error",
                findings=[],
                raw_output="",
                error="Codex review timed out"
            )
        except Exception as e:
            return CodexReviewOutput(
                verdict="error",
                findings=[],
                raw_output="",
                error=str(e)
            )

    def _run_command(self, cmd: List[str]) -> str:
        """
        Execute the command and return output.

        In production, this runs the actual Codex CLI.
        For migration demo, this simulates output.
        """
        # SIMULATION: In production, uncomment the real implementation
        # result = subprocess.run(
        #     cmd,
        #     capture_output=True,
        #     text=True,
        #     timeout=self.timeout
        # )
        # if result.returncode != 0:
        #     raise RuntimeError(f"Codex review failed: {result.stderr}")
        # return result.stdout

        # SIMULATION OUTPUT for migration demo
        return self._simulate_review_output()

    def _simulate_review_output(self) -> str:
        """Simulate Codex review output for demo purposes."""
        # This simulates what Codex CLI would return
        return """
VERDICT: needs-attention

FINDINGS:
[CRITICAL] Missing error handling in API call
  File: src/api/client.ts
  Lines: 45-52
  Recommendation: Add try-catch block and proper error logging

[HIGH] Potential memory leak in event listener
  File: src/components/Modal.tsx
  Lines: 78-85
  Recommendation: Clean up event listener in useEffect cleanup

[MEDIUM] Missing type annotation
  File: src/utils/parser.ts
  Lines: 23-25
  Recommendation: Add explicit return type for better type safety
"""

    def _parse_review_output(self, output: str) -> CodexReviewOutput:
        """Parse Codex review output into structured data."""
        findings = []
        verdict = "needs-attention"

        lines = output.strip().split("\n")
        current_finding = None

        for line in lines:
            line = line.strip()

            # Parse verdict
            if line.startswith("VERDICT:"):
                verdict = line.split(":", 1)[1].strip()

            # Parse finding header [SEVERITY] Title
            elif line.startswith("[") and "]" in line:
                if current_finding:
                    findings.append(current_finding)

                severity_end = line.index("]")
                severity = line[1:severity_end].lower()
                title = line[severity_end + 1:].strip()

                current_finding = {
                    "severity": severity,
                    "title": title,
                    "file": "",
                    "line_start": 0,
                    "line_end": 0,
                    "recommendation": ""
                }

            # Parse file
            elif line.startswith("File:") and current_finding:
                current_finding["file"] = line.split(":", 1)[1].strip()

            # Parse lines
            elif line.startswith("Lines:") and current_finding:
                lines_part = line.split(":", 1)[1].strip()
                if "-" in lines_part:
                    parts = lines_part.split("-")
                    current_finding["line_start"] = int(parts[0].strip())
                    current_finding["line_end"] = int(parts[1].strip())
                else:
                    line_num = int(lines_part)
                    current_finding["line_start"] = line_num
                    current_finding["line_end"] = line_num

            # Parse recommendation
            elif line.startswith("Recommendation:") and current_finding:
                current_finding["recommendation"] = line.split(":", 1)[1].strip()

        # Add last finding
        if current_finding:
            findings.append(current_finding)

        return CodexReviewOutput(
            verdict=verdict,
            findings=findings,
            raw_output=output
        )


class CodexRescueTool:
    """
    Tool wrapper for Codex rescue command.

    Corresponds to CC's Step 3: Codex Rescue:
    ```
    /codex:rescue --wait [findings summary]
    ```
    """

    name: str = "codex_rescue"
    description: str = "Run Codex rescue for deep diagnosis of review findings"

    def __init__(
        self,
        plugin_root: Optional[str] = None,
        timeout: int = 300
    ):
        self.plugin_root = plugin_root or os.environ.get(
            "CLAUDE_PLUGIN_ROOT",
            os.path.expanduser("~/.claude/plugins/codex")
        )
        self.timeout = timeout

    def invoke(
        self,
        findings: List[Dict[str, Any]]
    ) -> CodexRescueOutput:
        """
        Run Codex rescue for findings diagnosis.

        Args:
            findings: List of findings from Codex review

        Returns:
            Parsed rescue output with root causes and fix suggestions
        """
        # Build the prompt with findings summary
        findings_summary = self._format_findings(findings)

        try:
            # Run rescue command
            # NOTE: In production, this calls Codex CLI with rescue command
            result = self._run_rescue(findings_summary)

            return self._parse_rescue_output(result)

        except Exception as e:
            return CodexRescueOutput(
                summary="",
                root_causes=[],
                fix_suggestions=[],
                raw_output="",
                error=str(e)
            )

    def _format_findings(self, findings: List[Dict[str, Any]]) -> str:
        """Format findings for rescue prompt."""
        lines = ["Review findings for deep diagnosis:"]

        # Sort by severity
        severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        sorted_findings = sorted(
            findings,
            key=lambda f: severity_order.get(f.get("severity", "low"), 3)
        )

        for f in sorted_findings:
            lines.append(
                f"[{f.get('severity', 'unknown').upper()}] {f.get('title', 'Unknown')}"
            )
            lines.append(f"  Location: {f.get('file')}:{f.get('line_start')}")
            lines.append(f"  Recommendation: {f.get('recommendation', 'N/A')}")

        return "\n".join(lines)

    def _run_rescue(self, findings_summary: str) -> str:
        """
        Execute rescue command.

        In production, this would call Codex CLI.
        For migration demo, this simulates output.
        """
        # SIMULATION: In production, uncomment real implementation
        # cmd = [
        #     "node",
        #     os.path.join(self.plugin_root, "scripts/codex-companion.mjs"),
        #     "rescue",
        #     "--wait",
        #     "--prompt", findings_summary
        # ]
        # result = subprocess.run(
        #     cmd,
        #     capture_output=True,
        #     text=True,
        #     timeout=self.timeout
        # )
        # return result.stdout

        # SIMULATION OUTPUT
        return self._simulate_rescue_output(findings_summary)

    def _simulate_rescue_output(self, findings_summary: str) -> str:
        """Simulate rescue output for demo purposes."""
        return """
DIAGNOSIS SUMMARY:
The code lacks proper error handling patterns, which could lead to unhandled
exceptions in production. The memory leak is caused by missing cleanup in
the useEffect hook.

ROOT CAUSES:
1. Missing error boundary pattern - no centralized error handling
2. Event listener not properly cleaned up - useEffect missing return cleanup
3. Type inference relying on implicit any

FIX SUGGESTIONS:
1. Wrap API calls in try-catch with proper error logging and user feedback
2. Add cleanup function to useEffect: return () => window.removeEventListener(...)
3. Add explicit type annotation with generics for better type inference
"""

    def _parse_rescue_output(self, output: str) -> CodexRescueOutput:
        """Parse rescue output into structured data."""
        summary = ""
        root_causes = []
        fix_suggestions = []

        lines = output.strip().split("\n")
        current_section = None
        current_content = []

        for line in lines:
            line = line.strip()

            if line.startswith("DIAGNOSIS SUMMARY:"):
                current_section = "summary"
                current_content = []
            elif line.startswith("ROOT CAUSES:"):
                if current_section == "summary":
                    summary = "\n".join(current_content).strip()
                current_section = "root_causes"
                current_content = []
            elif line.startswith("FIX SUGGESTIONS:"):
                if current_section == "root_causes":
                    root_causes = current_content.copy()
                current_section = "fix_suggestions"
                current_content = []
            elif line and line[0].isdigit() and current_section in ("root_causes", "fix_suggestions"):
                # Parse numbered items
                item = line.split(".", 1)[1].strip() if "." in line else line
                current_content.append(item)

        # Capture last section
        if current_section == "fix_suggestions":
            fix_suggestions = current_content
        elif current_section == "root_causes":
            root_causes = current_content

        return CodexRescueOutput(
            summary=summary,
            root_causes=root_causes,
            fix_suggestions=fix_suggestions,
            raw_output=output
        )


# Tool instances for use in nodes

def get_codex_review_tool() -> CodexReviewTool:
    """Get the Codex review tool instance."""
    return CodexReviewTool()


def get_codex_rescue_tool() -> CodexRescueTool:
    """Get the Codex rescue tool instance."""
    return CodexRescueTool()


# LangChain Tool wrappers (for use with LangGraph's ToolNode)

from langchain_core.tools import tool


@tool
def codex_review(scope: str = "auto", base: str = None) -> str:
    """
    Run Codex code review on current changes.

    Args:
        scope: Review scope (auto, working-tree, branch)
        base: Base ref for comparison (optional)

    Returns:
        JSON string with review results
    """
    tool_instance = get_codex_review_tool()
    result = tool_instance.invoke(scope=scope, base=base)
    return json.dumps({
        "verdict": result.verdict,
        "findings": result.findings,
        "error": result.error
    })


@tool
def codex_rescue(findings_json: str) -> str:
    """
    Run Codex rescue for deep diagnosis.

    Args:
        findings_json: JSON string of findings from review

    Returns:
        JSON string with rescue results
    """
    tool_instance = get_codex_rescue_tool()
    findings = json.loads(findings_json)
    result = tool_instance.invoke(findings=findings)
    return json.dumps({
        "summary": result.summary,
        "root_causes": result.root_causes,
        "fix_suggestions": result.fix_suggestions,
        "error": result.error
    })
