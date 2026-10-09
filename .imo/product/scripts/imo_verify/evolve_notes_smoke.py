from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile

from .runner import ROOT


SKILL = ROOT / ".imo/product/skills/evolve-notes"
BOOKMARKS = SKILL / "scripts/note_bookmarks.py"
ACTIVE_VIEW = SKILL / "scripts/note_active_view.py"


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def _note(bookmark_id: str, title: str, body: str) -> str:
    return (
        "# Note\n\n"
        "## 书签索引\n\n"
        f"- `{bookmark_id}`：{title}\n\n"
        f'<!-- note:bookmark id={bookmark_id} title="{title}" -->\n'
        f"## {title}\n\n{body}\n"
    )


def _run_evolve_notes_smoke() -> bool:
    print("[imo verify] evolve-notes behavior")
    try:
        with tempfile.TemporaryDirectory(prefix="imo-evolve-notes-") as raw:
            note_root = Path(raw)
            first = note_root / "first.md"
            second = note_root / "second.md"
            first.write_text(
                _note(
                    "claim-one",
                    "Claim one",
                    "~~old belief~~ current belief\n\n`~~literal~~`\n\n```text\n~~literal fence~~\n```",
                ),
                encoding="utf-8",
            )
            second.write_text(_note("claim-two", "Claim two", "current"), encoding="utf-8")

            validated = _run(str(BOOKMARKS), "validate", str(note_root), "--json")
            payload = json.loads(validated.stdout)
            if validated.returncode != 0 or payload.get("bookmark_count") != 2:
                raise AssertionError(f"directory validation failed: {validated.stderr or validated.stdout}")

            indexed = _run(str(BOOKMARKS), "index", str(note_root), "--json")
            index_payload = json.loads(indexed.stdout)
            if indexed.returncode != 0 or {item.get("id") for item in index_payload} != {"claim-one", "claim-two"}:
                raise AssertionError("directory index did not preserve both bookmarks")

            stats = _run(str(ACTIVE_VIEW), str(first), "--mode", "stats", "--json")
            stats_payload = json.loads(stats.stdout).get("stats", {})
            if stats.returncode != 0 or stats_payload.get("struck_segments") != 1:
                raise AssertionError("active-view stats did not isolate strikethrough")

            active = _run(str(ACTIVE_VIEW), str(first))
            if "old belief" in active.stdout or "~~literal~~" not in active.stdout or "~~literal fence~~" not in active.stdout:
                raise AssertionError("active view removed literal code or kept superseded prose")

            second.write_text(_note("claim-one", "Duplicate", "current"), encoding="utf-8")
            duplicate = _run(str(BOOKMARKS), "validate", str(note_root), "--json")
            if duplicate.returncode == 0 or "duplicate bookmark id across notes" not in duplicate.stdout:
                raise AssertionError("cross-file duplicate bookmark was not rejected")

        print("[imo verify] ok: evolve-notes behavior")
        return True
    except Exception as exc:
        print(f"[imo verify] failed: evolve-notes behavior: {exc}", file=sys.stderr)
        return False


if __name__ == "__main__":
    raise SystemExit(0 if _run_evolve_notes_smoke() else 1)
