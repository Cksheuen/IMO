#!/usr/bin/env python3
"""
Promotion Apply Result - 应用晋升结果

读取 promotion-result.json，执行文件创建/更新/合并操作。

Usage:
    python3 promotion-apply-result.py --result-file promotion-result.json
    python3 promotion-apply-result.py --dry-run --result-file promotion-result.json
"""

import argparse
import fcntl
import json
import re
import sys
import shutil
import unicodedata
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

BASE = Path.home() / ".claude"
LESSONS_DIR = BASE / "notes" / "lessons"
NOTES_DIR = BASE / "notes"
RULES_DIR = BASE / "rules"
SKILLS_DIR = BASE / "skills"
MEMORY_DIR = BASE / "memory"
DECLARATIVE_MEMORY_DIR = MEMORY_DIR / "declarative"
LOG_DIR = BASE / "logs" / "promotion"
QUEUE_FILE = BASE / "promotion-queue.json"
QUEUE_LOCK_FILE = BASE / "promotion-queue.lock"
ALLOWED_TARGET_ROOTS = tuple(
    path.resolve() for path in (RULES_DIR, SKILLS_DIR, NOTES_DIR, MEMORY_DIR, DECLARATIVE_MEMORY_DIR)
)
LOG_DIR.mkdir(parents=True, exist_ok=True)


