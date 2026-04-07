#!/usr/bin/env python3
"""Scan the Claude Code knowledge system and output a JSON health report.

Scans:
  ~/.claude/notes/lessons/
  ~/.claude/notes/research/
  ~/.claude/notes/design/
  ~/.claude/rules/          (excluding README.md)
  ~/.claude/skills/         (directories with SKILL.md)

Outputs a JSON report to stdout with health metrics.
"""

import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

BASE = Path.home() / ".claude"

LESSONS_DIR = BASE / "notes" / "lessons"
RESEARCH_DIR = BASE / "notes" / "research"
DESIGN_DIR = BASE / "notes" / "design"
RULES_DIR = BASE / "rules"
SKILLS_DIR = BASE / "skills"
HOOKS_DIR = BASE / "hooks"
SETTINGS_FILE = BASE / "settings.json"
SIGNAL_STATE_FILE = BASE / "lesson-signals.json"
CONSOLIDATION_STATE_FILE = BASE / "consolidation-state.json"
CONSOLIDATION_REPORT_FILE = BASE / "consolidation-report.json"

DATE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-")
SOURCE_LINE_RE = re.compile(r">\s*来源[：:](.+?)(?:\s*\|\s*吸收时间[：:]\s*(.+))?$")
SOURCE_CASE_BULLET_RE = re.compile(r"^\s*-\s+")


def safe_listdir(directory: Path) -> list[str]:
    """List directory contents, returning empty list if it doesn't exist."""
    try:
        return os.listdir(directory)
    except (FileNotFoundError, PermissionError):
        return []


def read_file_safe(path: Path) -> str:
    """Read file contents, returning empty string on failure."""
    try:
        return path.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError, UnicodeDecodeError):
        return ""


def get_mtime_date(path: Path) -> str | None:
    """Get file modification date as YYYY-MM-DD string."""
    try:
        ts = path.stat().st_mtime
        return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
    except (FileNotFoundError, PermissionError):
        return None


def extract_metadata(content: str) -> dict:
    """Extract frontmatter-style metadata from markdown content.

    Looks for lines like:
      - Status: active
      - First Seen: 2026-03-27
      - Last Verified: 2026-03-27
      - Date: 2026-03-27
    """
    meta = {}
    for line in content.splitlines():
        line = line.strip()
        if not line.startswith("- "):
            # Stop scanning metadata after the first non-metadata, non-empty,
            # non-heading block. But allow headings and blank lines.
            if line and not line.startswith("#") and not line.startswith(">"):
                break
            continue
        # Parse "- Key: Value" lines
        m = re.match(r"^-\s+(.+?):\s+(.+)$", line)
        if m:
            key = m.group(1).strip()
            value = m.group(2).strip()
            meta[key] = value
    return meta


def extract_source_info(content: str) -> dict:
    """Extract source and absorption time from rule files.

    Looks for lines like:
      > 来源：[Trellis](...) | 吸收时间：2026-03-25
    """
    info = {"source": None, "absorption_time": None}
    for line in content.splitlines():
        line = line.strip()
        m = SOURCE_LINE_RE.match(line)
        if m:
            info["source"] = m.group(1).strip()
            if m.group(2):
                info["absorption_time"] = m.group(2).strip()
            break
    return info


def count_source_cases(content: str) -> int:
    """Count bullet items under '## Source Cases' section."""
    in_section = False
    count = 0
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("## Source Cases"):
            in_section = True
            continue
        if in_section:
            if stripped.startswith("## "):
                break  # next section
            if SOURCE_CASE_BULLET_RE.match(line):
                count += 1
    return count


def has_source_cases_section(content: str) -> bool:
    """Check if the file has a '## Source Cases' section."""
    for line in content.splitlines():
        if line.strip().startswith("## Source Cases"):
            return True
    return False


def is_date_prefixed(filename: str) -> bool:
    """Check if filename starts with YYYY-MM-DD- pattern."""
    return bool(DATE_PREFIX_RE.match(filename))


