"""
Tools for Promote Notes LangChain migration.

Implements:
1. Note retrieval tools
2. File operation tools
3. Conflict detection tools
"""

from typing import List, Dict, Any, Optional, TypedDict
from datetime import datetime
import os
import re
import json
from pathlib import Path

from langchain_core.tools import tool
from langchain_core.documents import Document


# TypedDicts for structured data

class NoteCandidate(TypedDict):
    """A note candidate for promotion evaluation."""
    path: str
    status: str  # active, candidate-rule, stale
    signal: Optional[str]
    last_verified: Optional[str]
    source_cases: List[str]
    reuse_count: int
    has_clear_trigger: bool
    has_stable_steps: bool


class PromotionDecision(TypedDict):
    """Decision about note promotion."""
    should_promote: bool
    target: str  # rules, skills, memory, notes (stay)
    reason: str
    confidence: float


class ConflictInfo(TypedDict):
    """Information about conflicts with existing assets."""
    has_conflict: bool
    conflict_type: str  # duplicate, partial, none
    conflict_paths: List[str]
    merge_recommendation: Optional[str]


# Constants

NOTES_DIR = Path.home() / ".claude" / "notes"
RULES_DIR = Path.home() / ".claude" / "rules"
SKILLS_DIR = Path.home() / ".claude" / "skills"
MEMORY_DIR = Path.home() / ".claude" / "memory"


# Tool 1: Note Retrieval Tools

@tool
def scan_candidate_notes(
    notes_dir: str = str(NOTES_DIR),
    include_lessons: bool = True,
    include_research: bool = True,
    include_design: bool = True
) -> List[NoteCandidate]:
    """
    Scan notes directory for promotion candidates.

    Equivalent to CC's Step 0: candidate note retrieval.

    Args:
        notes_dir: Path to notes directory
        include_lessons: Include notes/lessons/
        include_research: Include notes/research/
        include_design: Include notes/design/

    Returns:
        List of NoteCandidate objects
    """
    candidates = []
    notes_path = Path(notes_dir)

    if not notes_path.exists():
        return candidates

    # Scan lessons (highest priority)
    if include_lessons:
        lessons_dir = notes_path / "lessons"
        if lessons_dir.exists():
            for md_file in lessons_dir.glob("*.md"):
                candidate = _parse_note_file(md_file)
                if candidate:
                    candidates.append(candidate)

    # Scan research (lower priority)
    if include_research:
        research_dir = notes_path / "research"
        if research_dir.exists():
            for md_file in research_dir.glob("*.md"):
                candidate = _parse_note_file(md_file, default_status="active")
                if candidate and candidate.get("reuse_count", 0) >= 1:
                    candidates.append(candidate)

    # Scan design (lowest priority)
    if include_design:
        design_dir = notes_path / "design"
        if design_dir.exists():
            for md_file in design_dir.glob("*.md"):
                candidate = _parse_note_file(md_file, default_status="active")
                if candidate and candidate.get("reuse_count", 0) >= 2:
                    candidates.append(candidate)

    return candidates


@tool
def get_note_content(note_path: str) -> str:
    """
    Read the full content of a note file.

    Args:
        note_path: Path to the note file

    Returns:
        Full content of the note as string
    """
    path = Path(note_path)
    if not path.exists():
        return f"Error: Note not found at {note_path}"
    return path.read_text(encoding="utf-8")


@tool
def check_promotion_queue(queue_path: str = "") -> Dict[str, Any]:
    """
    Check the promotion queue for pre-claimed candidates.

    Equivalent to CC's promotionDispatch input.

    Args:
        queue_path: Path to promotion-queue.json

    Returns:
        Queue status with candidates list
    """
    if not queue_path:
        # Default queue location
        queue_path = NOTES_DIR / "promotion-queue.json"

    path = Path(queue_path)
    if not path.exists():
        return {"has_queue": False, "candidates": []}

    try:
        with open(path, "r", encoding="utf-8") as f:
            queue_data = json.load(f)
        return {"has_queue": True, **queue_data}
    except json.JSONDecodeError:
        return {"has_queue": False, "candidates": [], "error": "Invalid JSON"}


