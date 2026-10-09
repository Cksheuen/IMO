from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


def _is_error(issue: Any) -> bool:
    return isinstance(issue, dict) and str(issue.get("severity", "")).lower() == "error"


def _is_warning(issue: Any) -> bool:
    return isinstance(issue, dict) and str(issue.get("severity", "")).lower() == "warning"


def _run_skill_semantics_smoke() -> bool:
    root = Path(__file__).resolve().parents[4]
    checker = root / ".imo" / "product" / "scripts" / "check_skill_semantics.py"

    try:
        if not checker.is_file():
            print(f"[imo verify] failed: skill semantic behavior: checker not found: {checker}", file=sys.stderr)
            return False

        with tempfile.TemporaryDirectory(prefix="imo-skill-semantics-") as home:
            proc = subprocess.run(
                [
                    sys.executable,
                    str(checker),
                    "--root",
                    str(root),
                    "--home",
                    home,
                    "--json",
                ],
                capture_output=True,
                text=True,
                check=False,
            )

            if proc.returncode != 0:
                print(
                    f"[imo verify] failed: skill semantic behavior: checker exit {proc.returncode}: {proc.stderr.strip()}",
                    file=sys.stderr,
                )
                return False

            try:
                data = json.loads(proc.stdout)
            except json.JSONDecodeError as exc:
                print(f"[imo verify] failed: skill semantic behavior: invalid JSON: {exc}", file=sys.stderr)
                return False

            if not isinstance(data, dict) or data.get("schema_version") != 1:
                print("[imo verify] failed: skill semantic behavior: schema_version must be 1", file=sys.stderr)
                return False

            summary = data.get("summary")
            if not isinstance(summary, dict) or summary.get("errors") != 0:
                print("[imo verify] failed: skill semantic behavior: summary.errors must be 0", file=sys.stderr)
                return False

            unavailable = summary.get("unavailable")
            if not isinstance(unavailable, int) or unavailable < 1:
                print("[imo verify] failed: skill semantic behavior: summary.unavailable must be >= 1", file=sys.stderr)
                return False

            modules = data.get("modules")
            if not isinstance(modules, list):
                print("[imo verify] failed: skill semantic behavior: modules must be a list", file=sys.stderr)
                return False

            arch = next(
                (m for m in modules if isinstance(m, dict) and m.get("id") == "architecture-health"),
                None,
            )
            if arch is None:
                print("[imo verify] failed: skill semantic behavior: architecture-health module missing", file=sys.stderr)
                return False

            if arch.get("classification") != "native":
                print("[imo verify] failed: skill semantic behavior: architecture-health must be native", file=sys.stderr)
                return False

            if arch.get("external_references") != []:
                print("[imo verify] failed: skill semantic behavior: architecture-health external_references must be []", file=sys.stderr)
                return False

            if any(_is_error(issue) for issue in arch.get("issues") or []):
                print("[imo verify] failed: skill semantic behavior: architecture-health has error issue", file=sys.stderr)
                return False

            provider_ok = any(
                isinstance(m, dict)
                and m.get("classification") == "provider-backed"
                and m.get("provider_status") == "unavailable"
                and isinstance(m.get("issues"), list)
                and len(m.get("issues")) > 0
                and all(_is_warning(issue) for issue in m.get("issues"))
                for m in modules
            )
            if not provider_ok:
                print(
                    "[imo verify] failed: skill semantic behavior: no provider-backed unavailable module with only warning issues",
                    file=sys.stderr,
                )
                return False

            print("[imo verify] ok: skill semantic behavior")
            return True

    except Exception as exc:
        print(f"[imo verify] failed: skill semantic behavior: unexpected error: {exc}", file=sys.stderr)
        return False


if __name__ == "__main__":
    raise SystemExit(0 if _run_skill_semantics_smoke() else 1)
