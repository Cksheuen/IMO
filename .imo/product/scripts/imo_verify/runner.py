from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[4]
PYCACHE_PREFIX = Path(
    os.environ.get("PYTHONPYCACHEPREFIX", str(Path(tempfile.gettempdir()) / "imo-pycache"))
)


def fixture_runtime_root() -> Path:
    raw = os.environ.get("IMO_PROJECT_RUNTIME_ROOT")
    if not raw:
        raise RuntimeError("verification fixture runtime is not configured")
    return Path(raw).expanduser().resolve()


@contextmanager
def isolated_fixture_runtime():
    old_project_root = os.environ.get("IMO_PROJECT_ROOT")
    old_runtime_root = os.environ.get("IMO_PROJECT_RUNTIME_ROOT")
    try:
        with tempfile.TemporaryDirectory(prefix="imo-verify-runtime-") as raw:
            runtime = Path(raw) / "runtime"
            os.environ["IMO_PROJECT_ROOT"] = str(ROOT)
            os.environ["IMO_PROJECT_RUNTIME_ROOT"] = str(runtime)
            yield runtime
    finally:
        if old_project_root is None:
            os.environ.pop("IMO_PROJECT_ROOT", None)
        else:
            os.environ["IMO_PROJECT_ROOT"] = old_project_root

        if old_runtime_root is None:
            os.environ.pop("IMO_PROJECT_RUNTIME_ROOT", None)
        else:
            os.environ["IMO_PROJECT_RUNTIME_ROOT"] = old_runtime_root


def run_check(label: str, command: list[str], *, env: dict[str, str] | None = None) -> bool:
    print(f"[imo verify] {label}")
    result = subprocess.run(command, cwd=ROOT, env=env, check=False)
    if result.returncode == 0:
        print(f"[imo verify] ok: {label}")
        return True
    print(f"[imo verify] failed ({result.returncode}): {label}", file=sys.stderr)
    return False


def python_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONPYCACHEPREFIX"] = str(PYCACHE_PREFIX)
    return env


def no_event_env() -> dict[str, str]:
    env = python_env()
    env["IMO_DISABLE_LEARNING_EVENTS"] = "1"
    env["IMO_DISABLE_EVENTS"] = "1"
    return env