def _parse_note_file(
    md_path: Path,
    default_status: str = "active"
) -> Optional[NoteCandidate]:
    """Parse a note markdown file to extract metadata."""
    try:
        content = md_path.read_text(encoding="utf-8")
    except Exception:
        return None

    # Extract status from frontmatter or status line
    status = default_status

    # Check frontmatter
    if content.startswith("---"):
        frontmatter_match = re.search(
            r"^---\n(.*?)\n---",
            content,
            re.DOTALL
        )
        if frontmatter_match:
            frontmatter = frontmatter_match.group(1)
            status_match = re.search(r"status:\s*(\S+)", frontmatter)
            if status_match:
                status = status_match.group(1)

    # Check status line in body
    status_line_match = re.search(r"Status:\s*(\S+)", content)
    if status_line_match:
        status = status_line_match.group(1)

    # Extract last verified date
    last_verified = None
    verified_match = re.search(
        r"Last Verified:\s*(\d{4}-\d{2}-\d{2})",
        content
    )
    if verified_match:
        last_verified = verified_match.group(1)

    # Extract source cases
    source_cases = []
    cases_match = re.search(
        r"Source Cases:\s*\n((?:-\s*.+\n?)+)",
        content
    )
    if cases_match:
        cases_text = cases_match.group(1)
        source_cases = re.findall(r"-\s*(.+)", cases_text)

    # Count reuse (check for multiple source cases or repeated mentions)
    reuse_count = len(source_cases) if source_cases else 0

    # Check for clear trigger conditions
    has_clear_trigger = bool(re.search(
        r"触发条件|Trigger|When to",
        content,
        re.IGNORECASE
    ))

    # Check for stable execution steps
    has_stable_steps = bool(re.search(
        r"执行步骤|Steps|执行规范",
        content,
        re.IGNORECASE
    ))

    return NoteCandidate(
        path=str(md_path),
        status=status,
        signal="candidate-rule" if status == "candidate-rule" else None,
        last_verified=last_verified,
        source_cases=source_cases,
        reuse_count=reuse_count,
        has_clear_trigger=has_clear_trigger,
        has_stable_steps=has_stable_steps
    )


# Tool 2: File Operation Tools

@tool
def check_existing_assets(
    note_topic: str,
    rules_dir: str = str(RULES_DIR),
    skills_dir: str = str(SKILLS_DIR),
    memory_dir: str = str(MEMORY_DIR)
) -> ConflictInfo:
    """
    Check for conflicts with existing rules/skills/memory.

    Equivalent to CC's Step 3: dedup and conflict check.

    Args:
        note_topic: The main topic/subject of the note
        rules_dir: Path to rules directory
        skills_dir: Path to skills directory
        memory_dir: Path to memory directory

    Returns:
        ConflictInfo with conflict details
    """
    conflict_paths = []
    conflict_type = "none"

    # Normalize topic for comparison
    topic_keywords = set(re.findall(r"\w+", note_topic.lower()))

    # Check rules
    rules_path = Path(rules_dir)
    if rules_path.exists():
        for md_file in rules_path.glob("**/*.md"):
            content = md_file.read_text(encoding="utf-8").lower()
            if _has_topic_overlap(content, topic_keywords):
                conflict_paths.append(str(md_file))
                conflict_type = "partial"

    # Check skills
    skills_path = Path(skills_dir)
    if skills_path.exists():
        for skill_file in skills_path.glob("*/SKILL.md"):
            content = skill_file.read_text(encoding="utf-8").lower()
            if _has_topic_overlap(content, topic_keywords):
                conflict_paths.append(str(skill_file))
                conflict_type = "partial"

    # Check memory
    memory_path = Path(memory_dir)
    if memory_path.exists():
        for md_file in memory_path.glob("**/*.md"):
            content = md_file.read_text(encoding="utf-8").lower()
            if _has_topic_overlap(content, topic_keywords):
                conflict_paths.append(str(md_file))
                conflict_type = "partial"

    # Determine merge recommendation
    merge_recommendation = None
    if conflict_paths:
        if len(conflict_paths) == 1:
            merge_recommendation = "Consider merging with existing asset"
        else:
            merge_recommendation = "Multiple related assets found, review for consolidation"

    return ConflictInfo(
        has_conflict=len(conflict_paths) > 0,
        conflict_type=conflict_type,
        conflict_paths=conflict_paths,
        merge_recommendation=merge_recommendation
    )


@tool
def create_rule_file(
    rule_name: str,
    content: str,
    category: str = "pattern",
    rules_dir: str = str(RULES_DIR)
) -> Dict[str, Any]:
    """
    Create a new rule file.

    Args:
        rule_name: Name for the rule (e.g., "my-rule")
        content: Markdown content for the rule
        category: Category subdirectory (pattern, technique, tool, etc.)
        rules_dir: Base rules directory

    Returns:
        Result with path and status
    """
    rules_path = Path(rules_dir) / category
    rules_path.mkdir(parents=True, exist_ok=True)

    rule_file = rules_path / f"{rule_name}.md"

    try:
        rule_file.write_text(content, encoding="utf-8")
        return {
            "success": True,
            "path": str(rule_file),
            "message": f"Created rule at {rule_file}"
        }
    except Exception as e:
        return {
            "success": False,
            "path": str(rule_file),
            "error": str(e)
        }


