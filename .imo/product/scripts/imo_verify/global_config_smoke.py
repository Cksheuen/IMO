"""Smoke coverage for global configuration diagnostics."""

from __future__ import annotations

import hashlib
import json
import os
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
            "--claude-home",
            str(codex_root.parent / (codex_root.name + "-claude")),
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


def _assert_both_hosts(base: Path) -> None:
    base = base.resolve()
    global_root, codex_root = base / "global", base / "codex"
    claude = base / "codex-claude"
    claude.mkdir(parents=True)
    other = {"hooks": [{"type": "command", "command": "echo unrelated"}]}
    settings = {"theme": "dark", "hooks": {"SessionStart": [other], "UserPromptSubmit": []}}
    (claude / "settings.json").write_text(json.dumps(settings))
    codex_root.mkdir()
    command = str(global_root / "hooks/codex-context.sh")
    (codex_root / "hooks.json").write_text(json.dumps({"hooks": {"UserPromptSubmit": [
        {"hooks": [{"type": "command", "command": command}, {"type": "command", "command": "echo prompt"}]}]}}))
    proc = _run(global_root, codex_root, "install", "--host", "both", "--apply")
    assert proc.returncode == 0, proc.stderr
    for root in (codex_root, claude):
        assert len(list((root / "skills").iterdir())) == 6
        assert all(path.is_symlink() for path in (root / "skills").iterdir())
    hooks = json.loads((codex_root / "hooks.json").read_text())["hooks"]
    assert hooks["SessionStart"][0]["hooks"][0]["command"] == command
    assert hooks["UserPromptSubmit"] == [{"hooks": [{"type": "command", "command": "echo prompt"}]}]
    assert (codex_root / "imo-worker.config.toml").is_file()
    assert not (claude / "CLAUDE.md").exists()
    assert _run(global_root, codex_root, "doctor", "--json").returncode == 0
    manifest_path = global_root / "install/managed-hashes.json"
    manifest = json.loads(manifest_path.read_text())
    assert manifest["codex_hooks"]["event"] == "SessionStart"
    for host, root in (("codex", codex_root), ("claude", claude)):
        target = ROOT / ".imo/product/skills/retired-test-skill"
        link = root / "skills/retired-test-skill"
        link.symlink_to(target)
        manifest[host + "_skills"][link.name] = {"target": str(target), "previous": None}
    manifest_path.write_text(json.dumps(manifest))
    doctor = _run(global_root, codex_root, "doctor", "--json")
    assert doctor.returncode == 1
    data = json.loads(doctor.stdout)
    assert data["states"]["codex_skill_projections"] == "stale"
    assert data["states"]["claude_skill_projections"] == "stale"
    assert any("retired-test-skill" in issue for issue in data["issues"])
    assert _run(global_root, codex_root, "install", "--apply").returncode == 0
    for root in (codex_root, claude):
        assert not (root / "skills/retired-test-skill").is_symlink()
    assert _run(global_root, codex_root, "doctor", "--json").returncode == 0
    profile = codex_root / "imo-worker.config.toml"
    # Codex writes its own state into the active profile; that must stay healthy and kept.
    profile.write_text(profile.read_text() + '\n[tui.model_availability_nux]\n"some-model" = 4\n')
    assert _run(global_root, codex_root, "doctor", "--json").returncode == 0
    assert _run(global_root, codex_root, "install", "--apply").returncode == 0
    assert "[tui.model_availability_nux]" in profile.read_text()
    original = profile.read_text()
    profile.write_text("# user modified\n")
    assert _run(global_root, codex_root, "install", "--apply").returncode == 1
    assert _run(global_root, codex_root, "uninstall", "--apply").returncode == 1
    profile.write_text(original)
    proc = _run(global_root, codex_root, "uninstall", "--apply")
    assert proc.returncode == 0, proc.stderr
    for root in (codex_root, claude):
        assert not list((root / "skills").iterdir())
    assert not profile.exists()
    assert json.loads((claude / "settings.json").read_text()) == settings
    assert "SessionStart" not in json.loads((codex_root / "hooks.json").read_text())["hooks"]
    env = {**os.environ, "IMO_GLOBAL_ROOT": str(global_root), "CODEX_HOME": str(codex_root), "CLAUDE_HOME": str(claude)}
    proc = subprocess.run(["./imo", "codex", "context", "--event", "SessionStart", "--empty"], cwd=ROOT, env=env, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout)["hookSpecificOutput"]["hookEventName"] == "SessionStart"


