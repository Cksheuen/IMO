#!/usr/bin/env python3
"""Smoke test for imo_verify tracked-reference behavior."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[4]
CHECKER = ROOT / ".imo/product/scripts/check_tracked_references.py"

FIXED_DOCS = [
    ".github/workflows/imo-verify.yml",
    ".imo/KNOWLEDGE.md",
    ".imo/README.md",
    ".imo/ARCHITECTURE.md",
    ".imo/BOUNDARY.md",
    ".imo/RUNBOOK.md",
    ".imo/UPDATE.md",
]

MODULES_PATH = Path(".imo/product/skills/modules.json")
RULES_PATH = Path(".imo/product/rules/rules.json")
UNTRACKED_REFERENCE = ".imo/product/rules/untracked.md"

BASE_MODULES = {
    "modules": [
        {"id": "sample", "owner_surface": ".imo/product/skills/sample"}
    ]
}
BASE_RULES = {
    "rules": [
        {"id": "sample", "owner_surface": ".imo/product/rules/sample.md"}
    ]
}

TOP_KEYS = {
    "schema_version",
    "root",
    "require_tracked",
    "required",
    "missing",
    "untracked",
    "errors",
    "summary",
}
SUMMARY_KEYS = {"required", "missing", "untracked", "errors"}


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_json(path: Path, value: Any) -> None:
    write_text(path, json.dumps(value, indent=2) + "\n")


def make_env(home: Path) -> Dict[str, str]:
    env = os.environ.copy()
    for key in (
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_COMMON_DIR",
        "GIT_NAMESPACE",
        "GIT_CEILING_DIRECTORIES",
        "GIT_CONFIG_SYSTEM",
    ):
        env.pop(key, None)

    env["HOME"] = str(home)
    env["XDG_CONFIG_HOME"] = str(home / ".config")
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = str(home / ".gitconfig")
    env["GIT_AUTHOR_NAME"] = "smoke"
    env["GIT_AUTHOR_EMAIL"] = "smoke@example.invalid"
    env["GIT_COMMITTER_NAME"] = "smoke"
    env["GIT_COMMITTER_EMAIL"] = "smoke@example.invalid"
    return env


def run(
    cmd: List[str], cwd: Path, env: Dict[str, str], check: bool = True
) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    if check and proc.returncode != 0:
        raise RuntimeError(
            f"command failed ({proc.returncode}): {' '.join(cmd)}\n"
            f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )
    return proc


def git(args: List[str], cwd: Path, env: Dict[str, str]) -> subprocess.CompletedProcess:
    return run(
        ["git", "-c", "user.name=smoke", "-c", "user.email=smoke@example.invalid"]
        + args,
        cwd,
        env,
    )


def init_repo(repo: Path, env: Dict[str, str]) -> None:
    for doc in FIXED_DOCS:
        write_text(repo / doc, f"# {doc}\n")

    write_json(repo / MODULES_PATH, BASE_MODULES)
    write_text(repo / ".imo/product/skills/sample/SKILL.md", "# sample skill\n")

    write_json(repo / RULES_PATH, BASE_RULES)
    write_text(repo / ".imo/product/rules/sample.md", "# sample rule\n")

    git(["init"], repo, env)
    git(["add", "-A"], repo, env)
    git(["commit", "-m", "base"], repo, env)


def run_checker(
    repo: Path, env: Dict[str, str], require_tracked: bool = False
) -> subprocess.CompletedProcess:
    if not CHECKER.is_file():
        raise AssertionError(f"checker not found: {CHECKER}")

    cmd = [sys.executable, str(CHECKER), "--root", str(repo), "--json"]
    if require_tracked:
        cmd.append("--require-tracked")

    return subprocess.run(
        cmd,
        cwd=str(repo),
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )


def parse_report(proc: subprocess.CompletedProcess) -> Dict[str, Any]:
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise AssertionError(
            f"checker did not emit JSON (rc={proc.returncode}): {exc}\n"
            f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        ) from exc

    if not isinstance(data, dict):
        raise AssertionError(
            f"checker JSON top-level is not an object: {type(data).__name__}"
        )
    return data


def assert_report_shape(data: Dict[str, Any]) -> None:
    assert set(data) == TOP_KEYS, f"top keys mismatch: {set(data) ^ TOP_KEYS}"
    assert isinstance(data["root"], str), "root must be a string"
    assert isinstance(data["require_tracked"], bool), "require_tracked must be bool"

    for key in ("required", "missing", "untracked", "errors"):
        assert isinstance(data[key], list), f"{key} must be a list"
        assert all(
            isinstance(item, str) for item in data[key]
        ), f"{key} must contain only strings"

    summary = data["summary"]
    assert isinstance(summary, dict), "summary must be an object"
    assert set(summary) == SUMMARY_KEYS, (
        f"summary keys mismatch: {set(summary) ^ SUMMARY_KEYS}"
    )

    for key in SUMMARY_KEYS:
        value = summary[key]
        assert isinstance(value, int) and not isinstance(value, bool), (
            f"summary.{key} must be an integer"
        )

    assert summary["required"] == len(data["required"])
    assert summary["missing"] == len(data["missing"])
    assert summary["untracked"] == len(data["untracked"])
    assert summary["errors"] == len(data["errors"])


def assert_clean_report(data: Dict[str, Any]) -> None:
    assert data["missing"] == [], f"unexpected missing: {data['missing']}"
    assert data["untracked"] == [], f"unexpected untracked: {data['untracked']}"
    assert data["errors"] == [], f"unexpected errors: {data['errors']}"


def test_base(repo: Path, env: Dict[str, str]) -> None:
    proc = run_checker(repo, env, require_tracked=False)
    assert proc.returncode == 0, f"base default rc={proc.returncode}: {proc.stderr}"
    data = parse_report(proc)
    assert_report_shape(data)
    assert data["require_tracked"] is False
    assert_clean_report(data)

    proc = run_checker(repo, env, require_tracked=True)
    assert proc.returncode == 0, f"base strict rc={proc.returncode}: {proc.stderr}"
    data = parse_report(proc)
    assert_report_shape(data)
    assert data["require_tracked"] is True
    assert_clean_report(data)


def test_untracked(repo: Path, env: Dict[str, str]) -> None:
    rules_file = repo / RULES_PATH
    rules = json.loads(rules_file.read_text(encoding="utf-8"))
    rules["rules"].append(
        {"id": "untracked", "owner_surface": UNTRACKED_REFERENCE}
    )
    write_json(rules_file, rules)
    git(["add", str(RULES_PATH)], repo, env)
    write_text(repo / UNTRACKED_REFERENCE, "# untracked rule\n")

    proc = run_checker(repo, env, require_tracked=False)
    assert proc.returncode == 0, (
        f"untracked default rc={proc.returncode}: {proc.stderr}"
    )
    data = parse_report(proc)
    assert_report_shape(data)
    assert data["require_tracked"] is False
    assert data["errors"] == [], f"default errors must be empty: {data['errors']}"
    assert data["missing"] == [], f"unexpected missing: {data['missing']}"
    assert data["untracked"] == [UNTRACKED_REFERENCE], (
        f"untracked mismatch: {data['untracked']}"
    )

    proc = run_checker(repo, env, require_tracked=True)
    assert proc.returncode == 1, (
        f"untracked strict rc={proc.returncode}: {proc.stderr}"
    )
    data = parse_report(proc)
    assert_report_shape(data)
    assert data["require_tracked"] is True
    expected_error = f"untracked: {UNTRACKED_REFERENCE}"
    assert data["errors"] == [expected_error], (
        f"strict errors mismatch: {data['errors']}"
    )
    assert data["untracked"] == [UNTRACKED_REFERENCE], (
        f"untracked mismatch: {data['untracked']}"
    )


def test_missing(repo: Path, env: Dict[str, str]) -> None:
    (repo / ".imo" / "README.md").unlink()

    proc = run_checker(repo, env, require_tracked=False)
    assert proc.returncode == 1, f"missing default rc={proc.returncode}: {proc.stderr}"
    data = parse_report(proc)
    assert_report_shape(data)
    assert data["require_tracked"] is False
    assert ".imo/README.md" in data["missing"], (
        f"missing does not contain README.md: {data['missing']}"
    )
    assert data["untracked"] == [], f"unexpected untracked: {data['untracked']}"


def test_malformed_modules(repo: Path, env: Dict[str, str]) -> None:
    write_json(repo / MODULES_PATH, {"modules": {"id": "sample"}})
    git(["add", str(MODULES_PATH)], repo, env)

    proc = run_checker(repo, env, require_tracked=False)
    assert proc.returncode == 1, (
        f"malformed modules rc={proc.returncode}: {proc.stderr}"
    )
    data = parse_report(proc)
    assert_report_shape(data)
    assert data["require_tracked"] is False
    assert any("modules" in error for error in data["errors"]), (
        f"errors do not mention modules: {data['errors']}"
    )


def test_traversal(repo: Path, env: Dict[str, str]) -> None:
    bad_modules = {
        "modules": [
            {"id": "sample", "owner_surface": ".imo/product/skills/../escape"}
        ]
    }
    write_json(repo / MODULES_PATH, bad_modules)
    git(["add", str(MODULES_PATH)], repo, env)

    proc = run_checker(repo, env, require_tracked=False)
    assert proc.returncode == 1, (
        f"traversal rc={proc.returncode}: {proc.stderr}"
    )
    data = parse_report(proc)
    assert_report_shape(data)
    assert data["require_tracked"] is False
    assert any(
        ("owner_surface" in error and "invalid" in error) or "reference" in error
        for error in data["errors"]
    ), f"errors do not mention invalid owner_surface or reference: {data['errors']}"


def _run_tracked_references_smoke() -> bool:
    print("[imo verify] tracked references behavior")
    try:
        with tempfile.TemporaryDirectory(prefix="imo-verify-") as tmp:
            tmp_path = Path(tmp)
            home = tmp_path / "home"
            home.mkdir()
            env = make_env(home)

            cases = [
                ("base", test_base),
                ("untracked", test_untracked),
                ("missing", test_missing),
                ("malformed", test_malformed_modules),
                ("traversal", test_traversal),
            ]

            for name, case in cases:
                repo = tmp_path / name
                repo.mkdir()
                init_repo(repo, env)
                case(repo, env)
    except Exception:
        import traceback

        traceback.print_exc()
        print("[imo verify] failed")
        return False

    print("[imo verify] ok")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if _run_tracked_references_smoke() else 1)
