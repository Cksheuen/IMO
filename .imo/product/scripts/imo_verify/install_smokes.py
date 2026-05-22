from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from .runner import ROOT


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

        readme = target / ".imo/README.md"
        readme.write_text(readme.read_text(encoding="utf-8") + "\nlocal edit\n", encoding="utf-8")
        refused = subprocess.run(
            ["./imo", "update", str(target)],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if refused.returncode == 0 or "refused to overwrite" not in refused.stderr:
            print("[imo verify] failed: installer update conflict guard", file=sys.stderr)
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
