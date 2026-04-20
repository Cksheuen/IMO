#!/usr/bin/env python3
"""Compile CC rules into a compact AGENTS.md for Codex CLI.

Reads rules from ~/.claude/ hierarchy and produces a single Markdown document
that fits within Codex CLI's AGENTS.md size limit (default <12KB).

Priority tiers control what gets included when space is tight:
  P0: CLAUDE.md core principles + must-check entries (~2KB)
  P1: rules/core/ + rules-library/core/ (~4KB)
  P2: rules/pattern/ + rules-library/pattern/ (~6KB)
  P3: notes/lessons/ active only (~4KB)
  P4: rules/domain/ + rules-library/domain/ (~4KB)
"""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

CLAUDE_DIR = Path.home() / ".claude"
MAX_SIZE = (12 * 1024) - 1  # Keep default output under 12KB verification threshold

# Sections to extract from rule files
KEEP_HEADINGS = {
    "核心原则", "核心问题", "触发条件", "决策框架",
    "执行规范", "执行规则", "反模式", "架构", "分工框架",
    "核心洞察", "问题诊断", "解决方案",
}

# Sections to skip entirely
SKIP_HEADINGS = {
    "参考", "相关规范", "相关规则", "相关工具", "检查清单",
    "参考源演进判断", "参考源演进检查", "examples",
    "使用此规则的 skills", "常见问题",
}


def parse_frontmatter(text):
    """Extract YAML frontmatter and body from markdown."""
    if not text.startswith('---'):
        return {}, text
    end = text.find('---', 3)
    if end == -1:
        return {}, text
    fm_text = text[3:end].strip()
    body = text[end + 3:].strip()

    # Try proper YAML parsing first
    try:
        import yaml
        fm = yaml.safe_load(fm_text)
        if not isinstance(fm, dict):
            fm = {}
        return fm, body
    except ImportError:
        pass
    except Exception:
        pass

    # Fallback: simple key:value parsing
    fm = {}
    for line in fm_text.split('\n'):
        if ':' in line and not line.strip().startswith('-'):
            key, _, val = line.partition(':')
            fm[key.strip()] = val.strip()
    return fm, body


def extract_title(body):
    """Get first # heading."""
    for line in body.split("\n"):
        line = line.strip()
        if line.startswith("# ") and not line.startswith("# ==="):
            return line[2:].strip()
    return None


def extract_sections(body, keep=KEEP_HEADINGS, skip=SKIP_HEADINGS):
    """Extract relevant sections from markdown body."""
    lines = body.split("\n")
    result = []
    current_heading = None
    current_level = 0
    include = True
    skip_lower = {h.lower() for h in skip}
    keep_lower = {h.lower() for h in keep}

    for line in lines:
        heading_match = re.match(r'^(#{2,3})\s+(.+)', line)
        if heading_match:
            level = len(heading_match.group(1))
            heading_text = heading_match.group(2).strip()
            heading_clean = re.sub(r'\s*[\(（].*$', '', heading_text).strip()

            if heading_clean.lower() in skip_lower:
                include = False
                continue
            elif heading_clean.lower() in keep_lower or not keep_lower:
                include = True
                current_heading = heading_text
                current_level = level
                result.append(line)
                continue
            else:
                # Unknown heading at same or higher level — include conservatively
                include = level <= 2
                if include:
                    result.append(line)
                continue

        if include:
            result.append(line)

    return "\n".join(result).strip()