def scan_md_files(directory: Path) -> list[dict]:
    """Scan a directory for .md files and extract info from each."""
    results = []
    for name in sorted(safe_listdir(directory)):
        if not name.endswith(".md") or name == "README.md":
            continue
        path = directory / name
        if not path.is_file():
            continue

        content = read_file_safe(path)
        meta = extract_metadata(content)
        source_info = extract_source_info(content)

        entry = {
            "filename": name,
            "path": str(path),
            "metadata": meta,
            "source_cases_count": count_source_cases(content),
            "has_source_cases_section": has_source_cases_section(content),
            "is_date_prefixed": is_date_prefixed(name),
            "mtime": get_mtime_date(path),
            "source": source_info["source"],
            "absorption_time": source_info["absorption_time"],
        }
        results.append(entry)
    return results


def scan_rules(directory: Path) -> list[dict]:
    """Recursively scan rules directory for .md files (excluding README.md)."""
    results = []
    if not directory.exists():
        return results

    for path in sorted(directory.rglob("*.md")):
        if path.name == "README.md":
            continue
        if not path.is_file():
            continue

        content = read_file_safe(path)
        meta = extract_metadata(content)
        source_info = extract_source_info(content)

        entry = {
            "filename": path.name,
            "path": str(path),
            "relative_path": str(path.relative_to(directory)),
            "metadata": meta,
            "source": source_info["source"],
            "absorption_time": source_info["absorption_time"],
            "mtime": get_mtime_date(path),
        }
        results.append(entry)
    return results


def scan_skills(directory: Path) -> list[dict]:
    """Scan skills directory for subdirectories containing SKILL.md."""
    results = []
    for name in sorted(safe_listdir(directory)):
        skill_dir = directory / name
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        has_skill_md = skill_md.is_file()

        entry = {
            "name": name,
            "path": str(skill_dir),
            "has_skill_md": has_skill_md,
            "mtime": get_mtime_date(skill_md) if has_skill_md else get_mtime_date(skill_dir),
        }
        results.append(entry)
    return results


def classify_rule_source(source: str | None) -> str:
    """Classify a rule's source into pipeline categories."""
    if not source:
        return "other_sourced"
    s = source.lower()
    if "notes" in s or "晋升" in s:
        return "notes_sourced"
    if "eat" in s:
        return "eat_sourced"
    if "brainstorm" in s:
        return "brainstorm_sourced"
    return "other_sourced"


def extract_date_from_entry(entry: dict) -> str | None:
    """Try to extract a date from an entry, checking multiple fields."""
    meta = entry.get("metadata", {})
    for key in ("Date", "First Seen", "date", "first_seen"):
        if key in meta:
            return meta[key]
    # Try absorption_time
    if entry.get("absorption_time"):
        return entry["absorption_time"]
    # Fall back to mtime
    return entry.get("mtime")


def scan_lesson_capture() -> dict:
    """Scan the lesson-capture hook system status."""
    result = {
        "hooks_exist": False,
        "signal_detector_exists": False,
        "lesson_gate_exists": False,
        "lesson_gate_deprecated": False,
        "settings_stop_hook": False,
        "settings_statusline_integrated": False,
        "signal_state": None,
        "signal_types_detected": [],
    }

    # Check hook scripts exist
    detector = HOOKS_DIR / "lesson-capture" / "signal-detector.sh"
    gate = HOOKS_DIR / "lesson-capture" / "lesson-gate.sh"
    result["signal_detector_exists"] = detector.is_file()
    result["lesson_gate_exists"] = gate.is_file()
    if result["lesson_gate_exists"]:
        gate_text = read_file_safe(gate)
        if gate_text and "DEPRECATED: lesson-gate" in gate_text:
            result["lesson_gate_deprecated"] = True
    result["hooks_exist"] = result["signal_detector_exists"] and result["lesson_gate_exists"]

    # Check settings.json for hook registration
    settings_content = read_file_safe(SETTINGS_FILE)
    if settings_content:
        try:
            settings = json.loads(settings_content)
            hooks = settings.get("hooks", {})

            # Check Stop hook
            stop_hooks = hooks.get("Stop", [])
            for h in stop_hooks:
                if "lesson-gate" in h.get("command", ""):
                    result["settings_stop_hook"] = True

            # Check statusline integration
            sl = settings.get("statusLine", {})
            sl_cmd = sl.get("command", "")
            # Check if statusline-wrapper.sh is configured (it calls signal-detector)
            if "statusline-wrapper" in sl_cmd:
                result["settings_statusline_integrated"] = True
        except json.JSONDecodeError:
            pass

    # Check signal state file
    if SIGNAL_STATE_FILE.is_file():
        state_content = read_file_safe(SIGNAL_STATE_FILE)
        if state_content:
            try:
                state = json.loads(state_content)
                result["signal_state"] = {
                    "session_id": state.get("session_id", ""),
                    "signal_count": state.get("signal_count", 0),
                    "unhandled_count": state.get("unhandled_count", 0),
                    "updated_at": state.get("updated_at", 0),
                }
                # Collect signal types
                types_seen = set()
                for s in state.get("signals", []):
                    types_seen.add(s.get("type", "unknown"))
                result["signal_types_detected"] = sorted(types_seen)
            except json.JSONDecodeError:
                pass

    return result


