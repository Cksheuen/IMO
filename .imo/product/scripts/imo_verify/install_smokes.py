from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import root_resolver

from .runner import ROOT


def _hash_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _run_root_resolver_smoke() -> bool:
    print("[imo verify] root resolver")
    previous_global_root = os.environ.get("IMO_GLOBAL_ROOT")
    previous_project_root = os.environ.get("IMO_PROJECT_ROOT")
    base = Path(tempfile.mkdtemp(prefix="imo-root-resolver-smoke-"))
    try:
        os.environ.pop("IMO_PROJECT_ROOT", None)
        home = base / "home"
        global_root = home / ".imo"
        global_root.mkdir(parents=True)
        workspace = home / "workspace"
        latam = workspace / "latam-c"
        nested = latam / "nested"
        nested.mkdir(parents=True)
        os.environ["IMO_GLOBAL_ROOT"] = str(global_root)

        if root_resolver.resolve_project_root(nested) is not None:
            print("[imo verify] failed: unregistered start resolved to a root", file=sys.stderr)
            return False

        projects_dir = global_root / "projects"

        def write_registration(name: str, payload: dict[str, object]) -> None:
            registration = projects_dir / name / "project.json"
            registration.parent.mkdir(parents=True, exist_ok=True)
            registration.write_text(json.dumps(payload), encoding="utf-8")

        write_registration(
            "shallow",
            {"install_mode": "global-zero-install", "project_root": str(workspace)},
        )
        write_registration(
            "deep",
            {"install_mode": "global-zero-install", "project_root": str(latam)},
        )
        bad_json = projects_dir / "bad-json" / "project.json"
        bad_json.parent.mkdir(parents=True, exist_ok=True)
        bad_json.write_text("{not valid json", encoding="utf-8")
        write_registration("missing-project-root", {"install_mode": "global-zero-install"})
        write_registration(
            "missing-directory",
            {
                "install_mode": "global-zero-install",
                "project_root": str(home / "does-not-exist"),
            },
        )

        if root_resolver.resolve_project_root(nested) != latam.resolve():
            print("[imo verify] failed: nested start did not resolve to deepest registration", file=sys.stderr)
            return False

        local_root = latam / "local"
        (local_root / ".imo").mkdir(parents=True)
        local_child = local_root / "child"
        local_child.mkdir()
        if root_resolver.resolve_project_root(local_child) != local_root.resolve():
            print("[imo verify] failed: deeper local .imo root lost to shallower registration", file=sys.stderr)
            return False

        git_root = latam / "git"
        (git_root / ".git").mkdir(parents=True)
        git_child = git_root / "child"
        git_child.mkdir()
        if root_resolver.resolve_project_root(git_child) != git_root.resolve():
            print("[imo verify] failed: deeper local git root lost to shallower registration", file=sys.stderr)
            return False

        forced_root = base / "forced"
        forced_root.mkdir()
        os.environ["IMO_PROJECT_ROOT"] = str(forced_root)
        if root_resolver.resolve_project_root(nested) != forced_root.resolve():
            print("[imo verify] failed: IMO_PROJECT_ROOT did not override resolution", file=sys.stderr)
            return False

        explicit_root = base / "explicit"
        explicit_root.mkdir()
        if root_resolver.resolve_project_root(nested, explicit=explicit_root) != explicit_root.resolve():
            print("[imo verify] failed: explicit root did not override IMO_PROJECT_ROOT", file=sys.stderr)
            return False

        print("[imo verify] ok: root resolver")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: root resolver: {exc}", file=sys.stderr)
        return False
    finally:
        if previous_global_root is None:
            os.environ.pop("IMO_GLOBAL_ROOT", None)
        else:
            os.environ["IMO_GLOBAL_ROOT"] = previous_global_root
        if previous_project_root is None:
            os.environ.pop("IMO_PROJECT_ROOT", None)
        else:
            os.environ["IMO_PROJECT_ROOT"] = previous_project_root
        shutil.rmtree(base, ignore_errors=True)


def _run_install_smoke() -> bool:
    print("[imo verify] zero-install project lifecycle")
    target = Path(tempfile.mkdtemp(prefix="imo-project-smoke-"))
    global_root = Path(tempfile.mkdtemp(prefix="imo-project-global-"))
    env = os.environ.copy()
    env["IMO_GLOBAL_ROOT"] = str(global_root)
    env.pop("IMO_PROJECT_RUNTIME_ROOT", None)
    try:
        initialized = subprocess.run(
            ["./imo", "init", str(target)],
            cwd=ROOT,
            env=env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if initialized.returncode != 0 or "repository files written: 0" not in initialized.stdout:
            print("[imo verify] failed: zero-install project init", file=sys.stderr)
            if initialized.stderr:
                print(initialized.stderr, file=sys.stderr)
            return False
        if (target / ".imo").exists() or (target / "imo").exists() or (target / "skills").exists():
            print("[imo verify] failed: project init wrote framework files", file=sys.stderr)
            return False

        registrations = list((global_root / "projects").glob("*/project.json"))
        if len(registrations) != 1:
            print("[imo verify] failed: project registration missing", file=sys.stderr)
            return False
        registration = json.loads(registrations[0].read_text(encoding="utf-8"))
        if registration.get("project_root") != str(target.resolve()) or registration.get("install_mode") != "global-zero-install":
            print("[imo verify] failed: project registration shape", file=sys.stderr)
            return False

        runtime_digest = registrations[0].parent / "runtime/learning/digest.json"
        runtime_digest.parent.mkdir(parents=True, exist_ok=True)
        runtime_digest.write_text('{"items":[{"id":"keep"}]}\n', encoding="utf-8")

        legacy_text = "#!/usr/bin/env bash\necho legacy\n"
        legacy_file = target / "imo"
        legacy_file.write_text(legacy_text, encoding="utf-8")
        manifest = target / ".imo/.runtime/install/managed-hashes.json"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "files": {"imo": {"kind": "file", "hash": _hash_text(legacy_text)}},
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        (target / ".gitignore").write_text(
            "keep\n# IMO:START managed direct-run profile\n!imo\n# IMO:END managed direct-run profile\n",
            encoding="utf-8",
        )

        removed = subprocess.run(
            ["./imo", "uninstall", str(target)],
            cwd=ROOT,
            env=env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if removed.returncode != 0 or legacy_file.exists():
            print("[imo verify] failed: legacy project uninstall", file=sys.stderr)
            if removed.stderr:
                print(removed.stderr, file=sys.stderr)
            return False
        if "IMO:START" in (target / ".gitignore").read_text(encoding="utf-8"):
            print("[imo verify] failed: legacy gitignore block remained", file=sys.stderr)
            return False
        if not runtime_digest.is_file() or registrations[0].exists():
            print("[imo verify] failed: uninstall did not preserve runtime or remove registration", file=sys.stderr)
            return False

        print("[imo verify] ok: zero-install project lifecycle")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: zero-install project lifecycle: {exc}", file=sys.stderr)
        return False
    finally:
        shutil.rmtree(target, ignore_errors=True)
        shutil.rmtree(global_root, ignore_errors=True)
