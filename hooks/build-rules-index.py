#!/usr/bin/env python3
"""Build a lightweight index for on-demand rule injection."""

from __future__ import annotations

import json
import re
from pathlib import Path

CLAUDE_DIR = Path.home() / ".claude"
OUTPUT_PATH = CLAUDE_DIR / "rules-index.json"
SEARCH_DIRS = (CLAUDE_DIR / "rules", CLAUDE_DIR / "rules-library")
DOMAIN_KEYWORDS = {
    "domain/frontend": ["前端", "frontend", "组件", "页面", "component", "react", "css", "tailwind", "ui"],
    "domain/backend": ["后端", "backend", "api", "handler", "controller", "route"],
    "domain/ml": ["训练", "ml", "模型", "training", "dataset"],
    "domain/native": ["桌面", "native", "rust", "egui"],
    "pattern/": ["模式", "pattern"],
    "technique/": ["技术", "technique"],
    "tool/": ["工具", "tool"],
}

CHINESE_STOPWORDS = {
    "需要", "任务", "架构", "测试", "出现", "以下", "条件", "是否",
    "运行", "模式", "规范", "必须", "应用", "执行", "满足", "用户",
    "修改", "新增", "使用", "当前", "情况", "进行", "相关", "确认",
    "问题", "处理", "操作", "实现", "功能", "检查", "配置", "项目",
    "方案", "分析", "设计", "开发", "系统", "管理", "定义", "说明",
    "结果", "内容", "方式", "过程", "要求", "标准", "完成", "提供",
    "支持", "包含", "创建", "更新", "删除", "添加", "设置", "获取",
    "返回", "调用", "生成", "验证", "确保", "避免", "防止", "保持",
    "共享", "全局", "本地", "默认", "自动", "手动", "临时", "持久",
}

ENGLISH_STOPWORDS = {
    "the", "and", "for", "with", "from", "that", "this", "when",
    "will", "are", "not", "can", "has", "have", "should", "must",
    "may", "any", "all", "each", "both", "some", "use", "used",
    "using", "following", "above", "below", "pattern", "core",
}

STRONG_KW_MIN_LEN = 4

# Boilerplate CJK phrases that appear in many trigger sections
CJK_BOILERPLATE = {
    # Full boilerplate sentences
    "当出现以下任一情况时",
    "当满足以下任一情况时",
    "当满足以下任一条件时",
    "当出现以下任一条件时",
    "当任务满足以下任一条件时",
    "必须应用本规范",
    "应用本规范",
    "应当应用本规范",
    "请应用本规范",
    "满足以下任一情况时",
    "满足以下任一条件时",
    "出现以下任一情况时",
    "出现以下任一条件时",
    # Tail fragments from boilerplate
    "条件时", "情况时",
    "一条件时", "一情况时",
    "任一条件时", "任一情况时",
    "本规范", "用本规范",
}


def iter_rule_files() -> list[Path]:
    files: list[Path] = []
    for base in SEARCH_DIRS:
        if not base.exists():
            continue
        files.extend(sorted(path for path in base.rglob("*.md") if path.is_file()))
    return files


def extract_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return fallback


def extract_trigger_section(text: str) -> str:
    lines = text.splitlines()
    in_trigger = False
    collected: list[str] = []
    for line in lines:
        match = re.match(r"^(#{2,6})\s+(.+?)\s*$", line.strip())
        if match:
            heading = re.sub(r"\s*[\(（].*$", "", match.group(2)).strip()
            if in_trigger:
                break
            if heading == "触发条件":
                in_trigger = True
                continue
        if in_trigger:
            collected.append(line)
    return "\n".join(collected).strip()


def split_cjk_fragments(text: str) -> list[str]:
    fragments = re.findall(r"[\u4e00-\u9fff]{2,}", text)
    return fragments


