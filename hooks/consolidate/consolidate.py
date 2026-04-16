#!/usr/bin/env python3
"""Unified Knowledge Consolidation Framework.

Applies /dream-style four-phase consolidation (Orient → Gather → Consolidate → Prune)
across all knowledge accumulation areas:
  - notes/lessons/   : merge Source Cases, mark stale/candidate-rule
  - notes/research/  : archive superseded research
  - notes/design/    : track implementation status
  - runtime files    : prune old history, debug logs, snapshots

Usage:
  python3 consolidate.py [--dry-run] [--target lessons|research|design|runtime|all]
"""

import argparse
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

BASE = Path.home() / ".claude"
NOTES = BASE / "notes"
SKILLS_DIR = BASE / "skills"
VENDOR_DIR = SKILLS_DIR / "vendor"
STATE_FILE = BASE / "consolidation-state.json"
LOG_FILE = BASE / "consolidation.log"
TODO_FILE = BASE / "consolidation-todo.json"

# Thresholds
STALE_DAYS_LESSON = 90
STALE_DAYS_DESIGN = 60
CANDIDATE_RULE_THRESHOLD = 3  # Source Cases count
HISTORY_MAX_BYTES = 1_000_000  # 1MB
FILE_HISTORY_MAX_DAYS = 90
SHELL_SNAPSHOT_MAX_DAYS = 60
DEBUG_MAX_DAYS = 30
BACKUP_KEEP_COUNT = 10


def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def read_file(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError, UnicodeDecodeError):
        return ""