def scan_consolidation() -> dict:
    """Scan the consolidation system status."""
    result = {
        "script_exists": False,
        "hook_exists": False,
        "settings_session_end_hook": False,
        "state": None,
        "last_report": None,
    }

    result["script_exists"] = (HOOKS_DIR / "consolidate" / "consolidate.py").is_file()
    result["hook_exists"] = (HOOKS_DIR / "consolidate" / "session-end-consolidate.sh").is_file()

    # Check settings.json
    settings_content = read_file_safe(SETTINGS_FILE)
    if settings_content:
        try:
            settings = json.loads(settings_content)
            hooks = settings.get("hooks", {})
            for h in hooks.get("SessionEnd", []):
                if "session-end-consolidate" in h.get("command", ""):
                    result["settings_session_end_hook"] = True
        except json.JSONDecodeError:
            pass

    # Read state
    if CONSOLIDATION_STATE_FILE.is_file():
        try:
            state = json.loads(read_file_safe(CONSOLIDATION_STATE_FILE))
            last_run = state.get("last_run", 0)
            hours_ago = (time.time() - last_run) / 3600 if last_run else None
            result["state"] = {
                "last_run": last_run,
                "hours_since_last_run": round(hours_ago, 1) if hours_ago else None,
                "session_count": state.get("session_count", 0),
                "total_runs": state.get("runs", 0),
            }
        except json.JSONDecodeError:
            pass

    # Read last report summary
    if CONSOLIDATION_REPORT_FILE.is_file():
        try:
            report = json.loads(read_file_safe(CONSOLIDATION_REPORT_FILE))
            summary = {}
            for target in ["lessons", "research", "design", "runtime"]:
                if target in report:
                    r = report[target]
                    if target == "runtime":
                        summary[target] = {
                            "pruned_files": r.get("pruned_files", 0),
                            "freed_kb": r.get("freed_bytes", 0) // 1024,
                        }
                    else:
                        summary[target] = {
                            "changed_files": len(r.get("files", [])),
                        }
            result["last_report"] = {
                "generated_at": report.get("generated_at", ""),
                "dry_run": report.get("dry_run", False),
                "summary": summary,
            }
        except json.JSONDecodeError:
            pass

    return result