def split_long_fragment(fragment: str, max_len: int = 6) -> list[str]:
    """Split a long CJK fragment at natural boundaries and extract tail phrases."""
    if len(fragment) <= max_len:
        return [fragment]
    # Split on common structural particles that mark phrase boundaries
    parts = re.split(r"[，。、；：！？的或与和及从把被让给对]", fragment)
    result: list[str] = []
    for part in parts:
        part = part.strip()
        if len(part) >= 2:
            result.append(part)
    # Also keep the original if it's reasonably sized
    if len(fragment) <= 12:
        result.append(fragment)
    # For long fragments, extract tail subphrases (3-5 chars) as they
    # often carry the core meaning (e.g. "...架构升级" -> "架构升级")
    if len(fragment) > max_len:
        for tail_len in (3, 4, 5):
            if tail_len < len(fragment):
                tail = fragment[-tail_len:]
                if tail not in result and not is_stopword(tail):
                    result.append(tail)
    return result if result else [fragment]


def extract_chinese_keywords(text: str) -> list[str]:
    """Extract CJK fragments, splitting long ones at natural boundaries."""
    keywords: list[str] = []
    for fragment in split_cjk_fragments(text):
        keywords.extend(split_long_fragment(fragment))
    return keywords


def extract_english_keywords(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{1,}", text.lower())


def derive_path_keywords(rel_path: str) -> list[str]:
    keywords: list[str] = []
    normalized = rel_path.replace("\\", "/")
    for marker, words in DOMAIN_KEYWORDS.items():
        if marker in normalized:
            keywords.extend(words)
    parts = [part for part in normalized.split("/") if part not in {"rules", "rules-library"}]
    for part in parts:
        if part.endswith(".md"):
            part = part[:-3]
        for token in re.split(r"[-_.]+", part):
            if len(token) >= 2:
                keywords.append(token.lower())
    return keywords


def is_stopword(keyword: str) -> bool:
    """Check if a keyword is a stopword or boilerplate."""
    if keyword in ENGLISH_STOPWORDS:
        return True
    if keyword in CJK_BOILERPLATE:
        return True
    if len(keyword) <= 2 and keyword in CHINESE_STOPWORDS:
        return True
    return False


def normalize_keywords(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        keyword = re.sub(r"\s+", "", item.strip().lower())
        if len(keyword) < 2:
            continue
        if is_stopword(keyword):
            continue
        if keyword in seen:
            continue
        seen.add(keyword)
        result.append(keyword)
    return result


def classify_strong(keyword: str) -> bool:
    """A keyword is 'strong' if it's long enough to be domain-specific."""
    # CJK characters: each char counts as ~2 effective length
    cjk_count = sum(1 for ch in keyword if "\u4e00" <= ch <= "\u9fff")
    if cjk_count > 0:
        return len(keyword) >= 3  # e.g. "前端组件"(4), "架构升级"(4), "依赖解析"(4)
    return len(keyword) >= STRONG_KW_MIN_LEN  # e.g. "langchain", "worktree"


def build_entry(path: Path) -> dict[str, object] | None:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None

    rel_path = path.relative_to(CLAUDE_DIR).as_posix()
    title = extract_title(text, path.stem.replace("-", " "))
    trigger_section = extract_trigger_section(text)
    all_keywords = normalize_keywords(
        extract_chinese_keywords(trigger_section)
        + extract_english_keywords(trigger_section)
        + extract_chinese_keywords(title)
        + extract_english_keywords(title)
        + derive_path_keywords(rel_path)
    )

    strong = [kw for kw in all_keywords if classify_strong(kw)]
    weak = [kw for kw in all_keywords if not classify_strong(kw)]

    return {
        "path": rel_path,
        "title": title,
        "strong_keywords": strong,
        "keywords": weak,
        "size_bytes": path.stat().st_size,
        "always_loaded": rel_path.startswith("rules/"),
    }


def main() -> int:
    entries = [entry for path in iter_rule_files() if (entry := build_entry(path))]
    OUTPUT_PATH.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
