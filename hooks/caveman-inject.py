#!/usr/bin/env python3
"""Caveman injection hook (UserPromptSubmit).

Injects concise-Chinese protocol into every user prompt when caveman is enabled,
with allowlist exemption for long-form skills (brainstorm / eat / orchestrate ...).

Runtime contract (Claude Code UserPromptSubmit hook):
  stdin:  JSON payload from Claude Code, contains 'prompt' field (user's submitted text)
  stdout: additional system context to prepend (empty = no-op)
  exit:   always 0 (failure should never block user prompt)

Config: ~/.claude/caveman-config.json
Skill source of truth: skills/vendor/caveman/caveman/SKILL.md
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

CLAUDE_HOME = Path.home() / ".claude"
CONFIG_PATH = CLAUDE_HOME / "caveman-config.json"
SKILL_PATH = CLAUDE_HOME / "skills" / "vendor" / "caveman" / "caveman" / "SKILL.md"


def read_config() -> dict | None:
    if not CONFIG_PATH.is_file():
        return None
    try:
        return json.loads(CONFIG_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def read_stdin_prompt() -> str:
    try:
        raw = sys.stdin.read()
        if not raw:
            return ""
        payload = json.loads(raw)
        if isinstance(payload, dict):
            return payload.get("prompt", "") or payload.get("user_prompt", "") or ""
        return ""
    except (json.JSONDecodeError, ValueError):
        return ""


SKILL_TRIGGER_RE = re.compile(r"(?:^|\s)/([a-z][a-z0-9:_-]*)", re.IGNORECASE)
COMMAND_TAG_RE = re.compile(r"<command-name>/?([a-z][a-z0-9:_-]*)</command-name>", re.IGNORECASE)


def detect_skill_names(prompt: str) -> set[str]:
    names: set[str] = set()
    for m in SKILL_TRIGGER_RE.finditer(prompt):
        names.add(m.group(1).lower())
    for m in COMMAND_TAG_RE.finditer(prompt):
        names.add(m.group(1).lower())
    return names


def is_allowlisted(prompt: str, allowlist: list[str]) -> bool:
    triggered = detect_skill_names(prompt)
    if not triggered:
        return False
    allow = {s.lower() for s in allowlist}
    return any(name in allow for name in triggered)


def build_injection(intensity: str) -> str:
    header = "[caveman-mode active | intensity=" + intensity + "]"

    base = [
        "输出协议（本次会话默认生效）：",
        "1. 面向用户的说明、结论、progress update 一律使用中文。",
        "2. 删除客套话：`好的`、`我来帮你`、`没问题`、`希望这对你有帮助`、`这是一个不错的想法`、`可能需要考虑一下`、`让我先...再...然后...`。",
        "3. 删除 hedging：`也许`、`可能`、`我觉得`、`基本上`、`其实`。若不确定，直接用问号列出未知量。",
        "4. 技术术语、代码、命令、路径、报错原文、字段名保留英文原样。",
        "5. 结论先给，再给依据；依据先给路径/行号/命令证据，再给解释。",
    ]

    if intensity == "lite":
        base.append("6. 句式不变，仅去客套与冗余过渡；允许完整段落说明复杂决策。")
    elif intensity == "full":
        base.append("6. 短句优先，合并同义句，列表替代长段落；一句话能说清就不用两句。")
        base.append("7. 同类项直接用表格或项目符号，避免『首先/其次/最后』之类连接词。")
    elif intensity == "ultra":
        base.append("6. 电报体：一句一事实，主谓常省，箭头 → 表因果。")
        base.append("7. 列表优先，表格次之，段落最后。缩写常见词：DB / auth / cfg / req / res / fn / impl。")
        base.append("8. 只有破坏性操作、安全警告、多步序列必须展开说明，其余全部极简。")
    else:
        base.append("6. 句式不变，仅去客套与冗余过渡。")

    base.append("豁免条款：代码块、commit message、PR 描述、报错原文、引用的英文原句按原样输出。")
    base.append("若用户明确要求详细解释，或当前任务属于 brainstorm / eat / orchestrate / 设计讨论，暂停本协议。")

    return header + "\n" + "\n".join(base)


def main() -> None:
    cfg = read_config()
    if not cfg or not cfg.get("enabled", False):
        return

    intensity = cfg.get("intensity", "lite")
    if intensity not in {"lite", "full", "ultra"}:
        intensity = "lite"

    allowlist = cfg.get("allowlist_skills", [])
    prompt = read_stdin_prompt()

    if prompt and is_allowlisted(prompt, allowlist):
        sys.stdout.write(
            "[caveman-mode bypassed | allowlist skill detected → full verbosity permitted]\n"
        )
        return

    sys.stdout.write(build_injection(intensity) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    finally:
        sys.exit(0)