def extract_trigger_summary(body):
    """Extract a one-line trigger summary from a rule body."""
    lines = body.split("\n")
    in_trigger_section = False

    def first_meaningful(section_lines):
        preferred = []
        fallback = []
        for raw_line in section_lines:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith((">", "```")):
                continue
            if line.startswith("|"):
                # Skip table separator rows (e.g. '| --- | --- |')
                if re.match(r'^\|[\s\-:|]+\|$', line):
                    continue
                # Skip table header rows (common header keywords)
                if re.search(r"(条件|标准|类型|级别|检查项|格式|方案|情况|反模式|层|对象)", line):
                    continue
                # Extract first data column
                cols = line.split("|")
                if len(cols) >= 2:
                    cell = cols[1].strip()
                    if cell and not cell.startswith("-"):
                        fallback.append(cell[:100])
                continue
            if re.match(r"^[-*+]\s+", line) or re.match(r"^\d+\.\s+", line):
                text = re.sub(r"^([-*+]|\d+\.)\s+", "", line).strip()
                if text:
                    preferred.append(text)
                continue
            fallback.append(line)
        summary = preferred[0] if preferred else (fallback[0] if fallback else "")
        return summary[:100]

    trigger_lines = []
    for line in lines:
        heading_match = re.match(r"^(#{2,6})\s+(.+)", line.strip())
        if heading_match:
            heading_text = heading_match.group(2).strip()
            heading_clean = re.sub(r"\s*[\(（].*$", "", heading_text).strip()
            if in_trigger_section:
                break
            if heading_clean == "触发条件":
                in_trigger_section = True
                continue
        if in_trigger_section:
            trigger_lines.append(line)

    summary = first_meaningful(trigger_lines)
    if summary:
        return summary

    return first_meaningful(lines)


def extract_claude_p0_sections(claude_md_path):
    """Extract compact, high-signal sections from CLAUDE.md."""
    if not claude_md_path.exists():
        return ""
    text = claude_md_path.read_text(encoding="utf-8")
    sections = []
    for heading in ("核心原则", "高优先级边界", "必查规则入口"):
        match = re.search(
            rf'^## {re.escape(heading)}\s*\n(.*?)(?=\n## |\Z)',
            text,
            re.MULTILINE | re.DOTALL,
        )
        if match:
            sections.append(f"## {heading}\n\n{match.group(1).strip()}")

    return "\n\n".join(sections).strip()


def process_rule_file(filepath):
    """Process a single rule .md file into compact form."""
    if filepath.name.lower() == "readme.md":
        return None
    try:
        text = filepath.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None

    fm, body = parse_frontmatter(text)
    title = extract_title(body)
    if not title:
        title = filepath.stem.replace("-", " ").title()

    sections = extract_sections(body)
    if not sections.strip():
        return None

    return f"### {title}\n\n{sections}"


def process_rule_file_as_index(filepath):
    """Process a single rule .md file into one-line index format."""
    if filepath.name.lower() == "readme.md":
        return None
    try:
        text = filepath.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None

    fm, body = parse_frontmatter(text)
    title = extract_title(body)
    if not title:
        title = filepath.stem.replace("-", " ").title()

    trigger_summary = extract_trigger_summary(body)
    if not trigger_summary:
        return None

    rel_path = filepath.relative_to(CLAUDE_DIR).as_posix()
    return f"- **{title}** — {trigger_summary} → `{rel_path}`"


def process_lessons(lessons_dir):
    """Process active lessons from notes/lessons/."""
    if not lessons_dir.exists():
        return []
    results = []
    for f in sorted(lessons_dir.glob("*.md")):
        if f.name.lower() == "readme.md":
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        fm, body = parse_frontmatter(text)
        status = fm.get("status", "").lower()
        if status not in ("active", "candidate-rule"):
            continue
        title = extract_title(body) or f.stem.replace("-", " ").title()

        # Extract Trigger and Decision sections
        parts = []
        for heading in ("Trigger", "Decision", "触发条件", "决策"):
            match = re.search(
                rf'^##\s+{re.escape(heading)}\s*\n(.*?)(?=\n## |\Z)',
                body, re.MULTILINE | re.DOTALL
            )
            if match:
                parts.append(f"**{heading}**: {match.group(1).strip()}")

        if not parts:
            # Fallback: take first meaningful paragraph
            for line in body.split("\n"):
                line = line.strip()
                if line and not line.startswith("#") and not line.startswith("---"):
                    parts.append(line[:200])
                    break

        if parts:
            results.append(f"- **{title}**: " + " | ".join(parts))
    return results


