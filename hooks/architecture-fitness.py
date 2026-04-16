#!/usr/bin/env python3
"""Analyze a project directory and emit architecture fitness metrics.

This script is intentionally dependency-free and relies only on Python's
standard library. It scans common source files, computes a small set of
architecture signals, and emits either JSON or a human-readable Chinese report.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

SOURCE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go", ".java"}
SKIP_DIRECTORIES = {
    "node_modules",
    ".git",
    "dist",
    "build",
    "target",
    ".next",
    "__pycache__",
    ".venv",
    "venv",
    ".cold-storage",
    ".trellis",
}
SKIP_LOCK_FILES = {"package-lock.json", "yarn.lock", "Cargo.lock"}

GENERAL_THRESHOLDS = {
    "single_file_lines": 200,
    "functions_per_file": 15,
    "imports_per_file": 10,
    "duplicate_functions": 2,
    "async_patterns_per_file": 2,
    "files_per_directory": 10,
}

FRONTEND_THRESHOLDS = {
    **GENERAL_THRESHOLDS,
    "direct_api_in_pages": True,
}

BACKEND_THRESHOLDS = {
    **GENERAL_THRESHOLDS,
    "handler_lines": 200,
    "raw_sql_in_handlers": True,
    "db_queries_per_handler": 3,
}

FUNCTION_NAME_PATTERNS = (
    re.compile(r"^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(", re.MULTILINE),
    re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]+>)?\s*\(", re.MULTILINE),
    re.compile(r"^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(", re.MULTILINE),
    re.compile(
        r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(",
        re.MULTILINE,
    ),
    re.compile(
        r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{?",
        re.MULTILINE,
    ),
    re.compile(
        r"^\s*([A-Za-z_]\w*)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{?",
        re.MULTILINE,
    ),
    re.compile(
        r"^\s*(?:public|private|protected|static|final|abstract|async|override|export|\s)*"
        r"([A-Za-z_]\w*)\s*\([^;=]*\)\s*\{",
        re.MULTILINE,
    ),
)

FUNCTION_SPAN_PATTERNS = (
    re.compile(r"^\s*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(", re.MULTILINE),
    re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+[A-Za-z_]\w*\s*(?:<[^>]+>)?\s*\(", re.MULTILINE),
    re.compile(r"^\s*func\s+(?:\([^)]*\)\s*)?[A-Za-z_]\w*\s*\(", re.MULTILINE),
    re.compile(
        r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_]\w*\s*\(",
        re.MULTILINE,
    ),
    re.compile(
        r"^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_]\w*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{?",
        re.MULTILINE,
    ),
    re.compile(
        r"^\s*[A-Za-z_]\w*\s*:\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{?",
        re.MULTILINE,
    ),
    re.compile(
        r"^\s*(?:public|private|protected|static|final|abstract|async|override|export|\s)*"
        r"[A-Za-z_]\w*\s*\([^;=]*\)\s*\{",
        re.MULTILINE,
    ),
)

ARROW_BLOCK_PATTERN = re.compile(r"=>\s*\{")
IMPORT_PATTERNS = (
    re.compile(r"^\s*import\s+[^\n]+", re.MULTILINE),
    re.compile(r"^\s*from\s+[^\n]+\s+import\s+[^\n]+", re.MULTILINE),
    re.compile(r"require\s*\("),
    re.compile(r"^\s*use\s+[^\n;]+;?", re.MULTILINE),
)
ASYNC_PATTERNS = (
    re.compile(r"\basync\s+def\b"),
    re.compile(r"\basync\s+function\b"),
    re.compile(r"\bawait\b"),
    re.compile(r"\.then\s*\("),
    re.compile(r"\bPromise\b"),
    re.compile(r"\btokio::spawn\b"),
)
DIRECT_API_PATTERN = re.compile(r"\bfetch\s*\(|\baxios(?:\.[A-Za-z_]\w*)?\s*\(|\binvoke\s*\(")
RAW_SQL_PATTERN = re.compile(
    r"\bSELECT\b|\bINSERT\s+INTO\b|\bUPDATE\b|\bDELETE\s+FROM\b|\bUPSERT\b|\bFROM\b\s+[A-Za-z_]",
    re.IGNORECASE,
)
DB_QUERY_PATTERN = re.compile(
    r"\b(?:execute|executemany|query|query_one|query_all|fetchall|fetchone|fetch_many)\s*\(|\bsql\s*`",
    re.IGNORECASE,
)
FUNCTION_IGNORE_NAMES = {"if", "for", "while", "switch", "catch", "constructor"}


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description="Measure architecture fitness of a source project.")
    parser.add_argument("--path", help="Project directory to analyze.")
    parser.add_argument(
        "--domain",
        choices=("frontend", "backend", "general"),
        default="general",
        help="Optional domain-specific checks.",
    )
    parser.add_argument(
        "--format",
        choices=("json", "text"),
        default="json",
        help="Output format.",
    )
    return parser.parse_args(argv)


def emit_json(payload: dict[str, Any]) -> None:
    """Write a JSON payload to stdout."""
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def emit_error(message: str, project: str | None = None) -> int:
    """Emit a JSON error payload and return exit code 1."""
    emit_json({"error": message, "project": project})
    return 1


def read_stdin_path() -> str | None:
    """Read project path from stdin JSON payload when --path is not provided."""
    raw = sys.stdin.read()
    if not raw.strip():
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    cwd = payload.get("cwd")
    return cwd if isinstance(cwd, str) and cwd.strip() else None


def resolve_project_path(cli_path: str | None) -> Path:
    """Resolve project path from CLI or stdin JSON."""
    raw_path = cli_path or read_stdin_path()
    if not raw_path:
        raise ValueError("缺少项目路径；请传入 --path 或通过 stdin 提供 JSON {\"cwd\": \"...\"}。")
    return Path(raw_path).expanduser()


def get_thresholds(domain: str) -> dict[str, Any]:
    """Return threshold configuration for a domain."""
    if domain == "frontend":
        return FRONTEND_THRESHOLDS
    if domain == "backend":
        return BACKEND_THRESHOLDS
    return GENERAL_THRESHOLDS


def should_skip_file(path: Path) -> bool:
    """Decide whether a file should be skipped."""
    name = path.name
    if name.startswith("."):
        return True
    if name in SKIP_LOCK_FILES:
        return True
    if path.suffix.lower() not in SOURCE_EXTENSIONS:
        return True
    return False


def iter_source_files(root: Path) -> list[Path]:
    """Yield source files under a root directory respecting skip rules."""
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root, topdown=True, onerror=lambda _err: None):
        dirnames[:] = [name for name in dirnames if name not in SKIP_DIRECTORIES]
        current_dir = Path(dirpath)
        for filename in filenames:
            path = current_dir / filename
            if should_skip_file(path):
                continue
            files.append(path)
    return files


def read_text(path: Path) -> str | None:
    """Read a text file using UTF-8 and skip unreadable files."""
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except (OSError, UnicodeError, PermissionError):
        return None


def normalize_relpath(root: Path, path: Path) -> str:
    """Convert a file path to a normalized project-relative string."""
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def line_count(text: str) -> int:
    """Count logical lines in a text blob."""
    if not text:
        return 0
    return len(text.splitlines())


def overlaps(span: tuple[int, int], existing: list[tuple[int, int]]) -> bool:
    """Check whether a regex span overlaps an existing span list."""
    start, end = span
    for other_start, other_end in existing:
        if start < other_end and end > other_start:
            return True
    return False


def extract_function_info(text: str) -> tuple[int, set[str]]:
    """Extract approximate function count and names using regex heuristics."""
    spans: list[tuple[int, int]] = []
    names: set[str] = set()

    for pattern in FUNCTION_NAME_PATTERNS:
        for match in pattern.finditer(text):
            name = match.group(1)
            if name in FUNCTION_IGNORE_NAMES:
                continue
            span = match.span()
            if overlaps(span, spans):
                continue
            spans.append(span)
            names.add(name)

    for pattern in FUNCTION_SPAN_PATTERNS:
        for match in pattern.finditer(text):
            span = match.span()
            if overlaps(span, spans):
                continue
            spans.append(span)

    for match in ARROW_BLOCK_PATTERN.finditer(text):
        span = match.span()
        if overlaps(span, spans):
            continue
        spans.append(span)

    return len(spans), names


def count_imports(text: str) -> int:
    """Count import-like statements with overlap protection."""
    spans: list[tuple[int, int]] = []
    for pattern in IMPORT_PATTERNS:
        for match in pattern.finditer(text):
            span = match.span()
            if overlaps(span, spans):
                continue
            spans.append(span)
    return len(spans)


def count_async_patterns(text: str) -> int:
    """Count async/concurrency markers in a file."""
    return sum(len(pattern.findall(text)) for pattern in ASYNC_PATTERNS)


def is_frontend_page_or_component(rel_path: str) -> bool:
    """Check whether a path belongs to pages or components."""
    parts = Path(rel_path).parts
    return "pages" in parts or "components" in parts


def is_backend_handler(rel_path: str) -> bool:
    """Check whether a path belongs to routes/handlers/controllers."""
    parts = Path(rel_path).parts
    return any(part in {"routes", "handlers", "controllers"} for part in parts)


def assess_stage(triggers: list[dict[str, Any]]) -> str:
    """Assess architecture stage based on triggered upgrades."""
    if not triggers:
        return "bootstrap"
    stage3 = {"circular_dependency", "test_requires_runtime", "cross_module_bug_fix"}
    stage2 = {
        "single_file_lines",
        "functions_per_file",
        "imports_per_file",
        "duplicate_functions",
        "async_patterns",
        "directory_imbalance",
    }
    if any(trigger["trigger"] in stage3 for trigger in triggers):
        return "needs_structured"
    if any(trigger["trigger"] in stage2 for trigger in triggers):
        return "needs_growth"
    return "bootstrap"


def build_trigger(
    trigger: str,
    file_path: str | None,
    value: Any,
    threshold: Any,
    target_stage: str,
) -> dict[str, Any]:
    """Create a normalized trigger entry."""
    payload: dict[str, Any] = {
        "trigger": trigger,
        "value": value,
        "threshold": threshold,
        "target_stage": target_stage,
    }
    if file_path:
        payload["file"] = file_path
    return payload


def build_recommendations(triggers: list[dict[str, Any]], domain: str) -> list[str]:
    """Generate Chinese recommendations from triggered signals."""
    if not triggers:
        return ["当前项目仍处于可直接迭代的 bootstrap 阶段，建议继续保持小步提交，并定期复查文件长度、导入数与职责边界。"]

    seen: set[str] = set()
    recommendations: list[str] = []
    for item in triggers:
        trigger = item["trigger"]
        if trigger in seen:
            continue
        seen.add(trigger)
        if trigger == "single_file_lines":
            recommendations.append("出现超长文件，优先按稳定职责拆分模块，不要只做表层函数搬运。")
        elif trigger == "functions_per_file":
            recommendations.append("单文件函数过多，说明职责聚集，建议围绕领域语义拆出更清晰的边界。")
        elif trigger == "imports_per_file":
            recommendations.append("导入过多通常意味着耦合面过宽，建议收敛依赖方向，减少横向直接引用。")
        elif trigger == "duplicate_functions":
            recommendations.append("跨文件重复函数名较多，建议抽取共享模块或统一约定，避免并行演化出多套实现。")
        elif trigger == "async_patterns":
            recommendations.append("同一文件混入多种异步模式，建议把编排逻辑与具体 IO 实现拆开，降低时序复杂度。")
        elif trigger == "directory_imbalance":
            recommendations.append("目录文件分布明显失衡，建议把热点目录按职责继续分层，避免形成新的巨型目录。")
        elif trigger == "direct_api_in_pages":
            recommendations.append("前端页面或组件中发现直接 API 调用，建议下沉到 service、query 或 action 层。")
        elif trigger == "handler_lines":
            recommendations.append("后端 handler 体量过大，建议把校验、编排、数据访问拆开，保留 handler 作为薄入口。")
        elif trigger == "raw_sql_in_handlers":
            recommendations.append("后端入口层出现原始 SQL，建议迁移到 repository 或 data-access 层，避免传输层直接操作持久化细节。")
        elif trigger == "db_queries_per_handler":
            recommendations.append("单个 handler 内数据库查询过多，建议引入聚合服务或预取策略，减少入口层编排负担。")

    if domain == "frontend" and "direct_api_in_pages" not in seen:
        recommendations.append("前端可继续关注页面层是否只负责展示和编排，避免业务调用再次回流到组件层。")
    if domain == "backend" and "raw_sql_in_handlers" not in seen:
        recommendations.append("后端可继续关注路由、handler、service、repository 的边界是否稳定，避免跨层回写。")
    return recommendations


def analyze_project(root: Path, domain: str) -> dict[str, Any]:
    """Analyze a project and return the complete architecture fitness payload."""
    thresholds = get_thresholds(domain)
    source_files = iter_source_files(root)

    max_file_lines = 0
    max_functions_per_file = 0
    max_imports_per_file = 0

    files_over_200_lines: list[dict[str, Any]] = []
    files_over_15_functions: list[dict[str, Any]] = []
    files_over_10_imports: list[dict[str, Any]] = []
    multi_async_files: list[str] = []
    multi_async_file_details: list[dict[str, Any]] = []
    directory_counts: Counter[str] = Counter()
    function_to_files: dict[str, set[str]] = defaultdict(set)

    frontend_direct_api_files: list[str] = []
    backend_handler_line_flags: list[dict[str, Any]] = []
    backend_raw_sql_files: list[str] = []
    backend_db_query_flags: list[dict[str, Any]] = []

    unreadable_files: list[str] = []
    triggers: list[dict[str, Any]] = []

    for path in source_files:
        rel_path = normalize_relpath(root, path)
        text = read_text(path)
        if text is None:
            unreadable_files.append(rel_path)
            continue

        lines = line_count(text)
        function_count, function_names = extract_function_info(text)
        import_count = count_imports(text)
        async_pattern_count = count_async_patterns(text)

        max_file_lines = max(max_file_lines, lines)
        max_functions_per_file = max(max_functions_per_file, function_count)
        max_imports_per_file = max(max_imports_per_file, import_count)
        directory_counts[str(Path(rel_path).parent)] += 1

        for name in function_names:
            function_to_files[name].add(rel_path)

        if lines > GENERAL_THRESHOLDS["single_file_lines"]:
            files_over_200_lines.append({"file": rel_path, "lines": lines})
            triggers.append(
                build_trigger(
                    "single_file_lines",
                    rel_path,
                    lines,
                    thresholds["single_file_lines"],
                    "growth",
                )
            )

        if function_count > GENERAL_THRESHOLDS["functions_per_file"]:
            files_over_15_functions.append({"file": rel_path, "count": function_count})
            triggers.append(
                build_trigger(
                    "functions_per_file",
                    rel_path,
                    function_count,
                    thresholds["functions_per_file"],
                    "growth",
                )
            )

        if import_count > GENERAL_THRESHOLDS["imports_per_file"]:
            files_over_10_imports.append({"file": rel_path, "count": import_count})
            triggers.append(
                build_trigger(
                    "imports_per_file",
                    rel_path,
                    import_count,
                    thresholds["imports_per_file"],
                    "growth",
                )
            )

        if async_pattern_count >= GENERAL_THRESHOLDS["async_patterns_per_file"]:
            multi_async_files.append(rel_path)
            multi_async_file_details.append({"file": rel_path, "count": async_pattern_count})
            triggers.append(
                build_trigger(
                    "async_patterns",
                    rel_path,
                    async_pattern_count,
                    thresholds["async_patterns_per_file"],
                    "growth",
                )
            )

        if domain == "frontend" and thresholds.get("direct_api_in_pages") and is_frontend_page_or_component(rel_path):
            if DIRECT_API_PATTERN.search(text):
                frontend_direct_api_files.append(rel_path)
                triggers.append(build_trigger("direct_api_in_pages", rel_path, True, True, "growth"))

        if domain == "backend" and is_backend_handler(rel_path):
            if lines > int(thresholds["handler_lines"]):
                backend_handler_line_flags.append({"file": rel_path, "lines": lines})
                triggers.append(
                    build_trigger(
                        "handler_lines",
                        rel_path,
                        lines,
                        thresholds["handler_lines"],
                        "growth",
                    )
                )
            if thresholds.get("raw_sql_in_handlers") and RAW_SQL_PATTERN.search(text):
                backend_raw_sql_files.append(rel_path)
                triggers.append(build_trigger("raw_sql_in_handlers", rel_path, True, True, "structured"))
            db_query_count = len(DB_QUERY_PATTERN.findall(text))
            if db_query_count > int(thresholds["db_queries_per_handler"]):
                backend_db_query_flags.append({"file": rel_path, "count": db_query_count})
                triggers.append(
                    build_trigger(
                        "db_queries_per_handler",
                        rel_path,
                        db_query_count,
                        thresholds["db_queries_per_handler"],
                        "growth",
                    )
                )

    duplicate_pattern_count = sum(1 for files in function_to_files.values() if len(files) >= 2)
    if duplicate_pattern_count >= GENERAL_THRESHOLDS["duplicate_functions"]:
        triggers.append(
            build_trigger(
                "duplicate_functions",
                None,
                duplicate_pattern_count,
                thresholds["duplicate_functions"],
                "growth",
            )
        )

    directory_imbalances: list[dict[str, Any]] = []
    sibling_groups: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for directory, count in directory_counts.items():
        parent = str(Path(directory).parent)
        sibling_groups[parent].append((directory, count))
    for siblings in sibling_groups.values():
        if len(siblings) < 2:
            continue
        low_exists = any(count < 3 for _directory, count in siblings)
        if not low_exists:
            continue
        for directory, count in siblings:
            if count > GENERAL_THRESHOLDS["files_per_directory"]:
                directory_imbalances.append({"directory": directory, "count": count})
                triggers.append(
                    build_trigger(
                        "directory_imbalance",
                        directory,
                        count,
                        thresholds["files_per_directory"],
                        "growth",
                    )
                )

    files_over_200_lines.sort(key=lambda item: (-int(item["lines"]), str(item["file"])))
    files_over_15_functions.sort(key=lambda item: (-int(item["count"]), str(item["file"])))
    files_over_10_imports.sort(key=lambda item: (-int(item["count"]), str(item["file"])))
    multi_async_files.sort()
    multi_async_file_details.sort(key=lambda item: (-int(item["count"]), str(item["file"])))
    directory_imbalances.sort(key=lambda item: (-int(item["count"]), str(item["directory"])))
    backend_handler_line_flags.sort(key=lambda item: (-int(item["lines"]), str(item["file"])))
    backend_db_query_flags.sort(key=lambda item: (-int(item["count"]), str(item["file"])))
    frontend_direct_api_files.sort()
    backend_raw_sql_files.sort()
    unreadable_files.sort()

    metrics: dict[str, Any] = {
        "total_source_files": len(source_files),
        "max_file_lines": max_file_lines,
        "files_over_200_lines": files_over_200_lines,
        "max_functions_per_file": max_functions_per_file,
        "files_over_15_functions": files_over_15_functions,
        "max_imports_per_file": max_imports_per_file,
        "files_over_10_imports": files_over_10_imports,
        "duplicate_pattern_count": duplicate_pattern_count,
        "multi_async_files": multi_async_files,
        "multi_async_file_details": multi_async_file_details,
        "directory_imbalance_count": len(directory_imbalances),
        "directory_imbalances": directory_imbalances,
        "unreadable_files_skipped": unreadable_files,
    }

    if domain == "frontend":
        metrics["direct_api_in_pages"] = frontend_direct_api_files
    if domain == "backend":
        metrics["handlers_over_200_lines"] = backend_handler_line_flags
        metrics["raw_sql_in_handlers"] = backend_raw_sql_files
        metrics["handlers_over_3_db_queries"] = backend_db_query_flags

    current_stage = assess_stage(triggers)
    recommendations = build_recommendations(triggers, domain)

    return {
        "project": str(root.resolve()),
        "domain": domain,
        "current_stage": current_stage,
        "metrics": metrics,
        "triggered_upgrades": triggers,
        "recommendations": recommendations,
    }


def format_detail_list(items: list[dict[str, Any]], primary_key: str, value_key: str, label: str) -> list[str]:
    """Format top-N detail rows for text output."""
    if not items:
        return [f"- {label}: 无"]
    lines = [f"- {label}: {len(items)} 个"]
    for item in items[:5]:
        lines.append(f"  - {item[primary_key]}: {item[value_key]}")
    return lines


def render_text_report(payload: dict[str, Any]) -> str:
    """Render a human-readable Chinese report."""
    metrics = payload["metrics"]
    lines: list[str] = [
        "架构适应度报告",
        f"项目: {payload['project']}",
        f"领域: {payload['domain']}",
        f"当前阶段: {payload['current_stage']}",
        "",
        "指标概览",
        f"- 源文件总数: {metrics['total_source_files']}",
        f"- 最长文件行数: {metrics['max_file_lines']}",
        f"- 单文件最大函数数: {metrics['max_functions_per_file']}",
        f"- 单文件最大导入数: {metrics['max_imports_per_file']}",
        f"- 重复函数名模式数: {metrics['duplicate_pattern_count']}",
        f"- 多异步模式文件数: {len(metrics['multi_async_files'])}",
        f"- 目录失衡数: {metrics['directory_imbalance_count']}",
    ]

    lines.extend(format_detail_list(metrics["files_over_200_lines"], "file", "lines", "超过 200 行的文件"))
    lines.extend(format_detail_list(metrics["files_over_15_functions"], "file", "count", "超过 15 个函数的文件"))
    lines.extend(format_detail_list(metrics["files_over_10_imports"], "file", "count", "超过 10 个导入的文件"))

    if metrics["multi_async_file_details"]:
        lines.append(f"- 多异步模式文件明细: {len(metrics['multi_async_file_details'])} 个")
        for item in metrics["multi_async_file_details"][:5]:
            lines.append(f"  - {item['file']}: {item['count']}")
    else:
        lines.append("- 多异步模式文件明细: 无")

    if payload["domain"] == "frontend":
        direct_api_files = metrics.get("direct_api_in_pages", [])
        if direct_api_files:
            lines.append(f"- 页面/组件内直接 API 调用: {len(direct_api_files)} 个")
            for file_path in direct_api_files[:5]:
                lines.append(f"  - {file_path}")
        else:
            lines.append("- 页面/组件内直接 API 调用: 无")

    if payload["domain"] == "backend":
        lines.extend(format_detail_list(metrics.get("handlers_over_200_lines", []), "file", "lines", "超过 200 行的 handler"))
        raw_sql_files = metrics.get("raw_sql_in_handlers", [])
        if raw_sql_files:
            lines.append(f"- handler 中原始 SQL: {len(raw_sql_files)} 个")
            for file_path in raw_sql_files[:5]:
                lines.append(f"  - {file_path}")
        else:
            lines.append("- handler 中原始 SQL: 无")
        lines.extend(format_detail_list(metrics.get("handlers_over_3_db_queries", []), "file", "count", "超过 3 次 DB 查询的 handler"))

    lines.append("")
    lines.append("触发的升级信号")
    if payload["triggered_upgrades"]:
        for trigger in payload["triggered_upgrades"][:12]:
            file_label = f" | 文件: {trigger['file']}" if "file" in trigger else ""
            lines.append(
                f"- {trigger['trigger']} | 当前值: {trigger['value']} | 阈值: {trigger['threshold']} | 目标阶段: {trigger['target_stage']}{file_label}"
            )
    else:
        lines.append("- 无")

    lines.append("")
    lines.append("建议")
    for recommendation in payload["recommendations"]:
        lines.append(f"- {recommendation}")

    unreadable = metrics.get("unreadable_files_skipped", [])
    if unreadable:
        lines.append("")
        lines.append("附注")
        lines.append(f"- 已跳过无法读取的文件: {len(unreadable)} 个")

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint."""
    args = parse_args(argv or sys.argv[1:])
    try:
        project_path = resolve_project_path(args.path)
    except ValueError as exc:
        return emit_error(str(exc))

    if not project_path.exists():
        return emit_error("项目路径不存在。", str(project_path))
    if not project_path.is_dir():
        return emit_error("项目路径不是目录。", str(project_path))

    try:
        payload = analyze_project(project_path, args.domain)
    except Exception as exc:
        return emit_error(f"分析失败: {exc}", str(project_path))

    if args.format == "text":
        print(render_text_report(payload))
    else:
        emit_json(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
