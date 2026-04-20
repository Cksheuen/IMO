#!/usr/bin/env python3
"""Manual helper for promote-notes workflow.

This helper is intentionally manual-only and keeps the existing
dispatch/apply contract intact.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

BASE = Path.home() / ".claude"
DISPATCH_SCRIPT = BASE / "hooks" / "promotion-dispatch.py"
QUEUE_FILE = BASE / "promotion-queue.json"
DEFAULT_CLAIM_FILE = BASE / "promotion-claim.json"
DEFAULT_RESULT_FILE = BASE / "promotion-result.json"


def run_dispatch(args: list[str], capture_stdout: bool = False) -> subprocess.CompletedProcess[str]:
    cmd = [sys.executable, str(DISPATCH_SCRIPT), *args]
    return subprocess.run(cmd, text=True, capture_output=capture_stdout, check=False)


def resolve_output_path(path_str: str) -> Path:
    path = Path(path_str)
    if path.is_absolute():
        return path
    return BASE / path


def safe_read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def extract_claimed_candidates(payload: dict[str, Any]) -> list[dict[str, Any]]:
    dispatch = payload.get("promotionDispatch")
    if not isinstance(dispatch, dict):
        return []
    candidates = dispatch.get("candidates")
    if not isinstance(candidates, list):
        return []
    return [c for c in candidates if isinstance(c, dict)]


def build_stub_actions(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for candidate in candidates:
        lesson_path = str(candidate.get("path", "")).strip()
        candidate_id = str(candidate.get("id") or Path(lesson_path).stem).strip()
        if not lesson_path or not candidate_id:
            continue
        actions.append(
            {
                "id": candidate_id,
                "action": "defer",
                "lesson": lesson_path,
                "reason": "TODO: edit action to keep/promoted_to_rule/promoted_to_skill/indexed_in_memory/defer",
                "target": "",
                "record": {
                    "subject": "",
                    "key": "",
                    "kind": "",
                    "scope": "cross-session",
                    "status": "active",
                    "valueType": "",
                    "value": "",
                },
            }
        )
    return actions


def load_candidates_for_stub(claim_file: Path | None) -> list[dict[str, Any]]:
    if claim_file is not None:
        payload = safe_read_json(claim_file)
        claimed = extract_claimed_candidates(payload)
        if claimed:
            return claimed

    queue = safe_read_json(QUEUE_FILE)
    candidates = queue.get("candidates")
    if not isinstance(candidates, list):
        return []
    processing = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        if item.get("status") == "processing":
            processing.append(item)
    return processing


def cmd_scan(_: argparse.Namespace) -> int:
    result = run_dispatch(["scan"])
    return result.returncode


def cmd_list(_: argparse.Namespace) -> int:
    result = run_dispatch(["list"])
    return result.returncode


def cmd_claim(args: argparse.Namespace) -> int:
    result = run_dispatch(["claim", "--count", str(args.count)], capture_stdout=True)
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    if result.stdout:
        print(result.stdout, end="")
    if result.returncode != 0:
        return result.returncode

    payload = {}
    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return 0

    dispatch = payload.get("promotionDispatch", {})
    has_candidates = bool(dispatch.get("hasCandidates"))
    if has_candidates:
        out_path = resolve_output_path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Saved claim payload: {out_path}", file=sys.stderr)
    return 0


def cmd_stub_result(args: argparse.Namespace) -> int:
    claim_file = resolve_output_path(args.claim_file) if args.claim_file else None
    candidates = load_candidates_for_stub(claim_file)
    if not candidates:
        print("No claimed candidates found. Run claim first or provide --claim-file.", file=sys.stderr)
        return 1

    result_payload = {
        "actions": build_stub_actions(candidates),
        "meta": {
            "generated_by": "scripts/promote-notes-run.py",
            "note": "Stub only. Edit actions before apply.",
            "candidate_count": len(candidates),
        },
    }

    output_path = resolve_output_path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote stub result: {output_path}")
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    result_path = resolve_output_path(args.result_file)
    result = run_dispatch(["apply", "--result-file", str(result_path)])
    return result.returncode


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manual helper for promote-notes: scan/list/claim/stub-result/apply"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("scan", help="Scan promotion candidates and enqueue")
    subparsers.add_parser("list", help="List current promotion queue")

    claim_parser = subparsers.add_parser("claim", help="Claim candidates from queue")
    claim_parser.add_argument("--count", type=int, default=1, help="Batch size for claim (default: 1)")
    claim_parser.add_argument(
        "--out",
        default=str(DEFAULT_CLAIM_FILE),
        help=f"Save claim payload JSON path (default: {DEFAULT_CLAIM_FILE})",
    )

    stub_parser = subparsers.add_parser(
        "stub-result",
        help="Generate editable promotion-result.json stub from claimed candidates",
    )
    stub_parser.add_argument(
        "--claim-file",
        default=str(DEFAULT_CLAIM_FILE),
        help=f"Claim payload JSON path (default: {DEFAULT_CLAIM_FILE})",
    )
    stub_parser.add_argument(
        "--output",
        default=str(DEFAULT_RESULT_FILE),
        help=f"Output promotion result path (default: {DEFAULT_RESULT_FILE})",
    )

    apply_parser = subparsers.add_parser("apply", help="Apply promotion-result.json via dispatch contract")
    apply_parser.add_argument(
        "--result-file",
        default=str(DEFAULT_RESULT_FILE),
        help=f"Promotion result path (default: {DEFAULT_RESULT_FILE})",
    )

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "scan":
        return cmd_scan(args)
    if args.command == "list":
        return cmd_list(args)
    if args.command == "claim":
        return cmd_claim(args)
    if args.command == "stub-result":
        return cmd_stub_result(args)
    if args.command == "apply":
        return cmd_apply(args)
    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
