#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Spawn promote-notes subagent in background when actionable promotion candidates exist.

IMPORTANT: This hook does NOT block the main agent.
Instead, it spawns a background Claude process to handle promotions.
User flow is not interrupted.
"""

import json
import os
import subprocess
import sys
import textwrap
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

SCRIPT_DIR = Path(__file__).resolve().parent
LIB_DIR = SCRIPT_DIR / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

from promotion_queue import (  # noqa: E402
    actionable_candidates,
    candidate_summary,
    compact_queue,
    find_repo_root,
    load_queue,
    queue_is_stale,
    save_queue,
    update_background_dispatch,
)
from promotion_config import auto_background_enabled  # noqa: E402

APPLY_RESULT_CMD = f'python3 "{SCRIPT_DIR / "promotion-apply-result.py"}" --result-file promotion-result.json'
SPAWN_GRACE_SECONDS = 1.2
POLL_INTERVAL_SECONDS = 0.1
RETRY_COOLDOWN_SECONDS = 300
MONITOR_MAX_WAIT_SECONDS = 900
MONITOR_POLL_SECONDS = 2
AUTH_FAILURE_MARKERS = (
    "failed to authenticate",
    "not logged in",
    "model not allowed",
    "api error: 403",
)


def _read_log_excerpt(log_file: Path, max_chars: int = 400) -> str:
    try:
        content = log_file.read_text(encoding="utf-8", errors="ignore").strip()
    except OSError:
        return ""
    if len(content) > max_chars:
        return content[-max_chars:]
    return content


def _classify_spawn_failure(exit_code: int, log_file: Path) -> str:
    excerpt = _read_log_excerpt(log_file)
    lowered = excerpt.lower()
    if any(marker in lowered for marker in AUTH_FAILURE_MARKERS):
        if excerpt:
            return f"background claude auth/model unavailable: {excerpt}"
        return "background claude auth/model unavailable"
    if excerpt:
        return f"background claude exited quickly (code={exit_code}): {excerpt}"
    return f"background claude exited quickly (code={exit_code})"


def _persist_dispatch(repo_root: Path, **kwargs) -> None:
    queue, _ = load_queue(repo_root)
    queue = update_background_dispatch(queue, **kwargs)
    save_queue(repo_root, queue)


def _pid_is_alive(pid: object) -> bool:
    try:
        os.kill(int(pid), 0)
    except (TypeError, ValueError, OSError):
        return False
    return True


def _parse_iso(value: object) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _within_retry_cooldown(queue: dict, seconds: int = RETRY_COOLDOWN_SECONDS) -> bool:
    dispatch = queue.get("dispatch", {})
    if dispatch.get("status") != "failed":
        return False
    last_attempt = _parse_iso(dispatch.get("lastAttemptAt"))
    if last_attempt is None:
        return False
    return (datetime.now(last_attempt.tzinfo) - last_attempt).total_seconds() < seconds


def _reconcile_running_dispatch(repo_root: Path, queue: dict) -> bool:
    dispatch = queue.get("dispatch", {})
    if dispatch.get("status") != "running" or not dispatch.get("background_spawned"):
        return False

    pid = dispatch.get("background_pid")
    if _pid_is_alive(pid):
        return True

    log_file_raw = dispatch.get("background_log")
    log_file = Path(log_file_raw) if isinstance(log_file_raw, str) and log_file_raw else None
    exit_code = dispatch.get("background_exit_code")
    failure = _classify_spawn_failure(exit_code or -1, log_file) if log_file else "background claude exited unexpectedly"
    queue = update_background_dispatch(
        queue,
        status="failed",
        spawned=False,
        log_file=str(log_file) if log_file else None,
        error=failure,
        exit_code=exit_code if isinstance(exit_code, int) else None,
    )
    save_queue(repo_root, queue)

    audit_log = Path.home() / ".claude" / "logs" / "promotion-capture" / "spawn-audit.log"
    with open(audit_log, "a", encoding="utf-8") as f:
        f.write(
            f"{datetime.now().isoformat()}: Reconciled stale running promotion dispatch "
            f"(pid={pid}) to failed. Error: {failure}\n"
        )
    return False


def _start_exit_monitor(repo_root: Path, pid: int, log_file: Path, candidate_ids: list[str]) -> None:
    monitor_script = textwrap.dedent(
        f"""
        import importlib.util
        import json
        import os
        import sys
        import time
        from pathlib import Path

        repo_root = Path(sys.argv[1])
        pid = int(sys.argv[2])
        log_file = Path(sys.argv[3])
        max_wait = int(sys.argv[4])
        poll_seconds = float(sys.argv[5])
        queue_module_path = Path(sys.argv[6])
        candidate_ids = set(json.loads(sys.argv[7]))

        spec = importlib.util.spec_from_file_location("promotion_queue_monitor", queue_module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        deadline = time.time() + max_wait
        while time.time() < deadline:
            try:
                os.kill(pid, 0)
            except OSError:
                break
            time.sleep(poll_seconds)
        else:
            sys.exit(0)

        queue, _ = module.load_queue(repo_root)
        dispatch = queue.get("dispatch", {{}})
        if str(dispatch.get("background_pid")) != str(pid):
            sys.exit(0)

        excerpt = ""
        try:
            excerpt = log_file.read_text(encoding="utf-8", errors="ignore").strip()
        except OSError:
            excerpt = ""
        excerpt = excerpt[-400:] if excerpt else ""
        lowered = excerpt.lower()
        failure_tokens = {AUTH_FAILURE_MARKERS!r}
        tracked_actionable = [
            item
            for item in module.actionable_candidates(queue)
            if str(item.get("id")) in candidate_ids
        ]

        if tracked_actionable:
            if any(token in lowered for token in failure_tokens):
                error = f"background claude auth/model unavailable: {{excerpt}}" if excerpt else "background claude auth/model unavailable"
            elif excerpt:
                error = f"background claude exited after spawn window: {{excerpt}}"
            else:
                error = "background claude exited after spawn window"
            queue = module.update_background_dispatch(
                queue,
                status="failed",
                spawned=False,
                log_file=str(log_file),
                error=error,
                exit_code=dispatch.get("background_exit_code"),
            )
        else:
            queue = module.update_background_dispatch(
                queue,
                status="completed",
                spawned=False,
                log_file=str(log_file),
                error=None,
                exit_code=dispatch.get("background_exit_code"),
            )

        module.save_queue(repo_root, queue)
        """
    ).strip()

    subprocess.Popen(
        [
            "nohup",
            sys.executable,
            "-c",
            monitor_script,
            str(repo_root),
            str(pid),
            str(log_file),
            str(MONITOR_MAX_WAIT_SECONDS),
            str(MONITOR_POLL_SECONDS),
            str(SCRIPT_DIR / "lib" / "promotion_queue.py"),
            json.dumps(candidate_ids, ensure_ascii=False),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def spawn_background_promotion(candidates: list, repo_root: Path) -> None:
    """Spawn a background Claude process to handle promotion."""

    candidate_json = json.dumps(candidates, ensure_ascii=False, indent=2)

    prompt = f"""Process the following promotion candidates.

Candidates (from promotion-queue.json):
{candidate_json}

Task:
1. Read each candidate note
2. Evaluate if it meets promotion criteria (stability, evidence, trigger conditions)
3. Decide destination: rules/, skills/, memory/, or keep in notes/
4. For each candidate, either promote or update status with reason
5. Write promotion-result.json and run: {APPLY_RESULT_CMD}
"""

    # Log directory
    log_dir = Path.home() / ".claude" / "logs" / "promotion-capture"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"background-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"

    # Spawn background process using nohup
    try:
        with open(log_file, 'w') as log_f:
            process = subprocess.Popen(
                ["nohup", "claude", "--print", "-p", prompt],
                stdout=log_f,
                stderr=log_f,
                start_new_session=True,
            )

        deadline = time.monotonic() + SPAWN_GRACE_SECONDS
        exit_code = None
        while time.monotonic() < deadline:
            exit_code = process.poll()
            if exit_code is not None:
                break
            time.sleep(POLL_INTERVAL_SECONDS)

        if exit_code is not None:
            failure = _classify_spawn_failure(exit_code, log_file)
            _persist_dispatch(
                repo_root,
                status="failed",
                spawned=False,
                log_file=str(log_file),
                error=failure,
                exit_code=exit_code,
            )

            audit_log = log_dir / "spawn-audit.log"
            with open(audit_log, 'a') as f:
                f.write(
                    f"{datetime.now().isoformat()}: Background promotion spawn failed quickly "
                    f"(PID={process.pid}, code={exit_code}). Error: {failure}\n"
                )
            return

        # Log spawn info
        audit_log = log_dir / "spawn-audit.log"
        with open(audit_log, 'a') as f:
            f.write(f"{datetime.now().isoformat()}: Spawned promote-notes background process (PID={process.pid}) for {len(candidates)} candidates. Log: {log_file}\n")

        # Update queue only when process survived the initial grace window.
        _persist_dispatch(
            repo_root,
            status="running",
            spawned=True,
            pid=process.pid,
            log_file=str(log_file),
            error=None,
            exit_code=None,
        )
        _start_exit_monitor(
            repo_root,
            process.pid,
            log_file,
            [str(candidate.get("id")) for candidate in candidates if candidate.get("id")],
        )

    except Exception as e:
        _persist_dispatch(
            repo_root,
            status="failed",
            spawned=False,
            log_file=str(log_file),
            error=f"failed to spawn background claude: {e}",
            exit_code=None,
        )
        # Log error but don't fail the hook
        error_log = log_dir / "spawn-errors.log"
        with open(error_log, 'a') as f:
            f.write(f"{datetime.now().isoformat()}: Failed to spawn background promotion: {e}\n")


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    if payload.get("hook_event_name", "") not in {"Stop", "SubagentStop"}:
        sys.exit(0)

    repo_root = find_repo_root(payload.get("cwd", os.getcwd()))
    if repo_root is None:
        sys.exit(0)

    if not auto_background_enabled(repo_root):
        sys.exit(0)

    queue, _ = load_queue(repo_root)
    queue = compact_queue(queue)
    save_queue(repo_root, queue)

    if _reconcile_running_dispatch(repo_root, queue):
        sys.exit(0)

    queue, _ = load_queue(repo_root)

    candidates = actionable_candidates(queue)
    if not candidates:
        # Silent allow - no output to avoid UI noise
        sys.exit(0)

    if queue_is_stale(queue):
        # Silent allow - queue is stale
        sys.exit(0)

    if _within_retry_cooldown(queue):
        sys.exit(0)

    # Spawn background promotion - does NOT block main agent
    spawn_background_promotion(candidates, repo_root)

    # Exit 0 to allow main agent to continue normally
    sys.exit(0)


if __name__ == "__main__":
    main()