def compute_metrics(lessons, research, design, rules, skills):
    """Compute all health metrics from scanned data."""

    # -- lesson_spec_rate --
    # % of lessons with all required metadata: Status + First Seen + Last Verified + Source Cases section
    if lessons:
        spec_complete = sum(
            1
            for l in lessons
            if l["metadata"].get("Status")
            and l["metadata"].get("First Seen")
            and l["metadata"].get("Last Verified")
            and l["has_source_cases_section"]
        )
        lesson_spec_rate = round(spec_complete / len(lessons), 3)
    else:
        lesson_spec_rate = 0.0

    # -- merge_ratio --
    # % of lessons using topic naming (not date-prefixed)
    if lessons:
        topic_named = sum(1 for l in lessons if not l["is_date_prefixed"])
        merge_ratio = round(topic_named / len(lessons), 3)
    else:
        merge_ratio = 0.0

    # -- promotion_rate --
    # count of notes with status "candidate-rule" or promoted / total notes
    all_notes = lessons + research + design
    if all_notes:
        promoted_count = sum(
            1
            for n in all_notes
            if n["metadata"].get("Status", "").lower() in ("candidate-rule", "promoted", "graduated")
        )
        promotion_rate = round(promoted_count / len(all_notes), 3)
    else:
        promotion_rate = 0.0

    # -- design_landed_rate --
    # % of design notes with status "implemented" or "verified" or "active"
    if design:
        landed = sum(
            1
            for d in design
            if d["metadata"].get("Status", "").lower() in ("implemented", "verified", "active")
        )
        design_landed_rate = round(landed / len(design), 3)
    else:
        design_landed_rate = 0.0

    # -- source_cases_density --
    # average number of Source Cases per lesson
    if lessons:
        total_cases = sum(l["source_cases_count"] for l in lessons)
        source_cases_density = round(total_cases / len(lessons), 2)
    else:
        source_cases_density = 0.0

    # -- knowledge_source_diversity --
    # % of rules whose source contains "notes" or "晋升"
    if rules:
        notes_sourced = sum(
            1
            for r in rules
            if r.get("source") and ("notes" in r["source"].lower() or "晋升" in r["source"].lower())
        )
        knowledge_source_diversity = round(notes_sourced / len(rules), 3)
    else:
        knowledge_source_diversity = 0.0

    # -- pipeline_counts --
    pipeline_counts = {
        "eat_sourced": 0,
        "brainstorm_sourced": 0,
        "notes_sourced": 0,
        "other_sourced": 0,
    }
    for r in rules:
        cat = classify_rule_source(r.get("source"))
        pipeline_counts[cat] += 1

    # -- status_distribution -- grouped by category
    status_dist: dict[str, dict[str, int]] = {}
    for category_name, category_items in [("lessons", lessons), ("research", research), ("design", design)]:
        cat_dist: dict[str, int] = {}
        for n in category_items:
            status = n["metadata"].get("Status", "unknown").lower()
            cat_dist[status] = cat_dist.get(status, 0) + 1
        status_dist[category_name] = cat_dist

    # -- timeline --
    timeline = []
    for l in lessons:
        d = extract_date_from_entry(l)
        if d:
            timeline.append({"date": d, "type": "lesson", "name": l["filename"]})
    for r_note in research:
        d = extract_date_from_entry(r_note)
        if d:
            timeline.append({"date": d, "type": "research", "name": r_note["filename"]})
    for dn in design:
        d = extract_date_from_entry(dn)
        if d:
            timeline.append({"date": d, "type": "design", "name": dn["filename"]})
    for r in rules:
        d = extract_date_from_entry(r)
        if d:
            timeline.append({"date": d, "type": "rule", "name": r.get("relative_path", r["filename"])})
    for s in skills:
        if s.get("mtime"):
            timeline.append({"date": s["mtime"], "type": "skill", "name": s["name"]})

    timeline.sort(key=lambda x: x["date"])

    # -- total_counts --
    total_counts = {
        "lessons": len(lessons),
        "research": len(research),
        "design": len(design),
        "rules": len(rules),
        "skills": len(skills),
    }

    return {
        "health_metrics": {
            "lesson_spec_rate": lesson_spec_rate,
            "merge_ratio": merge_ratio,
            "promotion_rate": promotion_rate,
            "design_landed_rate": design_landed_rate,
            "source_cases_density": source_cases_density,
            "knowledge_source_diversity": knowledge_source_diversity,
        },
        "pipeline_counts": pipeline_counts,
        "status_distribution": status_dist,
        "timeline": timeline,
        "total_counts": total_counts,
    }


def main():
    lessons = scan_md_files(LESSONS_DIR)
    research = scan_md_files(RESEARCH_DIR)
    design = scan_md_files(DESIGN_DIR)
    rules = scan_rules(RULES_DIR)
    skills = scan_skills(SKILLS_DIR)
    lesson_capture = scan_lesson_capture()
    consolidation = scan_consolidation()

    report = compute_metrics(lessons, research, design, rules, skills)
    report["lesson_capture"] = lesson_capture
    report["consolidation"] = consolidation

    # Include raw scan data for debugging / downstream use
    report["scan_data"] = {
        "lessons": lessons,
        "research": research,
        "design": design,
        "rules": rules,
        "skills": skills,
    }

    report["generated_at"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

    json.dump(report, sys.stdout, indent=2, ensure_ascii=False)
    print()  # trailing newline


if __name__ == "__main__":
    main()
