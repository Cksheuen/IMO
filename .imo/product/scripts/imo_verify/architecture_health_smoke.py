from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SCANNER = ROOT / ".imo" / "product" / "skills" / "architecture-health" / "scripts" / "scan.py"


def _fail(reason: str) -> bool:
    print(f"[imo verify] failed: architecture health {reason}", file=sys.stderr)
    return False


def _run_scanner(path: Path, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(SCANNER),
            "--path",
            str(path),
            "--domain",
            "general",
            "--format",
            "json",
        ],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        timeout=60,
    )


def _load_json(proc: subprocess.CompletedProcess[str], label: str) -> object:
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise AssertionError(
            f"{label} returned invalid JSON: {exc}; stderr={proc.stderr.strip()}"
        ) from exc


def _run_architecture_health_smoke() -> bool:
    try:
        with tempfile.TemporaryDirectory(prefix="imo_arch_health_") as tmp:
            tmp_path = Path(tmp)

            small = tmp_path / "small"
            small.mkdir()
            (small / "app.py").write_text(
                "def main():\n"
                "    print('architecture health')\n\n"
                "if __name__ == '__main__':\n"
                "    main()\n",
                encoding="utf-8",
            )

            proc = _run_scanner(small, tmp_path)
            if proc.returncode != 0:
                return _fail(f"small scan returned {proc.returncode}: {proc.stderr.strip()}")

            data = _load_json(proc, "small scan")
            if not isinstance(data, dict):
                return _fail("small scan JSON is not an object")

            for key in ("schema_version", "metrics", "triggered_upgrades", "current_stage"):
                if key not in data:
                    return _fail(f"small scan missing {key}")

            if not isinstance(data["schema_version"], str) or not data["schema_version"]:
                return _fail("small scan has invalid schema_version")
            if not isinstance(data["metrics"], dict):
                return _fail("small scan metrics is not an object")
            if not isinstance(data["triggered_upgrades"], list):
                return _fail("small scan triggered_upgrades is not a list")
            if data["current_stage"] != "bootstrap":
                return _fail(f"small scan current_stage={data['current_stage']!r}")

            hidden = tmp_path / "hidden-source"
            canonical = hidden / ".imo" / "product"
            projected = hidden / "scripts"
            canonical.mkdir(parents=True)
            projected.mkdir(parents=True)
            source = canonical / "source.py"
            source.write_text("def hidden_source():\n    return True\n", encoding="utf-8")
            (projected / "source.py").symlink_to(source)

            proc = _run_scanner(hidden, tmp_path)
            if proc.returncode != 0:
                return _fail(f"hidden scan returned {proc.returncode}: {proc.stderr.strip()}")
            data = _load_json(proc, "hidden scan")
            if not isinstance(data, dict) or data.get("metrics", {}).get("scanned_files") != 1:
                return _fail("hidden canonical source was skipped or projection was double-counted")

            same_names = tmp_path / "same-names"
            same_names.mkdir()
            for name in ("one.py", "two.py"):
                (same_names / name).write_text("def main():\n    return 0\n", encoding="utf-8")
            proc = _run_scanner(same_names, tmp_path)
            data = _load_json(proc, "same-name scan")
            if not isinstance(data, dict) or data.get("metrics", {}).get("duplicate_function_name_count") != 0:
                return _fail("same function name in separate modules was treated as duplication")

            large = tmp_path / "large"
            large.mkdir()
            lines = ["# generated large file"]
            lines.extend(
                f"def function_{i}(value):\n    return value + {i}\n" for i in range(420)
            )
            (large / "large_app.py").write_text("\n".join(lines) + "\n", encoding="utf-8")

            proc = _run_scanner(large, tmp_path)
            if proc.returncode != 0:
                return _fail(f"large scan returned {proc.returncode}: {proc.stderr.strip()}")

            data = _load_json(proc, "large scan")
            if not isinstance(data, dict):
                return _fail("large scan JSON is not an object")
            if data.get("current_stage") != "needs_structured":
                return _fail(f"large scan current_stage={data.get('current_stage')!r}")
            if not data.get("triggered_upgrades"):
                return _fail("large scan triggered_upgrades is empty")

            bad_path = tmp_path / "does_not_exist"
            proc = _run_scanner(bad_path, tmp_path)
            if proc.returncode == 0:
                return _fail("bad path scan unexpectedly succeeded")

        print("[imo verify] ok: architecture health behavior")
        return True
    except Exception as exc:
        return _fail(str(exc))


if __name__ == "__main__":
    raise SystemExit(0 if _run_architecture_health_smoke() else 1)
