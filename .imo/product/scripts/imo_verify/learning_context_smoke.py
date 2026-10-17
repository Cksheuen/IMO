from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import codex_context

from .runner import ROOT, fixture_runtime_root


def _run_learning_context_smoke() -> bool:
    print("[imo verify] learning context injection")
    runtime_dir = fixture_runtime_root() / "learning"
    digest_path = runtime_dir / "digest.json"
    backup_dir: Path | None = None

    try:
        if runtime_dir.exists():
            backup_dir = Path(tempfile.mkdtemp(prefix="imo-learning-backup-"))
            shutil.copytree(runtime_dir, backup_dir / "learning", dirs_exist_ok=True)
            shutil.rmtree(runtime_dir)

        runtime_dir.mkdir(parents=True, exist_ok=True)
        digest_path.write_text(
            """{
  "items": [
    {
      "digest_version": "1",
      "id": "digest-active",
      "last_updated": "2026-05-21T00:00:00Z",
      "priority": "high",
      "rollback_id": "verify:rollback",
      "scope": "project",
      "source_candidates": ["candidate-active"],
      "status": "active",
      "summary": "Prefer reviewed digest behavior only after project rules"
    },
    {
      "digest_version": "1",
      "id": "digest-disabled",
      "last_updated": "2026-05-21T00:00:00Z",
      "priority": "normal",
      "rollback_id": "verify:rollback-disabled",
      "scope": "project",
      "source_candidates": ["candidate-disabled"],
      "status": "disabled",
      "summary": "This disabled digest must not be injected"
    }
  ]
}
""",
            encoding="utf-8",
        )

        context = subprocess.run(
            ["./imo", "codex", "context", "--empty"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if context.returncode != 0:
            print("[imo verify] failed: codex context with digest", file=sys.stderr)
            return False
        if "Prefer reviewed digest behavior only after project rules" not in context.stdout:
            print("[imo verify] failed: active digest missing from context", file=sys.stderr)
            return False
        if "This disabled digest must not be injected" in context.stdout:
            print("[imo verify] failed: disabled digest injected into context", file=sys.stderr)
            return False
        if "current user instruction > repo/task rules" not in context.stdout or "user profile > active digest" not in context.stdout:
            print("[imo verify] failed: digest priority guard missing", file=sys.stderr)
            return False
        additional_context = json.loads(context.stdout)["hookSpecificOutput"]["additionalContext"]
        context_lines = additional_context.splitlines()
        rules_start = context_lines.index("Active IMO rules:")
        rule_names: list[str] = []
        for line in context_lines[rules_start + 1:]:
            if not line.startswith("- "):
                break
            rule_names.append(line[2:].split(":", 1)[0])
        expected_rule_names = [
            "Delegated Coding",
            "Chameleon",
            "Structured Development",
            "Focused Context Reading",
            "Evidence First",
        ]
        if rule_names != expected_rule_names:
            print("[imo verify] failed: active rule order/count mismatch", file=sys.stderr)
            return False

        stats = subprocess.run(
            ["./imo", "codex", "context", "--empty", "--stats"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if stats.returncode != 0:
            print("[imo verify] failed: codex context stats", file=sys.stderr)
            return False
        stats_payload = json.loads(stats.stdout)
        if stats_payload.get("mode") != "standard" or stats_payload.get("budget_chars") != 2200:
            print("[imo verify] failed: standard context stats mode/budget", file=sys.stderr)
            return False
        if stats_payload.get("total_chars", 2201) > stats_payload.get("budget_chars", 0):
            print("[imo verify] failed: standard context exceeded budget", file=sys.stderr)
            return False
        if "digest" not in stats_payload.get("sections", {}):
            print("[imo verify] failed: digest section missing from stats", file=sys.stderr)
            return False
        base_sections = codex_context._build_sections({}, "standard")
        base_lines = next(lines for label, lines in base_sections if label == "base")
        rules_lines = ["Active IMO rules:"] + [
            f"- Rule {index}: " + "r" * 190 for index in range(1, 6)
        ]
        profile_marker = "- profile-marker-" + "p" * (220 - len("- profile-marker-"))
        user_marker = "- user-marker-" + "u" * (250 - len("- user-marker-"))
        digest_summary = "digest-marker-" + "d" * (90 - len("digest-marker-"))
        digest_item = f"- [project:project] {digest_summary}"
        synthetic_sections = [
            ("base", base_lines),
            ("rules", rules_lines),
            ("project_profile", ["Project profile:", profile_marker]),
            ("user_profile", ["User profile:", user_marker]),
            (
                "digest",
                [
                    "Active IMO learning digest:",
                    "- project items precede global items; candidates/raw signals are not injected.",
                    digest_item,
                ],
            ),
            ("note", ["</imo-context>"]),
        ]
        rendered, _ = codex_context._render_sections(synthetic_sections, "standard")
        for required in (
            "Project profile:",
            profile_marker,
            "User profile:",
            user_marker,
            "Active IMO learning digest:",
            digest_item,
        ):
            if required not in rendered:
                print("[imo verify] failed: synthetic section content missing", file=sys.stderr)
                return False
        if len(rendered) > 2200:
            print("[imo verify] failed: synthetic context exceeded budget", file=sys.stderr)
            return False

        # Delegation guidance and its route must survive every context budget.
        for mode in ("compact", "standard", "full"):
            mode_context, _ = codex_context._render_sections(
                codex_context._build_sections({}, mode), mode
            )
            for marker in (
                "work in main unless delegation is asked for",
                "Delegation uses Herdr",
                "exact chosen model",
            ):
                if marker not in mode_context:
                    print(f"[imo verify] failed: {mode} delegation missing {marker}", file=sys.stderr)
                    return False

        compact_env = os.environ.copy()
        compact_env["IMO_CONTEXT_MODE"] = "compact"
        compact_stats = subprocess.run(
            ["./imo", "codex", "context", "--empty", "--stats"],
            cwd=ROOT,
            env=compact_env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if compact_stats.returncode != 0:
            print("[imo verify] failed: compact codex context stats", file=sys.stderr)
            return False
        compact_payload = json.loads(compact_stats.stdout)
        if compact_payload.get("mode") != "compact" or compact_payload.get("budget_chars") != 1200:
            print("[imo verify] failed: compact context stats mode/budget", file=sys.stderr)
            return False
        if compact_payload.get("total_chars", 1201) > compact_payload.get("budget_chars", 0):
            print("[imo verify] failed: compact context exceeded budget", file=sys.stderr)
            return False

        full_stats = subprocess.run(
            ["./imo", "codex", "context", "--empty", "--mode", "full", "--stats"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if full_stats.returncode != 0:
            print("[imo verify] failed: full codex context stats", file=sys.stderr)
            return False
        full_payload = json.loads(full_stats.stdout)
        if full_payload.get("mode") != "full" or full_payload.get("budget_chars") != 4000:
            print("[imo verify] failed: full context stats mode/budget", file=sys.stderr)
            return False
        if full_payload.get("total_chars", 4001) > full_payload.get("budget_chars", 0):
            print("[imo verify] failed: full context exceeded budget", file=sys.stderr)
            return False

        invalid_mode = subprocess.run(
            ["./imo", "codex", "context", "--empty", "--mode", "tiny"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if invalid_mode.returncode == 0 or "--mode must be one of" not in invalid_mode.stderr:
            print("[imo verify] failed: invalid context mode was not rejected", file=sys.stderr)
            return False

        print("[imo verify] ok: learning context injection")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: learning context injection: {exc}", file=sys.stderr)
        return False
    finally:
        if runtime_dir.exists():
            shutil.rmtree(runtime_dir)
        if backup_dir is not None:
            backup_learning = backup_dir / "learning"
            if backup_learning.exists():
                runtime_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_learning, runtime_dir, dirs_exist_ok=True)
            shutil.rmtree(backup_dir, ignore_errors=True)
