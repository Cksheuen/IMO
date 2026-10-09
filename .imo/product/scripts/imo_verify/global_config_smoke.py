"""Smoke coverage for global configuration diagnostics."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

from .runner import ROOT


SCRIPT = ".imo/product/scripts/global_config.py"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _run(
    global_root: Path, codex_root: Path, *args: str
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            SCRIPT,
            *args,
            "--global-root",
            str(global_root),
            "--codex-root",
            str(codex_root),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def _assert_installed(global_root: Path, codex_root: Path) -> None:
    proc = _run(global_root, codex_root, "install", "--apply", "--force")
    assert proc.returncode == 0, f"install failed: {proc.stderr}"

    proc = _run(global_root, codex_root, "status", "--json")
    assert proc.returncode == 0, f"status failed: {proc.stderr}"
    payload = json.loads(proc.stdout)
    assert payload["healthy"] is True, "status reports unhealthy"
    assert set(payload["states"].values()) == {"present"}, "states not all present"
    assert "claude_codex_bridge" not in payload, "retired Claude/Codex bridge status leaked into diagnostics"

    ownership = json.loads(
        (global_root / "install/codex/ownership.json").read_text(encoding="utf-8")
    )
    assert "claude_to_codex_sync" not in ownership, "retired Claude sync marker leaked into ownership"
    assert "mcp_bridge" not in ownership, "retired bridge marker leaked into ownership"

    proc = _run(global_root, codex_root, "doctor", "--json")
    assert proc.returncode == 0, f"doctor failed: {proc.stderr}"


def _assert_managed_block_boundary(global_root: Path, codex_root: Path) -> None:
    agents = global_root / "install/codex/AGENTS.md"
    manifest = global_root / "install/managed-hashes.json"

    user_prefix = "# User-owned instruction\n\n"
    agents.write_text(user_prefix + agents.read_text(), encoding="utf-8")

    status = _run(global_root, codex_root, "status", "--json")
    assert status.returncode == 0, "status rc for user content"
    data = json.loads(status.stdout)
    assert data["states"]["codex_instructions"] == "present", "user content caused drift"

    install = _run(global_root, codex_root, "install", "--apply")
    assert install.returncode == 0, f"managed update refused user content: {install.stderr}"
    assert agents.read_text(encoding="utf-8").startswith(user_prefix), "user content was overwritten"

    agents.write_text(
        agents.read_text(encoding="utf-8").replace("Codex-owned", "Codex-OWNED", 1),
        encoding="utf-8",
    )

    status = _run(global_root, codex_root, "status", "--json")
    assert status.returncode == 0, "status rc"
    data = json.loads(status.stdout)
    state = data["states"]["codex_instructions"]
    assert state == "conflict", "managed block mutation was not isolated"

    doctor = _run(global_root, codex_root, "doctor", "--json")
    assert doctor.returncode == 1, "doctor rc"

    agents_sha = _sha(agents)
    manifest_sha = _sha(manifest)

    install = _run(global_root, codex_root, "install")
    assert install.returncode == 1, "install rc"
    assert "refused" in install.stderr, "install refused"
    assert _sha(agents) == agents_sha, "agents changed"
    assert _sha(manifest) == manifest_sha, "manifest changed"


def _assert_uninstall_preserves_user_content(global_root: Path, codex_root: Path) -> None:
    _assert_installed(global_root, codex_root)
    agents = global_root / "install/codex/AGENTS.md"
    prefix = "# Keep me after uninstall\n\n"
    agents.write_text(prefix + agents.read_text(encoding="utf-8"), encoding="utf-8")
    install = _run(global_root, codex_root, "install", "--apply")
    assert install.returncode == 0, "failed to record external instruction content"

    uninstall = _run(global_root, codex_root, "uninstall", "--apply")
    assert uninstall.returncode == 0, f"uninstall failed: {uninstall.stderr}"
    assert agents.is_file(), "external instruction content was deleted"
    text = agents.read_text(encoding="utf-8")
    assert text == prefix, "managed block was not removed cleanly"


def _run_global_config_smoke() -> bool:
    print("[imo verify] global config diagnostics")
    try:
        with tempfile.TemporaryDirectory(prefix="imo-global-config-smoke-") as raw:
            base = Path(raw)
            global_root = base / "global"
            codex_root = base / "codex"
            _assert_installed(global_root, codex_root)
            _assert_managed_block_boundary(global_root, codex_root)
            _assert_uninstall_preserves_user_content(
                base / "global-uninstall", base / "codex-uninstall"
            )
        print("ok")
        return True
    except Exception as exc:
        print(f"failed: {exc}", file=sys.stderr)
        return False
