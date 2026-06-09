#!/usr/bin/env python3
"""Report IMO defensive-programming guardrails and cleanup candidates."""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
SCHEMA_VERSION = 1
CATEGORIES = ("keep", "simplify", "replace-with-contract", "remove")
SEVERITIES = ("info", "review")
SCAN_SCOPE = [
    ".imo/ARCHITECTURE.md",
    ".imo/BOUNDARY.md",
    ".imo/README.md",
    ".imo/RUNBOOK.md",
    ".imo/ROADMAP.md",
    ".imo/product/scripts/CONTRACT.md",
    ".imo/product/scripts/audit_managed_ownership.py",
    ".imo/product/scripts/check_project_profile_contracts.py",
    ".imo/product/scripts/codex_context.py",
    ".imo/product/scripts/learning.py",
    ".imo/product/scripts/project_profile.py",
    ".imo/product/scripts/verify.py",
    ".imo/runtime/CONTRACT.md",
    ".imo/runtime/defensive-audit/CONTRACT.md",
    ".imo/runtime/project-profile/CONTRACT.md",
    ".trellis/spec/backend/imo-managed-outputs.md",
    ".trellis/spec/backend/imo-managed-outputs/repo-local-defensive-programming-audit.md",
    ".trellis/spec/backend/imo-managed-outputs/repo-local-imo-verification-suite.md",
]


def _usage() -> str:
    return """Usage:
  ./imo defensive audit [--json]

The defensive audit is read-only and advisory. It separates necessary IMO
boundary guardrails from patterns that should be simplified or made explicit
through contracts.
"""


def _read_lines(rel_path: str) -> list[str]:
    path = ROOT / rel_path
    if not path.is_file():
        return []
    return path.read_text(encoding="utf-8").splitlines()


def _first_match(rel_path: str, pattern: str) -> dict[str, Any] | None:
    regex = re.compile(pattern)
    for index, line in enumerate(_read_lines(rel_path), start=1):
        if regex.search(line):
            return {
                "path": rel_path,
                "line": index,
                "evidence": line.strip(),
            }
    return None


def _count_matches(rel_path: str, pattern: str) -> int:
    regex = re.compile(pattern)
    return sum(1 for line in _read_lines(rel_path) if regex.search(line))


def _finding(
    *,
    finding_id: str,
    category: str,
    severity: str,
    match: dict[str, Any],
    reason: str,
    recommendation: str,
    occurrences: int = 1,
) -> dict[str, Any]:
    return {
        "id": finding_id,
        "category": category,
        "severity": severity,
        "path": match["path"],
        "line": match["line"],
        "evidence": match["evidence"],
        "occurrences": occurrences,
        "reason": reason,
        "recommendation": recommendation,
    }


def _build_findings() -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []

    match = _first_match(".imo/product/scripts/codex_context.py", r"except Exception")
    if match:
        findings.append(
            _finding(
                finding_id="keep-hook-clean-degradation",
                category="keep",
                severity="info",
                match=match,
                occurrences=_count_matches(".imo/product/scripts/codex_context.py", r"except Exception"),
                reason="Codex hook context is informational and must not block the user prompt path when optional context fails.",
                recommendation="Keep hook degradation narrow; do not expand it into hidden retries or source mutation.",
            )
        )

    match = _first_match(".imo/product/scripts/project_profile.py", r'"status": "missing"')
    if match:
        findings.append(
            _finding(
                finding_id="keep-runtime-state-missing-current-stale-invalid",
                category="keep",
                severity="info",
                match=match,
                occurrences=sum(
                    _count_matches(".imo/product/scripts/project_profile.py", pattern)
                    for pattern in (r'"missing"', r'"current"', r'"stale"', r'"invalid"')
                ),
                reason="Project-profile state is an explicit runtime-state machine, not a vague fallback.",
                recommendation="Keep these states observable and read-only for status/inspect commands.",
            )
        )

    match = _first_match(".imo/product/scripts/learning.py", r"no active digest found|no raw signals found|no candidates found")
    if match:
        findings.append(
            _finding(
                finding_id="keep-learning-empty-state",
                category="keep",
                severity="info",
                match=match,
                occurrences=sum(
                    _count_matches(".imo/product/scripts/learning.py", pattern)
                    for pattern in (r"no active digest found", r"no raw signals found", r"no candidates found")
                ),
                reason="Learning list commands treat absent runtime files as explicit empty states.",
                recommendation="Keep empty list behavior for list commands; keep inspect/promote errors caller-visible.",
            )
        )

    match = _first_match(".imo/BOUNDARY.md", r"Provider failures must degrade")
    if match:
        findings.append(
            _finding(
                finding_id="keep-optional-provider-degradation",
                category="keep",
                severity="info",
                match=match,
                reason="External providers are optional and must not break IMO native commands or Trellis task flow.",
                recommendation="Keep provider degradation at provider boundaries, not inside core command logic.",
            )
        )

    match = _first_match(".imo/product/scripts/verify.py", r"backup_dir: Path \| None = None")
    if match:
        findings.append(
            _finding(
                finding_id="simplify-verify-runtime-backup-repetition",
                category="simplify",
                severity="review",
                match=match,
                occurrences=_count_matches(".imo/product/scripts/verify.py", r"backup_dir: Path \| None = None"),
                reason="Verify smoke tests repeat the same backup/restore shape for ignored runtime state.",
                recommendation="Keep backup/restore behavior, but extract a small helper before adding more runtime-write smoke tests.",
            )
        )

    match = _first_match(".imo/product/scripts/verify.py", r"except Exception as exc")
    if match:
        findings.append(
            _finding(
                finding_id="simplify-verify-broad-exception-reporting",
                category="simplify",
                severity="review",
                match=match,
                occurrences=_count_matches(".imo/product/scripts/verify.py", r"except Exception as exc"),
                reason="Broad smoke-test exception handling makes failures readable but is repeated across similar blocks.",
                recommendation="Keep labelled diagnostics; consider one smoke-test wrapper if more blocks are added.",
            )
        )

    match = _first_match(".imo/BOUNDARY.md", r"machine-checkable|prose-only")
    if match:
        findings.append(
            _finding(
                finding_id="replace-prose-guardrails-with-contracts",
                category="replace-with-contract",
                severity="review",
                match=match,
                occurrences=sum(_count_matches(path, r"prose-only|machine-checkable") for path in SCAN_SCOPE),
                reason="IMO already recognizes that durable guardrails should become metadata, schemas, or checkers.",
                recommendation="When a new defensive rule appears in prose, add a small contract checker or stable command smoke if it affects behavior.",
            )
        )

    return findings


