#!/usr/bin/env python3
"""Learning command facade."""
from __future__ import annotations

import sys

from learning_signals import _list_signals, _add_signal
from learning_candidates import (
    _build_candidates,
    _list_candidates,
    _inspect_candidate,
    _reject_candidate,
)
from learning_review import (
    _activity_status,
    _mark_activity,
    _review_prepare,
    _review_inbox,
)
from learning_profile import (
    _profile_status,
    _profile_inspect,
    _profile_update,
    _profile_toggle,
    _profile_export,
    _profile_import,
    user_profile_context_lines,
)
from learning_digest import (
    _promote_digest,
    _disable_digest,
    _reset_digest,
    _list_items,
    _inspect_item,
    _metrics_summary,
)

__all__ = ["main", "user_profile_context_lines"]


def _usage() -> str:
    return """Usage:
  scripts/imo.sh learning list [--scope project|global|merged]
  scripts/imo.sh learning inspect <id>
  scripts/imo.sh learning signal list
  scripts/imo.sh learning signal add --summary <text> [options]
  scripts/imo.sh learning candidate build
  scripts/imo.sh learning candidate list
  scripts/imo.sh learning candidate inspect <id>
  scripts/imo.sh learning candidate reject <id> --reason <text>
  scripts/imo.sh learning digest promote <candidate-id> --review-ref <ref> --rollback-id <id>
  scripts/imo.sh learning digest disable <id> --reason <text>
  scripts/imo.sh learning digest reset --scope project|global
  scripts/imo.sh learning activity status
  scripts/imo.sh learning activity mark --state active|post_turn|quiescent [options]
  scripts/imo.sh learning review prepare [--force]
  scripts/imo.sh learning review inbox
  scripts/imo.sh learning review inspect <candidate-id>
  scripts/imo.sh learning review approve <candidate-id> --review-ref <ref> --rollback-id <id>
  scripts/imo.sh learning review reject <candidate-id> --reason <text>
  scripts/imo.sh learning profile status [--json]
  scripts/imo.sh learning profile inspect [--json]
  scripts/imo.sh learning profile update --summary <text> [options]
  scripts/imo.sh learning profile enable
  scripts/imo.sh learning profile disable
  scripts/imo.sh learning profile export [--output <path>]
  scripts/imo.sh learning profile import --input <path>
  scripts/imo.sh learning metrics summary [--json]

List and inspect commands are read-only. Signal commands write raw learning
signals only. Candidate and review prepare commands write candidates only; they
do not mutate active digest state. Digest control and review approve commands
require explicit review metadata.

Signal add options:
  --source-agent <id>  Source agent or skill id. Default: manual
  --scope <scope>      session | task | project | global. Default: project
  --privacy <privacy>  public | project_private | sensitive. Default: project_private
  --confidence <level> low | medium | high. Default: low
  --ttl <duration>     Optional duration string, such as 7d or null
  --evidence-ref <ref> Optional evidence pointer

Activity mark options:
  --session-id <id>         Session id. Default: manual
  --task-id <id>            Optional task id
  --running-tools <count>   Non-negative integer. Default: 0
  --running-agents <count>  Non-negative integer. Default: 0
  --pending-approval <bool> true | false. Default: false

Profile update options:
  --display-name <text>     Optional user-facing name
  --meaning <text>          How to interpret the user's phrasing or intent. Repeatable
  --communication <text>    Communication preference. Repeatable
  --workflow <text>         Workflow preference. Repeatable
  --tool-use <text>         Tool-use preference. Repeatable
  --review-style <text>     Review / feedback preference. Repeatable
  --source-ref <ref>        Evidence or review pointer. Repeatable
  --replace                 Replace provided preference lists instead of appending
"""


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"-h", "--help", "help"}:
        print(_usage(), end="")
        return 0

    command = args[0]
    if command == "list":
        return _list_items(args[1:])
    if command == "inspect" and len(args) == 2:
        return _inspect_item(args[1])
    if command == "signal" and len(args) >= 2:
        signal_command = args[1]
        if signal_command == "list" and len(args) == 2:
            return _list_signals()
        if signal_command == "add":
            return _add_signal(args[2:])
    if command == "candidate" and len(args) >= 2:
        candidate_command = args[1]
        if candidate_command == "build" and len(args) == 2:
            return _build_candidates()
        if candidate_command == "list" and len(args) == 2:
            return _list_candidates()
        if candidate_command == "inspect" and len(args) == 3:
            return _inspect_candidate(args[2])
        if candidate_command == "reject" and len(args) >= 3:
            return _reject_candidate(args[2], args[3:])
    if command == "activity" and len(args) >= 2:
        activity_command = args[1]
        if activity_command == "status" and len(args) == 2:
            return _activity_status()
        if activity_command == "mark":
            return _mark_activity(args[2:])
    if command == "review" and len(args) >= 2:
        review_command = args[1]
        if review_command == "prepare":
            return _review_prepare(args[2:])
        if review_command in {"inbox", "list"} and len(args) == 2:
            return _review_inbox()
        if review_command == "inspect" and len(args) == 3:
            return _inspect_candidate(args[2])
        if review_command == "approve" and len(args) >= 3:
            return _promote_digest(args[2], args[3:], "candidate_approved")
        if review_command == "reject" and len(args) >= 3:
            return _reject_candidate(args[2], args[3:])
    if command == "profile" and len(args) >= 2:
        profile_command = args[1]
        if profile_command == "status":
            return _profile_status(args[2:])
        if profile_command == "inspect":
            return _profile_inspect(args[2:])
        if profile_command == "update":
            return _profile_update(args[2:])
        if profile_command == "enable" and len(args) == 2:
            return _profile_toggle("enabled")
        if profile_command == "disable" and len(args) == 2:
            return _profile_toggle("disabled")
        if profile_command == "export":
            return _profile_export(args[2:])
        if profile_command == "import":
            return _profile_import(args[2:])
    if command == "metrics" and len(args) >= 2:
        metrics_command = args[1]
        if metrics_command == "summary":
            return _metrics_summary(args[2:])
    if command == "digest" and len(args) >= 2:
        digest_command = args[1]
        if digest_command == "promote" and len(args) >= 3:
            return _promote_digest(args[2], args[3:])
        if digest_command == "disable" and len(args) >= 3:
            return _disable_digest(args[2], args[3:])
        if digest_command == "reset":
            return _reset_digest(args[2:])

    print(_usage(), end="", file=sys.stderr)
    print(f"\nUnsupported learning command: {' '.join(args)}", file=sys.stderr)
    return 64


if __name__ == "__main__":
    sys.exit(main())