def collect_rule_parts(directories, processor, recursive=False):
    """Collect processed rule fragments from multiple directories."""
    parts = []
    source_files = []
    for directory in directories:
        if not directory.exists():
            continue
        files = directory.rglob("*.md") if recursive else directory.glob("*.md")
        for f in sorted(files):
            result = processor(f)
            if result:
                parts.append(result)
                source_files.append(str(f))
    return parts, source_files


def compile_agents_md(max_size=MAX_SIZE):
    """Compile all sources into AGENTS.md content."""
    sections = []
    source_files = []
    budgets = {}

    # Header (no timestamp — manifest tracks last_sync; stable content = stable hash)
    header = (
        "# Project Rules (auto-synced from Claude Code)\n"
        "# Source: ~/.claude/rules/\n"
        "#\n"
        "# !!! DO NOT EDIT THIS FILE !!!\n"
        "# 本文件由 hooks/codex-sync/compile-rules.py 自动生成并全量重写。\n"
        "# 任何手编内容下次 sync 时会被覆盖。\n"
        "# 要新增 / 修改内容，请改 source-of-truth：\n"
        "#   - CLAUDE.md（P0 协议级入口）\n"
        "#   - rules/core/、rules-library/core/（P1 核心规范）\n"
        "#   - rules/pattern/、rules-library/pattern/（P2 模式约束）\n"
        "#   - notes/lessons/ 中 status: active 的文件（P3 教训）\n"
        "#   - rules/domain/、rules-library/domain/（P4 领域规范）\n"
        "# 详见 rules-library/core/cc-codex-sync-architecture.md\n\n"
        "These rules guide coding style, architecture decisions, and quality standards.\n"
        "Follow them when implementing tasks.\n"
        "\n> **重要**：标记为索引的规则段落只包含触发条件摘要和文件路径。"
        "当索引行的触发条件匹配当前任务时，必须先用 cat 读取对应文件的完整内容，再按规则执行。"
        "不要仅凭摘要行事。\n"
    )

    # P0: CLAUDE high-signal entry sections
    claude_p0 = extract_claude_p0_sections(CLAUDE_DIR / "CLAUDE.md")
    if claude_p0:
        p0 = f"\n## 全局入口\n\n{claude_p0}"
        sections.append(("P0", p0, 2048))
        source_files.append(str(CLAUDE_DIR / "CLAUDE.md"))
        budgets["P0"] = 2048

    # P1: rules/core/
    core_dirs = [CLAUDE_DIR / "rules" / "core", CLAUDE_DIR / "rules-library" / "core"]
    core_parts, core_sources = collect_rule_parts(core_dirs, process_rule_file)
    if core_parts:
        p1 = "\n## 核心规范\n\n" + "\n\n".join(core_parts)
        sections.append(("P1", p1, 4096))
        source_files.extend(core_sources)

    # P2: rules/pattern/
    pattern_dirs = [CLAUDE_DIR / "rules" / "pattern", CLAUDE_DIR / "rules-library" / "pattern"]
    pattern_parts, pattern_sources = collect_rule_parts(pattern_dirs, process_rule_file_as_index)
    if pattern_parts:
        p2 = "\n## 架构模式（索引）\n\n> 触发条件匹配时，用 cat 读取对应路径获取完整规则\n\n" + "\n".join(pattern_parts)
        sections.append(("P2", p2, 6144))
        source_files.extend(pattern_sources)

    # P3: notes/lessons/ (active only)
    lessons = process_lessons(CLAUDE_DIR / "notes" / "lessons")
    if lessons:
        p3 = "\n## 活跃教训\n\n" + "\n".join(lessons)
        sections.append(("P3", p3, 4096))
        source_files.append(str(CLAUDE_DIR / "notes" / "lessons"))

    # P4: rules/domain/
    domain_dirs = [CLAUDE_DIR / "rules" / "domain", CLAUDE_DIR / "rules-library" / "domain"]
    domain_parts, domain_sources = collect_rule_parts(domain_dirs, process_rule_file_as_index, recursive=True)
    if domain_parts:
        p4 = "\n## 领域规则（索引）\n\n> 触发条件匹配时，用 cat 读取对应路径获取完整规则\n\n" + "\n".join(domain_parts)
        sections.append(("P4", p4, 4096))
        source_files.extend(domain_sources)

    # Assemble, respecting max_size. Reserve space for later index sections so
    # a large P1 full-text block does not crowd out the short P2/P4 routing hints.
    output = header
    reserved_after = {"P1": {"P2", "P4"}}
    for priority, content, budget in sections:
        candidate = output + content
        if len(candidate.encode("utf-8")) <= max_size:
            output = candidate
        else:
            # Truncate this section to fit
            reserve = 0
            if priority in reserved_after:
                for later_priority, later_content, _ in sections:
                    if later_priority in reserved_after[priority]:
                        reserve += len(later_content.encode("utf-8"))
            remaining = max_size - len(output.encode("utf-8")) - reserve - 50  # buffer
            if remaining > 200:
                truncated = content.encode("utf-8")[:remaining].decode("utf-8", errors="ignore")
                # Cut at last complete line
                last_nl = truncated.rfind("\n")
                if last_nl > 0:
                    truncated = truncated[:last_nl]
                output += truncated + "\n\n*(truncated due to size limit)*\n"
                continue
            if priority in {"P3"}:
                continue
            break  # Skip remaining lower-priority sections

    return output, source_files


