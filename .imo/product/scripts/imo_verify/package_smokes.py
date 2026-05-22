from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from .runner import ROOT


def _package_file_names(pack_stdout: str) -> set[str]:
    try:
        payload = json.loads(pack_stdout)
    except json.JSONDecodeError:
        return set()
    if not isinstance(payload, list) or not payload:
        return set()
    first = payload[0]
    if not isinstance(first, dict):
        return set()
    files = first.get("files")
    if not isinstance(files, list):
        return set()
    names: set[str] = set()
    for item in files:
        if isinstance(item, dict) and isinstance(item.get("path"), str):
            names.add(item["path"])
    return names


def _run_package_smoke() -> bool:
    print("[imo verify] package wrapper")
    package_path = ROOT / "package.json"
    bin_path = ROOT / "bin/imo.js"
    if not package_path.exists() and not bin_path.exists():
        print("[imo verify] ok: package wrapper (not a package root; skipped)")
        return True
    if not package_path.is_file() or not bin_path.is_file():
        print("[imo verify] failed: package wrapper files missing", file=sys.stderr)
        return False

    package = json.loads(package_path.read_text(encoding="utf-8"))
    if package.get("bin", {}).get("imo") != "./bin/imo.js":
        print("[imo verify] failed: package bin does not expose imo", file=sys.stderr)
        return False

    node = shutil.which("node")
    if node is None:
        print("[imo verify] ok: package wrapper (node unavailable; link smoke skipped)")
        return True

    syntax = subprocess.run(
        [node, "--check", "bin/imo.js"],
        cwd=ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if syntax.returncode != 0:
        print("[imo verify] failed: package wrapper syntax", file=sys.stderr)
        if syntax.stderr:
            print(syntax.stderr, file=sys.stderr)
        return False

    helped = subprocess.run(
        [node, "bin/imo.js", "--help"],
        cwd=ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if helped.returncode != 0 or "imo: repo-local IMO command surface" not in helped.stdout:
        print("[imo verify] failed: package wrapper help", file=sys.stderr)
        if helped.stderr:
            print(helped.stderr, file=sys.stderr)
        return False

    npm = shutil.which("npm")
    if npm is not None:
        cache_dir = Path(tempfile.mkdtemp(prefix="imo-npm-cache-"))
        try:
            env = os.environ.copy()
            env["npm_config_cache"] = str(cache_dir)
            packed = subprocess.run(
                [npm, "pack", "--dry-run", "--json"],
                cwd=ROOT,
                env=env,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        finally:
            shutil.rmtree(cache_dir, ignore_errors=True)
        if packed.returncode != 0:
            print("[imo verify] failed: npm pack dry-run", file=sys.stderr)
            if packed.stderr:
                print(packed.stderr, file=sys.stderr)
            return False
        names = _package_file_names(packed.stdout)
        required = {"package.json", "bin/imo.js", "imo", ".imo/product/scripts/imo.sh"}
        if names and not required.issubset(names):
            missing = ", ".join(sorted(required - names))
            print(f"[imo verify] failed: npm pack missing {missing}", file=sys.stderr)
            return False

    print("[imo verify] ok: package wrapper")
    return True