def log(msg: str):
    """写入日志"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, file=sys.stderr)
    log_file = LOG_DIR / "apply.log"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def resolve_lesson_path(lesson_path_str: str) -> Path:
    """限制 lesson 路径只能落在 notes/lessons 下。"""
    candidate = Path(lesson_path_str)
    if candidate.is_absolute():
        raise ValueError(f"Lesson path must be relative to {BASE}: {lesson_path_str}")

    resolved = (BASE / candidate).resolve()
    lessons_root = LESSONS_DIR.resolve()
    if resolved != lessons_root and not resolved.is_relative_to(lessons_root):
        raise ValueError(f"Lesson path escapes lessons directory: {lesson_path_str}")
    return resolved


def normalize_result_actions(result: dict) -> List[dict]:
    """兼容旧 actions schema 和新的 promotionDispatchResult schema。"""
    if isinstance(result.get("actions"), list):
        return result["actions"]

    dispatch_result = result.get("promotionDispatchResult")
    if not isinstance(dispatch_result, dict):
        return []

    actions = []

    for item in dispatch_result.get("processed", []):
        outcome = item.get("outcome") or item.get("action") or "kept"
        action: dict = {
            "id": Path(item.get("path", "")).stem,
            "action": outcome,
            "lesson": item.get("path"),
            "target": item.get("target_path") or item.get("targetPath"),
            "reason": item.get("reason", outcome),
            "outcome": outcome,
        }
        if "record" in item:
            action["record"] = item.get("record")
        if "content" in item:
            action["content"] = item.get("content")
        if "description" in item:
            action["description"] = item.get("description")
        if "similarity" in item:
            action["similarity"] = item.get("similarity")
        actions.append(action)

    for item in dispatch_result.get("deferred", []):
        actions.append({
            "id": Path(item.get("path", "")).stem,
            "action": "defer",
            "lesson": item.get("path"),
            "reason": item.get("reason", "deferred"),
        })

    for item in dispatch_result.get("failed", []):
        actions.append({
            "id": Path(item.get("path", "")).stem,
            "action": "failed",
            "lesson": item.get("path"),
            "reason": item.get("error") or item.get("reason", "failed"),
        })

    return [action for action in actions if action.get("lesson")]


def load_result(result_file: Path) -> dict:
    """加载晋升结果"""
    if not result_file.exists():
        log(f"Result file not found: {result_file}")
        return {}
    return json.loads(result_file.read_text())


def load_queue() -> dict:
    """加载队列"""
    if QUEUE_FILE.exists():
        return json.loads(QUEUE_FILE.read_text())
    return {"candidates": [], "processing": []}


def save_queue(queue: dict):
    """保存队列"""
    QUEUE_FILE.write_text(json.dumps(queue, indent=2, ensure_ascii=False))


@contextmanager
def locked_queue():
    """在文件锁保护下读写队列，避免并发覆盖。"""
    QUEUE_LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(QUEUE_LOCK_FILE, "a+", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        queue = load_queue()
        try:
            yield queue
        finally:
            save_queue(queue)
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def resolve_allowed_target_path(target_path_str: str) -> Path:
    """只允许 merge 目标落在 rules/ skills/ notes/ memory/ 内。"""
    target_path = Path(target_path_str)
    if not target_path.is_absolute():
        target_path = BASE / target_path

    resolved_target = target_path.resolve()
    if not any(
        resolved_target == root or resolved_target.is_relative_to(root)
        for root in ALLOWED_TARGET_ROOTS
    ):
        raise ValueError(f"Target path escapes allowed subtrees: {target_path_str}")

    return resolved_target


def extract_frontmatter(content: str) -> dict:
    """提取 YAML frontmatter"""
    if not content.startswith("---"):
        return {}
    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return {}
    fm_text = match.group(1)
    fm = {}
    for line in fm_text.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fm[key.strip()] = value.strip()
    return fm


def update_frontmatter(content: str, updates: dict) -> str:
    """更新 frontmatter"""
    if not content.startswith("---"):
        # 没有 frontmatter，添加
        fm_lines = ["---"]
        for k, v in updates.items():
            fm_lines.append(f"{k}: {v}")
        fm_lines.append("---")
        return "\n".join(fm_lines) + "\n\n" + content

    match = re.match(r"^(---\n)(.*?)(\n---)", content, re.DOTALL)
    if not match:
        return content

    fm_text = match.group(2)
    fm_lines = fm_text.splitlines()

    # 更新已有字段
    updated_keys = set()
    normalized_updates = {k.lower(): (k, v) for k, v in updates.items()}
    for i, line in enumerate(fm_lines):
        if ":" in line:
            key = line.split(":")[0].strip()
            lookup = normalized_updates.get(key.lower())
            if lookup:
                canonical_key, value = lookup
                fm_lines[i] = f"{key}: {value}"
                updated_keys.add(canonical_key)

    # 添加新字段
    for k, v in updates.items():
        if k not in updated_keys:
            fm_lines.append(f"{k}: {v}")

    new_fm = "\n".join(fm_lines)
    return f"---\n{new_fm}\n---{content[match.end():]}"


def read_lesson(lesson_path: Path) -> dict:
    """读取 lesson 文件"""
    content = lesson_path.read_text(encoding="utf-8")
    fm = extract_frontmatter(content)

    # 提取主体内容
    body_match = re.search(r"^---\n.*?\n---\n*(.*)", content, re.DOTALL)
    body = body_match.group(1) if body_match else content

    return {
        "frontmatter": fm,
        "body": body.strip(),
        "content": content,
    }


def relative_to_base(path: Path, base: Path = BASE) -> str:
    resolved_path = path.resolve()
    resolved_base = base.resolve()
    return str(resolved_path.relative_to(resolved_base))


def relative_to_notes(path: Path) -> str:
    return relative_to_base(path, NOTES_DIR)


def slugify_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_only).strip("-").lower()
    return slug or "promoted-note"


def lesson_title(lesson_path: Path, lesson: dict) -> str:
    fm = lesson.get("frontmatter", {})
    title = fm.get("title") or fm.get("name")
    if title:
        return str(title)
    return lesson_path.stem.replace("-", " ").strip().title()


def infer_memory_file(kind: str) -> Path:
    mapping = {
        "preference": DECLARATIVE_MEMORY_DIR / "user-preferences.json",
        "constraint": DECLARATIVE_MEMORY_DIR / "workspace-constraints.json",
        "environment": DECLARATIVE_MEMORY_DIR / "environment.json",
    }
    target = mapping.get(kind)
    if target is None:
        raise ValueError(f"Unsupported declarative memory kind: {kind}")
    return target


def normalize_heading_key(value: str) -> str:
    lowered = (value or "").strip().lower()
    lowered = lowered.replace("_", "").replace("-", "")
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", lowered)


def pick_frontmatter_value(frontmatter: dict, candidates: List[str]) -> str:
    for key in candidates:
        for existing_key, value in frontmatter.items():
            if normalize_heading_key(str(existing_key)) == normalize_heading_key(key):
                text = str(value).strip()
                if text:
                    return text
    return ""


def parse_markdown_sections(body: str) -> Dict[str, str]:
    """Parse markdown headings into a normalized heading -> section content map."""
    sections: Dict[str, str] = {}
    matches = list(re.finditer(r"(?m)^##+\s+(.+?)\s*$", body or ""))
    if not matches:
        return sections

    for i, match in enumerate(matches):
        heading = match.group(1).strip()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        content = (body[start:end] or "").strip()
        if not content:
            continue
        sections[normalize_heading_key(heading)] = content
    return sections


def pick_section_value(sections: Dict[str, str], aliases: List[str]) -> str:
    for alias in aliases:
        key = normalize_heading_key(alias)
        if key in sections and sections[key].strip():
            return sections[key].strip()
    return ""


def normalize_list_items(text: str, max_items: int = 6) -> List[str]:
    items: List[str] = []
    for raw_line in (text or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        line = re.sub(r"^[-*+]\s+", "", line)
        line = re.sub(r"^\d+[.)]\s+", "", line)
        line = re.sub(r"^\[[ xX]\]\s+", "", line)
        line = line.strip()
        if line:
            items.append(line)
        if len(items) >= max_items:
            break
    return items


def sentence_split_items(text: str, max_items: int = 4) -> List[str]:
    chunks = re.split(r"[。！？!?;\n]+", text or "")
    cleaned = []
    for chunk in chunks:
        line = chunk.strip()
        if not line:
            continue
        line = re.sub(r"^[-*+]\s+", "", line)
        line = re.sub(r"^\d+[.)]\s+", "", line)
        line = re.sub(r"^\[[ xX]\]\s+", "", line)
        line = line.strip()
        if line:
            cleaned.append(line)
    return cleaned[:max_items]


def summarize_text(text: str, max_chars: int = 260) -> str:
    compact = re.sub(r"\s+", " ", (text or "")).strip()
    if len(compact) <= max_chars:
        return compact
    return compact[: max_chars - 1].rstrip() + "…"


def format_markdown_bullets(items: List[str], fallback: str) -> str:
    if not items:
        return f"- {fallback}"
    return "\n".join(f"- {item}" for item in items)


def format_markdown_steps(items: List[str], fallback_steps: List[str]) -> str:
    chosen = items if items else fallback_steps
    return "\n".join(f"{idx}. {item}" for idx, item in enumerate(chosen, start=1))


def create_skill(lesson_path: Path, target_path: Path, lesson: dict, dry_run: bool) -> Optional[Path]:
    """Create a skill directory from a promoted note."""
    skill_name = slugify_name(lesson_path.stem)

    if target_path.name == "SKILL.md":
        skill_file = target_path
        skill_dir = skill_file.parent
        skill_name = skill_dir.name or skill_name
    elif target_path.suffix:
        raise ValueError(f"Skill target must be a directory or SKILL.md file: {target_path}")
    elif target_path == SKILLS_DIR or target_path.resolve() == SKILLS_DIR.resolve():
        skill_dir = target_path / skill_name
        skill_file = skill_dir / "SKILL.md"
    elif target_path.is_relative_to(SKILLS_DIR):
        skill_dir = target_path
        skill_name = skill_dir.name or skill_name
        skill_file = skill_dir / "SKILL.md"
    else:
        raise ValueError(f"Skill target escapes skills directory: {target_path}")

    if skill_file.exists():
        existing_content = skill_file.read_text(encoding="utf-8")
        if lesson_path.name in existing_content:
            log(f"Skill already exists with same source: {skill_file} (idempotent)")
            return skill_file
        log(f"Refusing to overwrite existing skill with different content: {skill_file}")
        return None

    title = lesson_title(lesson_path, lesson)
    frontmatter = lesson.get("frontmatter", {})
    body = lesson.get("body", "").strip()
    sections = parse_markdown_sections(body)
    note_ref = relative_to_notes(lesson_path)

    description = pick_frontmatter_value(frontmatter, ["description", "summary"])
    if not description:
        title_hint = pick_frontmatter_value(frontmatter, ["title", "name"])
        description = summarize_text(title_hint or title, max_chars=120)
    else:
        description = summarize_text(description, max_chars=140)

    trigger_text = (
        pick_frontmatter_value(frontmatter, ["trigger", "触发条件", "适用场景"])
        or pick_section_value(sections, ["Trigger", "触发条件", "适用场景", "现象", "问题"])
    )
    decision_text = (
        pick_frontmatter_value(frontmatter, ["decision", "核心原则"])
        or pick_section_value(sections, ["Decision", "核心原则", "正确做法", "解决方案", "根因"])
    )
    execution_text = (
        pick_frontmatter_value(frontmatter, ["execution", "执行步骤", "执行流程"])
        or pick_section_value(sections, ["Execution", "执行流程", "执行步骤", "How to Apply", "正确做法", "解决方案"])
    )
    anti_patterns_text = (
        pick_frontmatter_value(frontmatter, ["anti-patterns", "反模式"])
        or pick_section_value(sections, ["Anti-patterns", "反模式", "错误做法"])
    )
    output_text = (
        pick_frontmatter_value(frontmatter, ["output", "输出要求", "acceptance criteria", "验收标准"])
        or pick_section_value(sections, ["输出要求", "验收标准", "Checklist", "诊断检查清单"])
    )
    source_cases_text = pick_section_value(sections, ["Source Cases", "来源案例", "案例"])

    scenario_items = normalize_list_items(trigger_text, max_items=4)
    if not scenario_items and trigger_text:
        scenario_items = sentence_split_items(trigger_text, max_items=3)
    if not scenario_items and decision_text:
        scenario_items = sentence_split_items(decision_text, max_items=2)

    execution_items = normalize_list_items(execution_text, max_items=6)
    if not execution_items and execution_text:
        execution_items = sentence_split_items(execution_text, max_items=4)
    if not execution_items and decision_text:
        execution_items = sentence_split_items(decision_text, max_items=3)

    default_outputs = [
        "输出明确的处理结论与目标文件变更。",
        "记录关键决策依据，便于后续复用和审查。",
        "若不适用，明确说明阻断条件并给出后续动作。",
    ]

    output_items = normalize_list_items(output_text, max_items=5)
    if not output_items and output_text:
        output_items = sentence_split_items(output_text, max_items=3)
    if not output_items:
        output_items = list(default_outputs)

    anti_pattern_items = normalize_list_items(anti_patterns_text, max_items=4)
    if not anti_pattern_items and anti_patterns_text:
        anti_pattern_items = sentence_split_items(anti_patterns_text, max_items=3)

    source_case_items = normalize_list_items(source_cases_text, max_items=5)
    if not source_case_items and source_cases_text:
        source_case_items = sentence_split_items(source_cases_text, max_items=3)

    fallback_steps = [
        "确认当前问题与该技能适用场景匹配，并定位相关上下文。",
        "按既有约束执行核心决策，避免偏离主路径。",
        "产出可复核结果并补充必要证据。",
        "将本次执行结果回写到对应任务状态或知识资产。",
    ]
    background = summarize_text(body, max_chars=360) if body else ""

    skill_content = f"""---