def build_report() -> dict[str, Any]:
    findings = _build_findings()
    by_category = {category: 0 for category in CATEGORIES}
    by_severity = {severity: 0 for severity in SEVERITIES}
    for finding in findings:
        by_category[finding["category"]] += 1
        by_severity[finding["severity"]] += 1

    return {
        "schema_version": SCHEMA_VERSION,
        "scan_scope": SCAN_SCOPE,
        "summary": {
            "total": len(findings),
            "by_category": by_category,
            "by_severity": by_severity,
        },
        "findings": findings,
        "follow_ups": [
            {
                "id": "watch-for-blanket-just-in-case-fallbacks",
                "source_finding": None,
                "summary": "No concrete remove candidate is reported now; future blanket fallback additions should become explicit cleanup tasks.",
            },
            {
                "id": "extract-runtime-state-backup-helper-if-verify-grows",
                "source_finding": "simplify-verify-runtime-backup-repetition",
                "summary": "Extract a helper only when another runtime-write smoke test is added.",
            },
            {
                "id": "promote-recurring-prose-guardrails-to-checkers",
                "source_finding": "replace-prose-guardrails-with-contracts",
                "summary": "Turn recurring prose-only defensive requirements into a contract checker or direct command smoke.",
            },
            {
                "id": "keep-hook-fallbacks-narrow",
                "source_finding": "keep-hook-clean-degradation",
                "summary": "Hook fallback should only protect prompt flow; it should not hide broken product commands.",
            },
        ],
    }


def _render_human(report: dict[str, Any]) -> str:
    lines = [
        "IMO Defensive Programming Audit",
        f"Scan scope: {len(report['scan_scope'])} bounded files",
        "",
        "Summary:",
    ]
    for category in CATEGORIES:
        lines.append(f"  {category}: {report['summary']['by_category'][category]}")
    lines.extend(["", "Findings:"])
    for finding in report["findings"]:
        lines.extend(
            [
                f"- [{finding['category']}/{finding['severity']}] {finding['id']}",
                f"  at {finding['path']}:{finding['line']} ({finding['occurrences']} occurrence(s))",
                f"  evidence: {finding['evidence']}",
                f"  reason: {finding['reason']}",
                f"  recommendation: {finding['recommendation']}",
            ]
        )
    lines.extend(["", "Follow-up gaps:"])
    for follow_up in report["follow_ups"]:
        lines.append(f"- {follow_up['id']}: {follow_up['summary']}")
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"-h", "--help", "help"}:
        print(_usage(), end="")
        return 0
    if args[0] != "audit" or any(arg not in {"--json"} for arg in args[1:]):
        print(_usage(), end="", file=sys.stderr)
        print(f"\nUnsupported defensive command: {' '.join(args)}", file=sys.stderr)
        return 64

    report = build_report()
    if "--json" in args[1:]:
        print(json.dumps(report, ensure_ascii=True, indent=2, sort_keys=True))
    else:
        print(_render_human(report), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
