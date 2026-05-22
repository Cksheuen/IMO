from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from .runner import ROOT


def _hash_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _run_install_smoke() -> bool:
    print("[imo verify] install lifecycle")
    target = Path(tempfile.mkdtemp(prefix="imo-install-smoke-"))
    try:
        initialized = subprocess.run(
            ["./imo", "init", str(target)],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if initialized.returncode != 0:
            print("[imo verify] failed: installer init", file=sys.stderr)
            if initialized.stderr:
                print(initialized.stderr, file=sys.stderr)
            return False

        manifest = target / ".imo/.runtime/install/managed-hashes.json"
        if not manifest.is_file():
            print("[imo verify] failed: installer manifest missing", file=sys.stderr)
            return False
        data = json.loads(manifest.read_text(encoding="utf-8"))
        files = data.get("files", {})
        required = {
            "imo",
            ".imo/project.json",
            ".imo/product/scripts/imo.sh",
            ".imo/product/scripts/install.py",
            "scripts/imo.sh",
        }
        if data.get("schema_version") != 1 or not required.issubset(files):
            print("[imo verify] failed: installer manifest shape", file=sys.stderr)
            return False
        marker = json.loads((target / ".imo/project.json").read_text(encoding="utf-8"))
        if marker.get("schema_version") != 1 or marker.get("install_mode") != "project":
            print("[imo verify] failed: project marker shape", file=sys.stderr)
            return False

        nested_env = os.environ.copy()
        nested_env["IMO_VERIFY_SKIP_INSTALL_SMOKE"] = "1"
        verified = subprocess.run(
            [str(target / "imo"), "verify"],
            cwd=target,
            env=nested_env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if verified.returncode != 0:
            print("[imo verify] failed: installed target verify", file=sys.stderr)
            if verified.stderr:
                print(verified.stderr, file=sys.stderr)
            return False

        runtime_digest = target / ".imo/.runtime/learning/digest.json"
        runtime_digest.parent.mkdir(parents=True, exist_ok=True)
        runtime_digest.write_text('{"items":[{"id":"keep","status":"active","scope":"project"}]}\n', encoding="utf-8")

        script_to_refresh = target / "scripts/imo.sh"
        old_script_text = "#!/usr/bin/env bash\necho old managed script\n"
        script_to_refresh.write_text(old_script_text, encoding="utf-8")
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["files"]["scripts/imo.sh"]["hash"] = _hash_text(old_script_text)
        manifest.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        updated = subprocess.run(
            ["./imo", "update", str(target)],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if updated.returncode != 0:
            print("[imo verify] failed: installer update", file=sys.stderr)
            if updated.stderr:
                print(updated.stderr, file=sys.stderr)
            return False
        if "files preserved: 0" not in updated.stdout:
            print("[imo verify] failed: installer update did not report preserved count", file=sys.stderr)
            return False
        if script_to_refresh.read_text(encoding="utf-8") == old_script_text:
            print("[imo verify] failed: installer update did not refresh unchanged managed file", file=sys.stderr)
            return False
        if not runtime_digest.is_file() or "keep" not in runtime_digest.read_text(encoding="utf-8"):
            print("[imo verify] failed: installer update changed runtime learning state", file=sys.stderr)
            return False

        readme = target / ".imo/README.md"
        readme_local_text = readme.read_text(encoding="utf-8") + "\nlocal edit\n"
        readme.write_text(readme_local_text, encoding="utf-8")
        preserved = subprocess.run(
            ["./imo", "update", str(target)],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if preserved.returncode != 0 or "files preserved: 1" not in preserved.stdout:
            print("[imo verify] failed: installer update preserve-local behavior", file=sys.stderr)
            if preserved.stderr:
                print(preserved.stderr, file=sys.stderr)
            return False
        if readme.read_text(encoding="utf-8") != readme_local_text:
            print("[imo verify] failed: installer update overwrote preserved local edit", file=sys.stderr)
            return False

        refused = subprocess.run(
            ["./imo", "update", str(target), "--strict"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if refused.returncode == 0 or "refused to overwrite" not in refused.stderr:
            print("[imo verify] failed: installer update strict conflict guard", file=sys.stderr)
            return False

        forced = subprocess.run(
            ["./imo", "update", str(target), "--force"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if forced.returncode != 0 or readme.read_text(encoding="utf-8") == readme_local_text:
            print("[imo verify] failed: installer update force overwrite", file=sys.stderr)
            if forced.stderr:
                print(forced.stderr, file=sys.stderr)
            return False

        removed = subprocess.run(
            ["./imo", "uninstall", str(target), "--force"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if removed.returncode != 0:
            print("[imo verify] failed: installer uninstall", file=sys.stderr)
            if removed.stderr:
                print(removed.stderr, file=sys.stderr)
            return False
        if (target / "imo").exists() or (target / ".imo/product").exists():
            print("[imo verify] failed: installer uninstall left managed files", file=sys.stderr)
            return False

        print("[imo verify] ok: install lifecycle")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: install lifecycle: {exc}", file=sys.stderr)
        return False
    finally:
        shutil.rmtree(target, ignore_errors=True)