name: {skill_name}
description: {description or f"Promoted from {note_ref}"}
---

# {title}

> 来源：`notes/lessons/{lesson_path.name}` | 晋升时间：{datetime.now().strftime("%Y-%m-%d")}

## 适用场景

{format_markdown_bullets(scenario_items, f"由 `{lesson_path.name}` 晋升得到；适用于重复出现且需要按需展开的操作流程。")}

## 执行流程

{format_markdown_steps(execution_items, fallback_steps)}

## 输出要求

{format_markdown_bullets(output_items, "待补充")}

## 边界与不适用场景

{format_markdown_bullets(anti_pattern_items, "当问题仍是一次性案例或证据不足时，不应直接套用该技能。")}

## 决策依据

- 核心决策：{summarize_text(decision_text, max_chars=180) if decision_text else "待补充（建议在后续迭代补齐 Decision/核心原则）。"}

## 背景补充（可选）

{background or "详见原始 note；当前模板仅提炼 procedural memory，不直接搬运全文。"}

## 来源

- 原 note：`notes/lessons/{lesson_path.name}`
- note 路径：`{note_ref}`
{format_markdown_bullets(source_case_items, "Source Cases 见原 note。")}
"""

    if not dry_run:
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file.write_text(skill_content.strip() + "\n", encoding="utf-8")
        log(f"Created skill: {skill_file}")
    else:
        log(f"[DRY-RUN] Would create skill: {skill_file}")

    return skill_file


def upsert_declarative_memory(
    lesson_path: Path,
    record: dict,
    target_path_str: Optional[str],
    dry_run: bool,
) -> Path:
    """Upsert a canonical declarative memory record by subject + key."""
    if not isinstance(record, dict):
        raise ValueError("Memory promotion requires a canonical record object")

    subject = str(record.get("subject", "")).strip()
    key = str(record.get("key", "")).strip()
    kind = str(record.get("kind", "")).strip()
    scope = str(record.get("scope", "")).strip()
    status = str(record.get("status", "")).strip()
    value_type = str(record.get("valueType", "")).strip()

    if not subject or not key or not kind or not value_type:
        raise ValueError("Declarative record missing required fields: subject/key/kind/valueType")
    if scope != "cross-session":
        raise ValueError("Declarative record scope must be cross-session")
    if status != "active":
        raise ValueError("Declarative record status must be active")
    if "value" not in record:
        raise ValueError("Declarative record missing value")

    target_file = resolve_allowed_target_path(target_path_str) if target_path_str else infer_memory_file(kind)
    if target_file.suffix != ".json":
        raise ValueError("Declarative memory target must be a JSON file")

    if not dry_run:
        target_file.parent.mkdir(parents=True, exist_ok=True)

    today = datetime.now().strftime("%Y-%m-%d")
    normalized_record = dict(record)
    normalized_record.setdefault("id", f"{subject}.{slugify_name(key)}")
    normalized_record.setdefault("source", {"type": "file", "ref": f"notes/lessons/{lesson_path.name}"})
    normalized_record["updatedAt"] = today
    normalized_record.setdefault("lastVerifiedAt", today)

    try:
        payload = json.loads(target_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        payload = {"version": "0.1", "kind": kind, "records": []}

    records = payload.get("records")
    if not isinstance(records, list):
        records = []

    replaced = False
    for idx, existing in enumerate(records):
        if (
            isinstance(existing, dict)
            and str(existing.get("subject", "")).strip() == subject
            and str(existing.get("key", "")).strip() == key
        ):
            records[idx] = normalized_record
            replaced = True
            break
    if not replaced:
        records.append(normalized_record)

    payload["kind"] = kind
    payload["records"] = records

    index_path = DECLARATIVE_MEMORY_DIR / "index.json"
    try:
        index_payload = json.loads(index_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        index_payload = {"version": "0.1", "namespace": "declarative", "files": [], "records": [], "metadata": {}}

    files = index_payload.setdefault("files", [])
    rel_target = relative_to_base(target_file)
    if not any(isinstance(item, dict) and item.get("path") == rel_target for item in files):
        files.append({"name": target_file.stem, "path": rel_target, "kind": kind})

    index_records = index_payload.setdefault("records", [])
    updated = False
    for item in index_records:
        if (
            isinstance(item, dict)
            and str(item.get("subject", "")).strip() == subject
            and str(item.get("key", "")).strip() == key
        ):
            item.update(
                {
                    "id": normalized_record["id"],
                    "subject": subject,
                    "key": key,
                    "kind": kind,
                    "status": "active",
                    "file": rel_target,
                    "updatedAt": today,
                }
            )
            updated = True
            break
    if not updated:
        index_records.append(
            {
                "id": normalized_record["id"],
                "subject": subject,
                "key": key,
                "kind": kind,
                "status": "active",
                "file": rel_target,
                "updatedAt": today,
            }
        )

    metadata = index_payload.setdefault("metadata", {})
    metadata["updatedAt"] = today
    metadata.setdefault("createdAt", today)

    if not dry_run:
        target_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        index_path.write_text(json.dumps(index_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        log(f"Upserted declarative memory: {target_file} ({subject}.{key})")
    else:
        log(f"[DRY-RUN] Would upsert declarative memory: {target_file} ({subject}.{key})")

    return target_file


def create_rule(lesson_path: Path, target_dir: Path, lesson: dict, dry_run: bool) -> Optional[Path]:
    """创建新 rule"""
    # 确定目标文件名
    stem = lesson_path.stem
    # 移除日期前缀
    clean_stem = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", stem)

    # 确定合适的子目录
    # 从 frontmatter 或内容推断类型
    fm = lesson["frontmatter"]
    category = "pattern"  # 默认

    if "cross-layer" in clean_stem.lower() or "跨层" in lesson["body"]:
        category = "pattern"
    elif "technique" in clean_stem.lower() or "技术" in lesson["body"]:
        category = "technique"
    elif "tool" in clean_stem.lower() or "工具" in lesson["body"]:
        category = "tool"

    rule_dir = target_dir / category
    rule_dir.mkdir(parents=True, exist_ok=True)

    rule_file = rule_dir / f"{clean_stem}.md"

    # 检查目标文件是否已存在 - 幂等性检查
    if rule_file.exists():
        existing_content = rule_file.read_text(encoding="utf-8")
        # 如果已存在且包含相同 lesson 来源，视为成功（幂等）
        if lesson_path.name in existing_content:
            log(f"Rule already exists with same source: {rule_file} (idempotent)")
            return rule_file
        # 否则拒绝覆盖
        log(f"Refusing to overwrite existing rule with different content: {rule_file}")
        return None

    # 构建 rule 内容
    today = datetime.now().strftime("%Y-%m-%d")
    rule_content = f"""---