def write_file(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def file_age_days(path: Path) -> int:
    try:
        mtime = path.stat().st_mtime
        return (time.time() - mtime) / 86400
    except (FileNotFoundError, PermissionError):
        return 0


def extract_metadata(content: str) -> dict:
    """Extract '- Key: Value' metadata from markdown."""
    meta = {}
    for line in content.splitlines():
        line = line.strip()
        if not line.startswith("- "):
            if line and not line.startswith("#") and not line.startswith(">"):
                break
            continue
        m = re.match(r"^-\s+(.+?):\s+(.+)$", line)
        if m:
            meta[m.group(1).strip()] = m.group(2).strip()
    return meta


def count_source_cases(content: str) -> int:
    in_section = False
    count = 0
    table_header_seen = False
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("## Source Cases"):
            in_section = True
            table_header_seen = False
            continue
        if in_section:
            if stripped.startswith("## "):
                break
            # Count bullet-point source cases
            if re.match(r"^\s*-\s+", line):
                count += 1
            # Count table-row source cases (skip header row and separator)
            elif stripped.startswith("|") and stripped.endswith("|"):
                if not table_header_seen:
                    table_header_seen = True  # first row is header
                elif re.match(r"^\|[\s\-:|]+\|$", stripped):
                    pass  # separator row like |------|------|
                else:
                    count += 1
    return count


def update_metadata_field(content: str, key: str, value: str) -> str:
    """Update or insert a metadata field in '- Key: Value' format."""
    pattern = re.compile(rf"^(-\s+{re.escape(key)}:\s+)(.+)$", re.MULTILINE)
    if pattern.search(content):
        return pattern.sub(rf"\g<1>{value}", content)
    # Insert after last metadata line
    lines = content.splitlines(keepends=True)
    insert_idx = 0
    for i, line in enumerate(lines):
        if line.strip().startswith("- ") and ": " in line:
            insert_idx = i + 1
    lines.insert(insert_idx, f"- {key}: {value}\n")
    return "".join(lines)


# ── Content-Level Consolidation ──


def _extract_topic_info(filepath: Path, content: str) -> dict:
    """Extract topic-relevant info from a lesson file for consolidation analysis."""
    meta = extract_metadata(content)
    source_cases = count_source_cases(content)
    # Use filename stem (minus date prefix) as topic key
    stem = filepath.stem.lower()
    stem_clean = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", stem)
    # Extract keywords from stem by splitting on hyphens
    keywords = set(stem_clean.split("-"))
    # Also extract keywords from Trigger field
    trigger = meta.get("Trigger", "")
    if trigger:
        # Split trigger on common delimiters, keep meaningful words
        trigger_words = re.findall(r"[a-zA-Z\u4e00-\u9fff]{2,}", trigger)
        keywords.update(w.lower() for w in trigger_words if len(w) >= 3)

    return {
        "file": filepath.name,
        "stem_clean": stem_clean,
        "keywords": keywords,
        "trigger": trigger,
        "status": meta.get("Status", "").lower(),
        "last_verified": meta.get("Last Verified", ""),
        "source_cases": source_cases,
    }


def detect_merge_candidates(lessons_dir: Path) -> dict:
    """Detect lessons with overlapping themes and generate a consolidation todo.

    Returns a dict with pending_promotions and stale_reviews lists.
    This produces a bridge file (consolidation-todo.json) that Claude
    can act on in the next session.
    """
    todo = {
        "generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "pending_promotions": [],
        "stale_reviews": [],
    }

    if not lessons_dir.exists():
        return todo

    files = sorted(f for f in lessons_dir.iterdir() if f.suffix == ".md" and f.name != "README.md")
    if not files:
        return todo

    # Extract topic info for all lessons
    topics = []
    for f in files:
        content = read_file(f)
        if not content:
            continue
        topics.append(_extract_topic_info(f, content))

    # Detect promotion candidates: active lessons with enough source cases
    for t in topics:
        if t["source_cases"] >= CANDIDATE_RULE_THRESHOLD:
            todo["pending_promotions"].append({
                "file": t["file"],
                "reason": f"candidate-rule: {t['source_cases']} source cases >= {CANDIDATE_RULE_THRESHOLD} threshold",
                "action": "promote to rules/",
            })

    # Detect stale items needing review
    for t in topics:
        if t["status"] == "stale":
            todo["stale_reviews"].append({
                "file": t["file"],
                "reason": "90+ days without verification",
                "action": "review and re-verify or archive",
            })
        elif t["status"] == "active" and t["last_verified"]:
            try:
                lv_date = datetime.strptime(t["last_verified"], "%Y-%m-%d")
                days_since = (datetime.now() - lv_date).days
                if days_since > STALE_DAYS_LESSON:
                    todo["stale_reviews"].append({
                        "file": t["file"],
                        "reason": f"{days_since} days since last verification",
                        "action": "review and re-verify or archive",
                    })
            except ValueError:
                pass
        elif t["status"] == "active" and not t["last_verified"]:
            age = file_age_days(lessons_dir / t["file"])
            if age > STALE_DAYS_LESSON:
                todo["stale_reviews"].append({
                    "file": t["file"],
                    "reason": f"no Last Verified field, {int(age)} days old",
                    "action": "review and re-verify or archive",
                })

    return todo


def write_consolidation_todo(todo: dict):
    """Write the consolidation-todo.json bridge file."""
    # Only write if there's actionable content
    if todo["pending_promotions"] or todo["stale_reviews"]:
        TODO_FILE.write_text(json.dumps(todo, indent=2, ensure_ascii=False))
        log(f"Wrote consolidation-todo.json: {len(todo['pending_promotions'])} promotions, {len(todo['stale_reviews'])} stale reviews")
    else:
        # Clean up stale todo file if nothing actionable
        if TODO_FILE.exists():
            TODO_FILE.unlink()
            log("Removed empty consolidation-todo.json")


# ── Target: Lessons ──


def consolidate_lessons(dry_run: bool) -> dict:
    """Consolidate notes/lessons/: merge, mark stale, mark candidate-rule."""
    lessons_dir = NOTES / "lessons"
    results = {"merged": 0, "marked_stale": 0, "marked_candidate": 0, "files": [], "todo": {}}

    if not lessons_dir.exists():
        return results

    # Phase: Detect merge candidates and generate consolidation todo
    todo = detect_merge_candidates(lessons_dir)
    if not dry_run:
        write_consolidation_todo(todo)
    results["todo"] = todo

    files = sorted(f for f in lessons_dir.iterdir() if f.suffix == ".md" and f.name != "README.md")

    for f in files:
        content = read_file(f)
        if not content:
            continue

        meta = extract_metadata(content)
        status = meta.get("Status", "").lower()
        last_verified = meta.get("Last Verified", "")
        source_cases = count_source_cases(content)
        age = file_age_days(f)
        changes = []

        # Phase: Prune - mark stale if not verified recently
        if status == "active" and last_verified:
            try:
                lv_date = datetime.strptime(last_verified, "%Y-%m-%d")
                days_since = (datetime.now() - lv_date).days
                if days_since > STALE_DAYS_LESSON:
                    if not dry_run:
                        content = update_metadata_field(content, "Status", "stale")
                        write_file(f, content)
                    changes.append(f"marked stale ({days_since}d since verified)")
                    results["marked_stale"] += 1
            except ValueError:
                pass
        elif status == "active" and not last_verified and age > STALE_DAYS_LESSON:
            if not dry_run:
                content = update_metadata_field(content, "Status", "stale")
                write_file(f, content)
            changes.append(f"marked stale (no Last Verified, {int(age)}d old)")
            results["marked_stale"] += 1

        # Phase: Consolidate - mark candidate-rule if enough Source Cases
        if status == "active" and source_cases >= CANDIDATE_RULE_THRESHOLD:
            if not dry_run:
                content = update_metadata_field(content, "Status", "candidate-rule")
                write_file(f, content)
            changes.append(f"marked candidate-rule ({source_cases} source cases)")
            results["marked_candidate"] += 1

        if changes:
            results["files"].append({"name": f.name, "changes": changes})

    return results


# ── Target: Research ──


def consolidate_research(dry_run: bool) -> dict:
    """Consolidate notes/research/: detect superseded research."""
    research_dir = NOTES / "research"
    rules_dir = BASE / "rules"
    results = {"marked_superseded": 0, "marked_stale": 0, "files": []}

    if not research_dir.exists():
        return results

    files = sorted(f for f in research_dir.iterdir() if f.suffix == ".md" and f.name != "README.md")

    # Build a set of rule/skill topics for cross-reference
    rule_topics = set()
    if rules_dir.exists():
        for rp in rules_dir.rglob("*.md"):
            if rp.name != "README.md":
                rule_topics.add(rp.stem.lower())
    if SKILLS_DIR.exists():
        for sp in SKILLS_DIR.iterdir():
            if sp == VENDOR_DIR or VENDOR_DIR in sp.parents:
                continue
            if sp.is_dir():
                rule_topics.add(sp.name.lower())

    for f in files:
        content = read_file(f)
        meta = extract_metadata(content)
        status = meta.get("Status", "").lower()
        age = file_age_days(f)
        changes = []

        # Check if research topic has been absorbed into rules/skills
        stem = f.stem.lower()
        # Remove date prefix if present
        stem_clean = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", stem)
        if stem_clean in rule_topics and status not in ("superseded", "archived"):
            if not dry_run:
                content = update_metadata_field(content, "Status", "superseded")
                write_file(f, content)
            changes.append("marked superseded (topic exists in rules/skills)")
            results["marked_superseded"] += 1

        # Mark stale if old and not already marked
        if status not in ("stale", "superseded", "archived") and age > STALE_DAYS_LESSON:
            if not dry_run:
                content = update_metadata_field(content, "Status", "stale")
                write_file(f, content)
            changes.append(f"marked stale ({int(age)}d old)")
            results["marked_stale"] += 1

        if changes:
            results["files"].append({"name": f.name, "changes": changes})

    return results


# ── Target: Design ──


def consolidate_design(dry_run: bool) -> dict:
    """Consolidate notes/design/: track implementation status."""
    design_dir = NOTES / "design"
    results = {"marked_stale": 0, "files": []}

    if not design_dir.exists():
        return results

    files = sorted(f for f in design_dir.iterdir() if f.suffix == ".md" and f.name != "README.md")

    for f in files:
        content = read_file(f)
        meta = extract_metadata(content)
        status = meta.get("Status", "").lower()
        age = file_age_days(f)
        changes = []

        # Mark stale if proposed for too long
        if status == "proposed" and age > STALE_DAYS_DESIGN:
            if not dry_run:
                content = update_metadata_field(content, "Status", "stale")
                write_file(f, content)
            changes.append(f"marked stale (proposed for {int(age)}d)")
            results["marked_stale"] += 1

        if changes:
            results["files"].append({"name": f.name, "changes": changes})

    return results


# ── Target: Runtime ──


def consolidate_runtime(dry_run: bool) -> dict:
    """Prune accumulated runtime files."""
    results = {"pruned_files": 0, "freed_bytes": 0, "actions": []}

    # 1. file-history/ - prune entries older than threshold
    fh_dir = BASE / "file-history"
    if fh_dir.exists():
        pruned = 0
        freed = 0
        for entry in fh_dir.iterdir():
            if entry.is_dir() and file_age_days(entry) > FILE_HISTORY_MAX_DAYS:
                size = sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
                if not dry_run:
                    shutil.rmtree(entry, ignore_errors=True)
                pruned += 1
                freed += size
        if pruned:
            results["actions"].append(f"file-history: pruned {pruned} entries ({freed // 1024}KB)")
            results["pruned_files"] += pruned
            results["freed_bytes"] += freed

    # 2. shell-snapshots/ - prune old snapshots
    ss_dir = BASE / "shell-snapshots"
    if ss_dir.exists():
        pruned = 0
        freed = 0
        for f in ss_dir.iterdir():
            if f.is_file() and file_age_days(f) > SHELL_SNAPSHOT_MAX_DAYS:
                size = f.stat().st_size
                if not dry_run:
                    f.unlink(missing_ok=True)
                pruned += 1
                freed += size
        if pruned:
            results["actions"].append(f"shell-snapshots: pruned {pruned} files ({freed // 1024}KB)")
            results["pruned_files"] += pruned
            results["freed_bytes"] += freed

    # 3. debug/ - prune old debug logs
    debug_dir = BASE / "debug"
    if debug_dir.exists():
        pruned = 0
        freed = 0
        for f in debug_dir.iterdir():
            if f.is_file() and f.name != "latest" and file_age_days(f) > DEBUG_MAX_DAYS:
                size = f.stat().st_size
                if not dry_run:
                    f.unlink(missing_ok=True)
                pruned += 1
                freed += size
        if pruned:
            results["actions"].append(f"debug: pruned {pruned} logs ({freed // 1024}KB)")
            results["pruned_files"] += pruned
            results["freed_bytes"] += freed

    # 4. backups/ - keep only recent N
    backup_dir = BASE / "backups"
    if backup_dir.exists():
        backups = sorted(
            [f for f in backup_dir.iterdir() if f.is_file()],
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        if len(backups) > BACKUP_KEEP_COUNT:
            to_prune = backups[BACKUP_KEEP_COUNT:]
            freed = 0
            for f in to_prune:
                size = f.stat().st_size
                if not dry_run:
                    f.unlink(missing_ok=True)
                freed += size
            results["actions"].append(f"backups: pruned {len(to_prune)} old backups ({freed // 1024}KB)")
            results["pruned_files"] += len(to_prune)
            results["freed_bytes"] += freed

    # 5. history.jsonl - warn if too large (don't auto-delete conversation history)
    history = BASE / "history.jsonl"
    if history.exists():
        size = history.stat().st_size
        if size > HISTORY_MAX_BYTES:
            results["actions"].append(f"history.jsonl: {size // 1024}KB (exceeds {HISTORY_MAX_BYTES // 1024}KB threshold, manual review recommended)")

    return results


# ── State Management ──


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"last_run": 0, "session_count": 0, "runs": 0}


def _atomic_write_json(path: Path, data: dict):
    """Write JSON atomically via tmp file + os.replace."""
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(str(tmp), str(path))


def save_state(state: dict):
    state["last_run"] = int(time.time())
    state["runs"] = state.get("runs", 0) + 1
    _atomic_write_json(STATE_FILE, state)


def should_run(state: dict, force: bool = False) -> bool:
    if force:
        return True
    last = state.get("last_run", 0)
    sessions = state.get("session_count", 0)
    hours_since = (time.time() - last) / 3600
    return hours_since >= 24 or sessions >= 5


def increment_session(state: dict):
    """Called by SessionEnd hook to bump session counter."""
    state["session_count"] = state.get("session_count", 0) + 1
    _atomic_write_json(STATE_FILE, state)


# ── Main ──


def main():
    parser = argparse.ArgumentParser(description="Unified Knowledge Consolidation")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    parser.add_argument("--target", default="all", choices=["lessons", "research", "design", "runtime", "all"])
    parser.add_argument("--force", action="store_true", help="Run even if threshold not met")
    parser.add_argument("--increment-session", action="store_true", help="Just increment session counter and exit")
    args = parser.parse_args()

    state = load_state()

    if args.increment_session:
        increment_session(state)
        return

    if not should_run(state, args.force):
        log("Consolidation skipped (threshold not met). Use --force to override.")
        return

    log(f"Starting consolidation (dry_run={args.dry_run}, target={args.target})")

    report = {}
    targets = [args.target] if args.target != "all" else ["lessons", "research", "design", "runtime"]

    for target in targets:
        log(f"  Consolidating: {target}")
        if target == "lessons":
            report["lessons"] = consolidate_lessons(args.dry_run)
        elif target == "research":
            report["research"] = consolidate_research(args.dry_run)
        elif target == "design":
            report["design"] = consolidate_design(args.dry_run)
        elif target == "runtime":
            report["runtime"] = consolidate_runtime(args.dry_run)

    # Save state (reset session counter)
    if not args.dry_run:
        state["session_count"] = 0
        save_state(state)

    # Summary
    log("Consolidation complete:")
    for target, result in report.items():
        if target == "runtime":
            actions = result.get("actions", [])
            if actions:
                for a in actions:
                    log(f"  [{target}] {a}")
            else:
                log(f"  [{target}] nothing to prune")
        else:
            files = result.get("files", [])
            if files:
                for f in files:
                    log(f"  [{target}] {f['name']}: {', '.join(f['changes'])}")
            else:
                log(f"  [{target}] no changes needed")

    # Write report
    report_file = BASE / "consolidation-report.json"
    report["generated_at"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    report["dry_run"] = args.dry_run
    report_file.write_text(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