def _assert_host_boundaries(base: Path) -> None:
    base = base.resolve()
    global_root, codex = base / "global", base / "codex"
    claude = base / "codex-claude"
    claude.mkdir(parents=True)
    settings = claude / "settings.json"
    settings.write_text("invalid JSON")
    assert _run(global_root, codex, "install", "--apply").returncode == 1
    assert not global_root.exists() and not codex.exists()
    settings.write_text("{}")
    proc = _run(global_root, codex, "install", "--host", "claude", "--apply")
    assert proc.returncode == 0, proc.stderr
    assert not codex.exists()
    data = json.loads(_run(global_root, codex, "doctor", "--json").stdout)
    assert data["healthy"] and data["hosts"] == ["claude"]
    assert not any(key.startswith("codex") for key in data["states"])
    assert _run(global_root, codex, "install", "--host", "codex", "--apply").returncode == 0
    assert _run(global_root, codex, "uninstall", "--host", "claude", "--apply").returncode == 0
    data = json.loads(_run(global_root, codex, "doctor", "--json").stdout)
    assert data["healthy"] and data["hosts"] == ["codex"]
    # Simulate an old manifest and a pre-SessionStart hook registration.
    manifest_path = global_root / "install/managed-hashes.json"
    manifest = json.loads(manifest_path.read_text())
    manifest.pop("hosts")
    manifest["schema_version"] = 4
    manifest["codex_hooks"]["event"] = "UserPromptSubmit"
    manifest_path.write_text(json.dumps(manifest))
    hooks_path = codex / "hooks.json"
    hooks = json.loads(hooks_path.read_text())
    hooks["hooks"]["UserPromptSubmit"] = hooks["hooks"].pop("SessionStart")
    hooks_path.write_text(json.dumps(hooks))
    doctor = _run(global_root, codex, "doctor", "--json")
    assert doctor.returncode == 1
    data = json.loads(doctor.stdout)
    assert data["hosts"] == ["codex"]
    assert data["states"]["codex_hook_registration"] == "stale"
    assert _run(global_root, codex, "install", "--host", "codex", "--apply").returncode == 0
    assert "UserPromptSubmit" not in json.loads(hooks_path.read_text())["hooks"]
    # Retired projections restore the original symlink, including dangling links.
    manifest = json.loads(manifest_path.read_text())
    link = codex / "skills/retired"
    target = ROOT / ".imo/product/skills/retired"
    link.symlink_to(target)
    manifest["codex_skills"]["retired"] = {"target": str(target), "previous": {"kind": "symlink", "target": "../original"}}
    manifest_path.write_text(json.dumps(manifest))
    assert _run(global_root, codex, "install", "--host", "codex", "--apply").returncode == 0
    assert os.readlink(link) == "../original"
    assert _run(global_root, codex, "uninstall", "--apply").returncode == 0
    assert os.readlink(link) == "../original"


def _run_global_config_smoke() -> bool:
    print("[imo verify] global config diagnostics")
    try:
        with tempfile.TemporaryDirectory(prefix="imo-global-config-smoke-") as raw:
            base = Path(raw)
            global_root = base / "global"
            codex_root = base / "codex"
            _assert_both_hosts(base / "both")
            _assert_host_boundaries(base / "boundaries")
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
