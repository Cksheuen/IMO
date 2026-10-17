from __future__ import annotations

import json
import os
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

            # Test optional-provider behavior independently of the real registry.
            fixture = Path(home) / "fixture"
            skills = fixture / ".imo" / "product" / "skills"
            surface = skills / "missing-provider"
            surface.mkdir(parents=True)
            providers = fixture / ".imo" / "providers" / "registry.json"
            providers.parent.mkdir()
            providers.write_text(json.dumps({"providers": []}), encoding="utf-8")
            (skills / "modules.json").write_text(json.dumps({"modules": [{
                "id": "missing-provider",
                "classification": "provider-backed",
                "owner_surface": ".imo/product/skills/missing-provider",
                "default_enabled": True,
                "external_dependencies": ["fixture-provider"],
            }]}), encoding="utf-8")
            (surface / "SKILL.md").write_text(
                "---\nname: missing-provider\n"
                "description: Exercises an unavailable optional provider.\n---\n"
                "Provider input: `~/.claude/fixture-provider/config.json`.\n",
                encoding="utf-8",
            )
            proc = subprocess.run(
                [sys.executable, str(checker), "--root", str(fixture),
                 "--home", home, "--json"],
                capture_output=True, text=True, check=False,
            )
            if proc.returncode != 0:
                print(
                    f"[imo verify] failed: skill semantic behavior: fixture checker exit {proc.returncode}: {proc.stderr.strip()}",
                    file=sys.stderr,
                )
                return False
            data = json.loads(proc.stdout)
            summary = data.get("summary")
            if not isinstance(summary, dict) or summary.get("errors") != 0:
                print("[imo verify] failed: skill semantic behavior: fixture summary.errors must be 0", file=sys.stderr)
                return False
            unavailable = summary.get("unavailable")
            if not isinstance(unavailable, int) or unavailable < 1:
                print("[imo verify] failed: skill semantic behavior: fixture summary.unavailable must be >= 1", file=sys.stderr)
                return False
            modules = data.get("modules")
            if not isinstance(modules, list):
                print("[imo verify] failed: skill semantic behavior: fixture modules must be a list", file=sys.stderr)
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

            # Arbitrary PATH provider IDs prove discovery comes from the registry.
            providers.write_text(json.dumps({"providers": [
                {"id": "fixture-cli-a", "discovery": {"inputs": ["PATH"]}},
                {"id": "fixture-cli-b", "discovery": {"inputs": ["environment", "PATH"]}},
                {"id": "fixture-data", "discovery": {"inputs": ["local-config"]}},
            ]}), encoding="utf-8")
            # Missing command providers must warn, even on machines with no CLIs.
            (skills / "modules.json").write_text(json.dumps({"modules": [{
                "id": "command-provider", "classification": "provider-backed",
                "owner_surface": ".imo/product/skills/missing-provider",
                "default_enabled": True, "external_dependencies": ["fixture-cli-a", "fixture-cli-b", "fixture-data"],
            }]}), encoding="utf-8")
            (surface / "SKILL.md").write_text("Use the declared command providers.\n", encoding="utf-8")
            proc = subprocess.run(
                [sys.executable, str(checker), "--root", str(fixture), "--json"],
                env=dict(os.environ, PATH=""), capture_output=True, text=True, check=False,
            )
            data = json.loads(proc.stdout)
            summary = data["summary"]
            if proc.returncode != 0 or summary != {"errors": 0, "warnings": 2, "unavailable": 1}:
                print("[imo verify] failed: missing command providers must only warn", file=sys.stderr)
                return False

            print("[imo verify] ok: skill semantic behavior")
            return True

    except Exception as exc:
        print(f"[imo verify] failed: skill semantic behavior: unexpected error: {exc}", file=sys.stderr)
        return False


if __name__ == "__main__":
    raise SystemExit(0 if _run_skill_semantics_smoke() else 1)