def compute_content_hash(content):
    """Compute SHA256 hash of content."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def load_manifest(manifest_path):
    """Load existing manifest or return default."""
    manifest = {
        "version": 1,
        "last_sync": None,
        "rules_hash": None,
        "synced_rules": [],
        "feedback_count": 0,
        "codex_agents_md_path": "~/.codex/AGENTS.md",
    }
    if manifest_path.exists():
        try:
            manifest.update(json.loads(manifest_path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            pass
    return manifest


def manifest_meta():
    """Return the canonical metadata header for generated manifest files."""
    return {
        "do_not_edit": True,
        "auto_generated_by": "hooks/codex-sync/compile-rules.py",
        "source_of_truth": "rules/, rules-library/, notes/lessons/, CLAUDE.md, skills/, commands/",
        "regenerate_command": "bash ~/.claude/hooks/codex-sync/sync-to-codex.sh",
    }


def normalize_manifest(manifest):
    """Keep _meta first while preserving the existing field order for the rest."""
    normalized = {"_meta": manifest_meta()}
    for key, value in manifest.items():
        if key != "_meta":
            normalized[key] = value
    return normalized


def update_manifest(manifest_path, content, source_files):
    """Update sync-manifest.json only when content actually changed."""
    manifest = load_manifest(manifest_path)
    content_hash = compute_content_hash(content)
    meta_needs_update = manifest.get("_meta") != manifest_meta()
    meta_not_first = list(manifest.keys())[:1] != ["_meta"]

    # Skip write only when both generated content and manifest schema are unchanged.
    if manifest.get("rules_hash") == content_hash and not meta_needs_update and not meta_not_first:
        return content_hash

    if manifest.get("rules_hash") != content_hash:
        manifest["last_sync"] = datetime.now(timezone.utc).isoformat()
        manifest["rules_hash"] = content_hash
        manifest["synced_rules"] = source_files

    manifest_path.write_text(
        json.dumps(normalize_manifest(manifest), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return content_hash


def main():
    parser = argparse.ArgumentParser(description="Compile CC rules into AGENTS.md")
    parser.add_argument("--output", "-o", help="Output file path (default: stdout)")
    parser.add_argument("--max-size", type=int, default=MAX_SIZE,
                        help=f"Max output size in bytes (default: {MAX_SIZE})")
    parser.add_argument("--manifest", help="Path to sync-manifest.json to update")
    args = parser.parse_args()

    content, source_files = compile_agents_md(max_size=args.max_size)
    size = len(content.encode("utf-8"))

    if args.output:
        output_path = Path(args.output).expanduser()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(content, encoding="utf-8")
        print(f"Written {size} bytes to {output_path}", file=sys.stderr)
    else:
        sys.stdout.write(content)

    if args.manifest:
        manifest_path = Path(args.manifest).expanduser()
        content_hash = update_manifest(manifest_path, content, source_files)
        print(f"Manifest updated: hash={content_hash[:12]}...", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