name: {clean_stem}
description: {fm.get('title', clean_stem)}
---

# {fm.get('title', clean_stem.replace('-', ' ').title())}

> 来源：`notes/lessons/{lesson_path.name}` | 晋升时间：{today}

## 触发条件

{fm.get('Trigger', fm.get('trigger', '待补充'))}

## 核心原则

{fm.get('Decision', fm.get('decision', '待补充'))}

## 执行步骤

{fm.get('Execution', fm.get('execution', '待补充'))}

## 反模式

{fm.get('Anti-patterns', fm.get('反模式', '待补充'))}

## 参考

- Source Cases 见原 lesson：`notes/lessons/{lesson_path.name}`
"""

    if not dry_run:
        rule_file.write_text(rule_content.strip() + "\n")
        log(f"Created rule: {rule_file}")
    else:
        log(f"[DRY-RUN] Would create: {rule_file}")

    return rule_file


def merge_to_rule(lesson_path: Path, rule_path: Path, lesson: dict, dry_run: bool):
    """合并 lesson 到现有 rule - 幂等实现"""
    if not rule_path.exists():
        log(f"Rule file not found: {rule_path}")
        return False

    rule_content = rule_path.read_text(encoding="utf-8")
    today = datetime.now().strftime("%Y-%m-%d")
    lesson_id = lesson_path.name  # 用于去重

    # 幂等性检查: 检查是否已存在相同 lesson 的 Source Case
    if lesson_id in rule_content:
        log(f"Source case already exists for {lesson_id}, skipping (idempotent)")
        return True

    # 查找或创建 Source Cases 章节
    if "## Source Cases" in rule_content:
        # 追加到现有章节
        new_case = f"\n- **{today}**: 来自 `{lesson_path.name}`\n"
        # 在相关规范或参考章节前插入
        if "## 相关规范" in rule_content:
            rule_content = rule_content.replace("## 相关规范", new_case + "\n## 相关规范")
        elif "## 参考" in rule_content:
            rule_content = rule_content.replace("## 参考", new_case + "\n## 参考")
        else:
            rule_content += new_case
    else:
        # 创建新章节
        new_section = f"""

