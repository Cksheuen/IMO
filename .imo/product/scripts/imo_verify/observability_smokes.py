from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from .runner import ROOT


def _read_events(runtime_dir: Path) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for path in sorted((runtime_dir / "events").glob("*.jsonl")):
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                stripped = line.strip()
                if stripped:
                    event = json.loads(stripped)
                    if isinstance(event, dict):
                        events.append(event)
    return events


def _load_observability_helper():
    module_path = ROOT / ".imo/product/scripts/observability_events.py"
    spec = importlib.util.spec_from_file_location("imo_observability_events_verify", module_path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_observability_smoke() -> bool:
    print("[imo verify] observability metrics")
    runtime_dir = ROOT / ".imo/.runtime/observability"
    backup_dir: Path | None = None

    try:
        if runtime_dir.exists():
            backup_dir = Path(tempfile.mkdtemp(prefix="imo-observability-backup-"))
            shutil.copytree(runtime_dir, backup_dir / "observability", dirs_exist_ok=True)
            shutil.rmtree(runtime_dir)

        missing_summary = subprocess.run(
            ["./imo", "metrics", "summary", "--json"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if missing_summary.returncode != 0:
            print("[imo verify] failed: missing observability summary", file=sys.stderr)
            return False
        missing_payload = json.loads(missing_summary.stdout)
        if missing_payload.get("total_events") != 0:
            print("[imo verify] failed: missing observability summary count", file=sys.stderr)
            return False
        if runtime_dir.exists():
            print("[imo verify] failed: metrics summary created observability runtime", file=sys.stderr)
            return False

        missing_status = subprocess.run(
            ["./imo", "metrics", "status", "--json"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if missing_status.returncode != 0:
            print("[imo verify] failed: missing observability status", file=sys.stderr)
            return False
        status_payload = json.loads(missing_status.stdout)
        observability = status_payload.get("observability", {})
        if not isinstance(observability, dict) or observability.get("status") != "missing":
            print("[imo verify] failed: missing observability status shape", file=sys.stderr)
            return False
        if runtime_dir.exists():
            print("[imo verify] failed: metrics status created observability runtime", file=sys.stderr)
            return False

        profile_status = subprocess.run(
            ["./imo", "profile", "status"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if profile_status.returncode != 0:
            print("[imo verify] failed: observed profile status command", file=sys.stderr)
            return False

        profile_bad = subprocess.run(
            ["./imo", "profile", "nope"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if profile_bad.returncode == 0:
            print("[imo verify] failed: invalid profile command succeeded", file=sys.stderr)
            return False

        helper = _load_observability_helper()
        if helper is None:
            print("[imo verify] failed: could not load observability helper", file=sys.stderr)
            return False
        unknown_written = helper.write_event(
            "unknown_event",
            plane="command",
            component="imo-verify",
            operation="observability_smoke",
            phase="end",
        )
        unsafe_written = helper.write_event(
            "command_end",
            plane="command",
            component="imo-verify",
            operation="observability_smoke",
            phase="end",
            outcome="error",
            reason="x" * 220,
            raw_prompt="must-not-persist",
        )
        if unknown_written or not unsafe_written:
            print("[imo verify] failed: observability event helper validation", file=sys.stderr)
            return False

        events = _read_events(runtime_dir)
        if len(events) < 5:
            print("[imo verify] failed: expected observed command events", file=sys.stderr)
            return False
        event_payload = json.dumps(events, ensure_ascii=True, sort_keys=True)
        if "must-not-persist" in event_payload or "profile nope" in event_payload:
            print("[imo verify] failed: observability events persisted unsafe fields", file=sys.stderr)
            return False

        populated_summary = subprocess.run(
            ["./imo", "metrics", "summary", "--json"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if populated_summary.returncode != 0:
            print("[imo verify] failed: populated observability summary", file=sys.stderr)
            return False
        payload = json.loads(populated_summary.stdout)
        event_counts = payload.get("event_counts", {})
        if not isinstance(event_counts, dict):
            print("[imo verify] failed: observability event counts shape", file=sys.stderr)
            return False
        if event_counts.get("command_start", 0) < 2 or event_counts.get("command_end", 0) < 3:
            print("[imo verify] failed: command lifecycle event counts", file=sys.stderr)
            return False
        if payload.get("failure_count", 0) < 2:
            print("[imo verify] failed: failure count missing observed errors", file=sys.stderr)
            return False

        trace_id = next((event.get("trace_id") for event in events if isinstance(event.get("trace_id"), str)), None)
        if not isinstance(trace_id, str):
            print("[imo verify] failed: no trace id found", file=sys.stderr)
            return False
        timeline = subprocess.run(
            ["./imo", "metrics", "timeline", "--trace", trace_id, "--json"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if timeline.returncode != 0:
            print("[imo verify] failed: observability timeline", file=sys.stderr)
            return False
        timeline_payload = json.loads(timeline.stdout)
        if not timeline_payload.get("events"):
            print("[imo verify] failed: observability timeline empty", file=sys.stderr)
            return False

        failures = subprocess.run(
            ["./imo", "metrics", "failures", "--json"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if failures.returncode != 0:
            print("[imo verify] failed: observability failures", file=sys.stderr)
            return False
        failures_payload = json.loads(failures.stdout)
        if failures_payload.get("failure_count", 0) < 2:
            print("[imo verify] failed: observability failures count", file=sys.stderr)
            return False

        print("[imo verify] ok: observability metrics")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: observability metrics: {exc}", file=sys.stderr)
        return False
    finally:
        if runtime_dir.exists():
            shutil.rmtree(runtime_dir)
        if backup_dir is not None:
            backup_observability = backup_dir / "observability"
            if backup_observability.exists():
                runtime_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(backup_observability, runtime_dir, dirs_exist_ok=True)
            shutil.rmtree(backup_dir, ignore_errors=True)