@tool
def create_skill_file(
    skill_name: str,
    description: str,
    content: str,
    skills_dir: str = str(SKILLS_DIR)
) -> Dict[str, Any]:
    """
    Create a new skill directory and SKILL.md.

    Args:
        skill_name: Name for the skill (e.g., "my-skill")
        description: Short description for frontmatter
        content: Markdown content for the skill
        skills_dir: Base skills directory

    Returns:
        Result with path and status
    """
    skill_path = Path(skills_dir) / skill_name
    skill_path.mkdir(parents=True, exist_ok=True)

    skill_file = skill_path / "SKILL.md"

    # Format with frontmatter
    full_content = f"""---
name: {skill_name}
description: {description}
---

{content}
"""

    try:
        skill_file.write_text(full_content, encoding="utf-8")
        return {
            "success": True,
            "path": str(skill_file),
            "message": f"Created skill at {skill_file}"
        }
    except Exception as e:
        return {
            "success": False,
            "path": str(skill_file),
            "error": str(e)
        }


@tool
def update_note_status(
    note_path: str,
    new_status: str,
    promotion_target: Optional[str] = None,
    promotion_reason: Optional[str] = None
) -> Dict[str, Any]:
    """
    Update a note's status after promotion evaluation.

    Args:
        note_path: Path to the note file
        new_status: New status (promoted, active, candidate-rule)
        promotion_target: Where it was promoted to (if applicable)
        promotion_reason: Reason for promotion decision

    Returns:
        Result with status
    """
    path = Path(note_path)
    if not path.exists():
        return {"success": False, "error": f"Note not found: {note_path}"}

    try:
        content = path.read_text(encoding="utf-8")

        # Update or add status line
        if "Status:" in content:
            content = re.sub(
                r"Status:\s*\S+",
                f"Status: {new_status}",
                content
            )
        else:
            # Add status after frontmatter or at the top
            if content.startswith("---"):
                end_fm = content.find("\n---\n", 4)
                if end_fm != -1:
                    content = (
                        content[:end_fm + 5] +
                        f"\nStatus: {new_status}\n" +
                        content[end_fm + 5:]
                    )
            else:
                content = f"Status: {new_status}\n\n{content}"

        # Add promotion info if provided
        if promotion_target:
            promotion_info = f"\n\nPromoted to: {promotion_target}"
            if promotion_reason:
                promotion_info += f"\nReason: {promotion_reason}"
            promotion_info += f"\nDate: {datetime.now().isoformat()}"
            content += promotion_info

        path.write_text(content, encoding="utf-8")

        return {
            "success": True,
            "path": str(path),
            "new_status": new_status
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@tool
def write_promotion_result(
    result_path: str,
    processed: List[Dict[str, Any]],
    deferred: List[Dict[str, Any]],
    failed: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Write the promotion result file.

    Equivalent to CC's promotion-result.json output.

    Args:
        result_path: Path to write result file
        processed: List of processed notes
        deferred: List of deferred notes
        failed: List of failed notes

    Returns:
        Result status
    """
    result = {
        "promotionDispatchResult": {
            "status": "completed",
            "processed": processed,
            "deferred": deferred,
            "failed": failed,
            "timestamp": datetime.now().isoformat()
        }
    }

    try:
        path = Path(result_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)

        return {"success": True, "path": str(path)}
    except Exception as e:
        return {"success": False, "error": str(e)}


# Helper functions

def _has_topic_overlap(content: str, keywords: set, threshold: float = 0.3) -> bool:
    """Check if content has sufficient keyword overlap."""
    content_words = set(re.findall(r"\w+", content))
    overlap = keywords & content_words

    if len(keywords) == 0:
        return False

    return len(overlap) / len(keywords) >= threshold


# Tool list for easy import

PROMOTE_NOTES_TOOLS = [
    # Retrieval tools
    scan_candidate_notes,
    get_note_content,
    check_promotion_queue,
    # Conflict detection tools
    check_existing_assets,
    # File operation tools
    create_rule_file,
    create_skill_file,
    update_note_status,
    write_promotion_result,
]