## Source Cases

- **{today}**: 来自 `{lesson_path.name}`
"""
        rule_content += new_section

    # 更新 Last Verified
    rule_content = update_frontmatter(rule_content, {"last_verified": today})

    if not dry_run:
        rule_path.write_text(rule_content)
        log(f"Updated rule with new source case: {rule_path}")
    else:
        log(f"[DRY-RUN] Would update: {rule_path}")

    return True


def update_lesson_status(lesson_path: Path, action: str, target: str, dry_run: bool):
    """更新 lesson 状态"""
    if not lesson_path.exists():
        log(f"Lesson file not found: {lesson_path}")
        return False

    content = lesson_path.read_text(encoding="utf-8")
    today = datetime.now().strftime("%Y-%m-%d")

    updates = {
        "status": "promoted" if action != "keep" else "active",
        "promoted_to": target if action != "keep" else "",
        "promoted_at": today if action != "keep" else "",
    }

    content = update_frontmatter(content, updates)

    if not dry_run:
        lesson_path.write_text(content)
        log(f"Updated lesson status: {lesson_path}")
    else:
        log(f"[DRY-RUN] Would update status: {lesson_path}")

    return True


def apply_promotion(result: dict, dry_run: bool) -> dict:
    """执行晋升"""
    actions = normalize_result_actions(result)
    summary = {
        "created": 0,
        "merged": 0,
        "kept": 0,
        "deferred": 0,
        "failed": 0,
        "files": [],
        "processed_ids": [],
        "failed_ids": [],
        "deferred_ids": [],
    }

    # 阈值策略常量
    THRESHOLD_MERGE = 0.8
    THRESHOLD_CREATE = 0.5

    def validate_action_threshold(action: dict, lesson_path: Path) -> Tuple[bool, str]:
        """验证 action 是否符合阈值策略

        Returns:
            (is_valid, error_message)
        """
        action_type = action.get("action", "keep")
        similarity = action.get("similarity")
        target_path_str = action.get("target")

        # keep 动作无需验证
        if action_type in {
            "keep",
            "promoted_to_rule",
            "promoted_to_skill",
            "indexed_in_memory",
            "create_rule",
            "create_skill",
            "upsert_memory",
        }:
            return True, ""

        # 如果没有 similarity，允许通过（向后兼容）
        if similarity is None:
            log(f"Warning: No similarity score for action {action.get('id')}, allowing")
            return True, ""

        sim = float(similarity)

        if action_type == "merge":
            if sim < THRESHOLD_MERGE:
                return False, f"Merge rejected: similarity {sim:.2f} < threshold {THRESHOLD_MERGE}"
            if not target_path_str:
                return False, "Merge action requires target path"

        elif action_type == "create":
            if sim >= THRESHOLD_MERGE:
                log(f"Warning: Create action with high similarity {sim:.2f}, consider merge instead")

        return True, ""

    for action in actions:
        action_type = action.get("action", "keep")
        lesson_path_str = action.get("lesson")
        target_path_str = action.get("target")
        reason = action.get("reason", "")

        action_id = action.get("id") or (lesson_path_str.split("/")[-1].replace(".md", "") if lesson_path_str else None)

        if not lesson_path_str:
            log(f"Skipping action without lesson path")
            summary["failed"] += 1
            if action_id:
                summary["failed_ids"].append(action_id)
            continue

        try:
            lesson_path = resolve_lesson_path(lesson_path_str)
        except ValueError as exc:
            log(str(exc))
            summary["failed"] += 1
            if action_id:
                summary["failed_ids"].append(action_id)
            commit_queue_item(action_id, False, dry_run)
            continue

        if not lesson_path.exists():
            log(f"Lesson not found: {lesson_path}")
            summary["failed"] += 1
            if action_id:
                summary["failed_ids"].append(action_id)
            commit_queue_item(action_id, False, dry_run)
            continue

        if action_type == "defer":
            summary["deferred"] += 1
            summary["files"].append({"action": "defer", "lesson": str(lesson_path), "reason": reason})
            if action_id:
                summary["deferred_ids"].append(action_id)
                commit_queue_item(action_id, False, dry_run)
            continue

        if action_type == "failed":
            log(f"Subagent reported failure for {lesson_path}: {reason}")
            summary["failed"] += 1
            summary["files"].append({"action": "failed", "lesson": str(lesson_path), "reason": reason})
            if action_id:
                summary["failed_ids"].append(action_id)
                commit_queue_item(action_id, False, dry_run)
            continue

        # 验证阈值策略
        is_valid, error_msg = validate_action_threshold(action, lesson_path)
        if not is_valid:
            log(f"Action rejected: {error_msg}")
            summary["failed"] += 1
            if action_id:
                summary["failed_ids"].append(action_id)
            commit_queue_item(action_id, False, dry_run)
            continue

        lesson = read_lesson(lesson_path)

        if action_type == "promoted_to_rule":
            action_type = "create_rule"
        elif action_type == "promoted_to_skill":
            action_type = "create_skill"
        elif action_type == "indexed_in_memory":
            action_type = "upsert_memory"
        elif action_type == "already_applied":
            action_type = "keep"

        if action_type in {"create", "create_rule"}:
            target_root = RULES_DIR
            if target_path_str:
                try:
                    target_root = resolve_allowed_target_path(target_path_str)
                except ValueError as exc:
                    log(str(exc))
                    summary["failed"] += 1
                    if action_id:
                        summary["failed_ids"].append(action_id)
                    commit_queue_item(action_id, False, dry_run)
                    continue

            if target_root == RULES_DIR or target_root.is_relative_to(RULES_DIR):
                rule_file = create_rule(lesson_path, target_root, lesson, dry_run)
            else:
                log(f"Create action currently only supports rules targets: {target_root}")
                rule_file = None
            if not rule_file:
                summary["failed"] += 1
                if action_id:
                    summary["failed_ids"].append(action_id)
                commit_queue_item(action_id, False, dry_run)
                continue
            update_lesson_status(lesson_path, "create", relative_to_base(rule_file), dry_run)
            summary["created"] += 1
            summary["files"].append({"action": "create", "lesson": str(lesson_path), "target": str(rule_file)})
            if action_id:
                summary["processed_ids"].append(action_id)
                # 原子性提交队列状态
                commit_queue_item(action_id, success=True, dry_run=dry_run)

        elif action_type == "create_skill":
            skill_target = SKILLS_DIR
            if target_path_str:
                try:
                    skill_target = resolve_allowed_target_path(target_path_str)
                except ValueError as exc:
                    log(str(exc))
                    summary["failed"] += 1
                    if action_id:
                        summary["failed_ids"].append(action_id)
                    commit_queue_item(action_id, False, dry_run)
                    continue

            try:
                skill_file = create_skill(lesson_path, skill_target, lesson, dry_run)
            except ValueError as exc:
                log(str(exc))
                summary["failed"] += 1
                if action_id:
                    summary["failed_ids"].append(action_id)
                commit_queue_item(action_id, False, dry_run)
                continue
            if not skill_file:
                summary["failed"] += 1
                if action_id:
                    summary["failed_ids"].append(action_id)
                commit_queue_item(action_id, False, dry_run)
                continue
            update_lesson_status(lesson_path, "create", relative_to_base(skill_file), dry_run)
            summary["created"] += 1
            summary["files"].append({"action": "create_skill", "lesson": str(lesson_path), "target": str(skill_file)})
            if action_id:
                summary["processed_ids"].append(action_id)
                commit_queue_item(action_id, success=True, dry_run=dry_run)

        elif action_type == "upsert_memory":
            try:
                target_file = upsert_declarative_memory(
                    lesson_path,
                    action.get("record"),
                    target_path_str,
                    dry_run,
                )
            except (ValueError, OSError) as exc:
                log(str(exc))
                summary["failed"] += 1
                if action_id:
                    summary["failed_ids"].append(action_id)
                commit_queue_item(action_id, False, dry_run)
                continue

            update_lesson_status(lesson_path, "create", relative_to_base(target_file), dry_run)
            summary["created"] += 1
            summary["files"].append({"action": "upsert_memory", "lesson": str(lesson_path), "target": str(target_file)})
            if action_id:
                summary["processed_ids"].append(action_id)
                commit_queue_item(action_id, success=True, dry_run=dry_run)

        elif action_type == "merge":
            # 合并到现有 rule
            if not target_path_str:
                log(f"Merge action requires target path")
                summary["failed"] += 1
                if action_id:
                    summary["failed_ids"].append(action_id)
                commit_queue_item(action_id, False, dry_run)
                continue

            try:
                target_path = resolve_allowed_target_path(target_path_str)
            except ValueError as exc:
                log(str(exc))
                summary["failed"] += 1
                if action_id:
                    summary["failed_ids"].append(action_id)
                commit_queue_item(action_id, False, dry_run)
                continue

            if not merge_to_rule(lesson_path, target_path, lesson, dry_run):
                summary["failed"] += 1
                if action_id:
                    summary["failed_ids"].append(action_id)
                commit_queue_item(action_id, False, dry_run)
                continue

            update_lesson_status(lesson_path, "merge", target_path_str, dry_run)
            summary["merged"] += 1
            summary["files"].append({"action": "merge", "lesson": str(lesson_path), "target": str(target_path)})
            if action_id:
                summary["processed_ids"].append(action_id)
                commit_queue_item(action_id, True, dry_run)

        elif action_type == "keep":
            # 保留在 notes
            update_lesson_status(lesson_path, "keep", "", dry_run)
            summary["kept"] += 1
            summary["files"].append({"action": "keep", "lesson": str(lesson_path), "reason": reason})
            if action_id:
                summary["processed_ids"].append(action_id)
                commit_queue_item(action_id, True, dry_run)

        else:
            log(f"Unknown action type: {action_type}")
            summary["failed"] += 1
            if action_id:
                summary["failed_ids"].append(action_id)
                commit_queue_item(action_id, False, dry_run)

    return summary


def commit_queue_item(candidate_id: str, success: bool, dry_run: bool):
    """原子性更新单个队列项状态

    Args:
        candidate_id: 候选 ID
        success: True 表示成功完成，False 表示失败需重试
        dry_run: 是否为 dry run
    """
    if dry_run:
        return

    with locked_queue() as queue:
        candidate_ref = None
        for candidate in queue["candidates"]:
            if candidate.get("id") == candidate_id:
                candidate_ref = candidate
                break

        # 从 processing 移除
        remaining = []
        found = False
        for c in queue["processing"]:
            if c.get("id") == candidate_id:
                found = True
                if success:
                    # 成功：添加到 completed
                    c["status"] = "completed"
                    c["completed_at"] = datetime.now().isoformat()
                    queue["completed"].append(c)
                    if candidate_ref is not None:
                        candidate_ref["status"] = "completed"
                        candidate_ref["completed_at"] = c["completed_at"]
                else:
                    # 失败：重置为 pending 重新入队
                    c["status"] = "pending"
                    c["claimed_at"] = None
                    if candidate_ref is not None:
                        candidate_ref["status"] = "pending"
                        candidate_ref["claimed_at"] = None
                    else:
                        queue["candidates"].append(c)
            else:
                remaining.append(c)

        queue["processing"] = remaining

        if found:
            log(f"Committed queue item {candidate_id}: {'completed' if success else 're-queued'}")
        else:
            log(f"Warning: candidate {candidate_id} not found in processing queue")


def cleanup_queue(processed_ids: List[str], failed_ids: List[str], dry_run: bool):
    """清理队列，将失败项重新入队

    注意：如果使用 commit_queue_item，此函数主要用于处理未单独提交的遗留项
    """
    if dry_run:
        log("[DRY-RUN] Would cleanup queue")
        return

    with locked_queue() as queue:
        queue["candidates"] = [c for c in queue["candidates"] if c["id"] not in processed_ids]
        pending_ids = {c["id"] for c in queue["candidates"]}

        remaining_processing = []
        for candidate in queue["processing"]:
            candidate_id = candidate.get("id")
            if candidate_id in processed_ids:
                continue
            if candidate_id in failed_ids:
                # 失败项重新入队
                candidate["status"] = "pending"
                candidate["claimed_at"] = None
                if candidate_id not in pending_ids:
                    queue["candidates"].append(candidate)
                    pending_ids.add(candidate_id)
                continue
            remaining_processing.append(candidate)

        queue["processing"] = remaining_processing
        if not queue["processing"]:
            queue["dispatch"]["status"] = "failed" if failed_ids else "idle"
            queue["dispatch"]["finishedAt"] = datetime.now().isoformat()
            queue["dispatch"]["lastError"] = (
                f"{len(failed_ids)} item(s) failed" if failed_ids else None
            )

    log(f"Cleaned up {len(processed_ids)} successful items and re-queued {len(failed_ids)} failed items")


def main():
    parser = argparse.ArgumentParser(description="Apply promotion results")
    parser.add_argument("--result-file", required=True, help="Path to promotion-result.json")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done")
    args = parser.parse_args()

    result_file = Path(args.result_file)
    if not result_file.is_absolute():
        result_file = BASE / result_file

    result = load_result(result_file)
    if not result:
        log("No result to apply")
        return

    log(f"Applying promotion result from: {result_file}")

    summary = apply_promotion(result, args.dry_run)

    # 清理队列
    if not args.dry_run:
        cleanup_queue(summary["processed_ids"], summary["failed_ids"], args.dry_run)

    # 输出摘要
    log(
        f"Promotion complete: {summary['created']} created, {summary['merged']} merged, "
        f"{summary['kept']} kept, {summary['deferred']} deferred, {summary['failed']} failed"
    )

    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
