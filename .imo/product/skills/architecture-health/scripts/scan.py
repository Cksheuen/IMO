#!/usr/bin/env python3
import argparse
import ast
import json
import os
import re
import sys
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Tuple

EXCLUDE_DIRS = {
    ".git", "node_modules", "vendor", "generated", "dist", "build",
    ".runtime", "__pycache__", ".claude",
}
CODE_EXTENSIONS = {".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
DOMAINS = ("general", "frontend", "backend")
METRIC_KEYS = (
    "max_file_lines",
    "max_functions_per_file",
    "duplicate_function_name_count",
    "max_imports_per_file",
)
THRESHOLDS: Dict[str, Dict[str, Dict[str, int]]] = {
    "general": {
        "max_file_lines": {"growth": 300, "structured": 800},
        "max_functions_per_file": {"growth": 20, "structured": 50},
        "duplicate_function_name_count": {"growth": 5, "structured": 20},
        "max_imports_per_file": {"growth": 20, "structured": 60},
    },
    "frontend": {
        "max_file_lines": {"growth": 250, "structured": 600},
        "max_functions_per_file": {"growth": 15, "structured": 40},
        "duplicate_function_name_count": {"growth": 8, "structured": 30},
        "max_imports_per_file": {"growth": 25, "structured": 80},
    },
    "backend": {
        "max_file_lines": {"growth": 400, "structured": 1000},
        "max_functions_per_file": {"growth": 25, "structured": 70},
        "duplicate_function_name_count": {"growth": 3, "structured": 15},
        "max_imports_per_file": {"growth": 30, "structured": 100},
    },
}
JS_FUNC_DECL_RE = re.compile(r"\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)")
JS_ARROW_RE = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?"
    r"(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>"
)
JS_ARROW_COUNT_RE = re.compile(r"=>")
JS_IMPORT_RE = re.compile(
    r"^\s*import\s+(?:[^;'\"]+?\s+from\s+)?['\"][^'\"]+['\"]", re.M
)
JS_REQUIRE_RE = re.compile(r"\brequire\s*\(\s*['\"]")


def analyze_python(text: str) -> Tuple[int, int, List[str]]:
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return 0, 0, []
    functions = 0
    imports = 0
    names: List[str] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions += 1
            names.append(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            imports += 1
    return functions, imports, names


def analyze_js(text: str) -> Tuple[int, int, List[str]]:
    declared = JS_FUNC_DECL_RE.findall(text)
    arrow_names = JS_ARROW_RE.findall(text)
    functions = len(declared) + len(JS_ARROW_COUNT_RE.findall(text))
    imports = len(JS_IMPORT_RE.findall(text)) + len(JS_REQUIRE_RE.findall(text))
    return functions, imports, declared + arrow_names


def update_max(
    metrics: Dict[str, Any], key: str, path_key: str, value: int, rel: str
) -> None:
    if value > metrics[key] or (
        value == metrics[key]
        and (metrics[path_key] is None or rel < metrics[path_key])
    ):
        metrics[key] = value
        metrics[path_key] = rel


def project_files(root: Path):
    """Use Git's candidate list, including untracked but non-ignored files."""
    try:
        probe = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--is-inside-work-tree"],
            capture_output=True, check=False,
        )
    except FileNotFoundError:
        probe = None
    if probe is not None and probe.returncode != 0:
        message = os.fsdecode(probe.stderr).strip()
        # Only "not a repository" means outside Git; other errors (e.g. safe.directory) must not
        # silently widen the scan to ignored files.
        if "not a git repository" not in message.lower():
            raise RuntimeError("git cannot read this repository: " + message)
    if probe is not None and probe.returncode == 0 and probe.stdout.strip() == b"true":
        result = subprocess.run(
            ["git", "-C", str(root), "ls-files", "--cached", "--others",
             "--exclude-standard", "-z", "--", "."], capture_output=True,
        )
        if result.returncode:
            raise RuntimeError("git ls-files failed: " + os.fsdecode(result.stderr).strip())
        for name in sorted(set(result.stdout.split(b"\0")) - {b""}):
            path = root / os.fsdecode(name)
            if path.is_file():
                yield path
        return
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDE_DIRS)
        for filename in sorted(filenames):
            yield Path(dirpath) / filename


def file_hint(key: str, names: List[str], text: str) -> str:
    if key == "duplicate_function_name_count":
        repeated = [name for name, count in Counter(names).items() if count > 1]
        return "Check scopes of repeated definitions: " + ", ".join(repeated[:5]) + "; rename only unintended collisions."
    if key == "max_imports_per_file":
        imports = [line.strip() for line in text.splitlines()
                   if line.lstrip().startswith(("import ", "from ")) or "require(" in line]
        sample = "; ".join(imports[:2])[:180]
        return "Review dependency grouping around " + (sample or "dynamic imports") + "; extract a module only if those dependencies serve one responsibility."
    sample = ", ".join(names[:3]) or "top-level statements"
    if key == "max_functions_per_file":
        return "Review whether " + sample + " belong together; extract a cohesive function group."
    return "Inspect the responsibilities around " + sample + "; separate a focused section if it has independent callers."


def scan_project(root: Path) -> Tuple[Dict[str, Any], str]:
    metrics: Dict[str, Any] = {
        "max_file_lines": 0,
        "max_file_lines_path": None,
        "max_functions_per_file": 0,
        "max_functions_per_file_path": None,
        "duplicate_function_name_count": 0,
        "max_imports_per_file": 0,
        "max_imports_per_file_path": None,
        "scanned_files": 0,
    }
    metrics["top_files"] = {key: [] for key in METRIC_KEYS}
    seen_files: set[Path] = set()
    python_files = 0
    js_files = 0

    for path in project_files(root):
        if path.suffix.lower() not in CODE_EXTENSIONS:
            continue
        # Canonical code may intentionally live under a hidden directory
        # such as `.imo/`.  Scan it, but count compatibility symlinks only
        # once so root projections do not inflate architecture metrics.
        resolved = path.resolve(strict=False)
        if resolved in seen_files:
            continue
        seen_files.add(resolved)
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        metrics["scanned_files"] += 1
        if path.suffix.lower() == ".py":
            python_files += 1
        else:
            js_files += 1
        rel = str(path.relative_to(root))
        lines = len(text.splitlines())
        if path.suffix.lower() == ".py":
            functions, imports, names = analyze_python(text)
        else:
            functions, imports, names = analyze_js(text)
        update_max(metrics, "max_file_lines", "max_file_lines_path", lines, rel)
        update_max(
            metrics,
            "max_functions_per_file",
            "max_functions_per_file_path",
            functions,
            rel,
        )
        update_max(
            metrics,
            "max_imports_per_file",
            "max_imports_per_file_path",
            imports,
            rel,
        )
        metrics["duplicate_function_name_count"] += len(names) - len(set(names))

        values = (lines, functions, len(names) - len(set(names)), imports)
        for key, value in zip(METRIC_KEYS, values):
            if value <= 0:
                continue
            rows = metrics["top_files"][key]
            rows.append({"path": rel, "value": value, "_names": names, "_text": text})
            rows.sort(key=lambda row: (-row["value"], row["path"]))
            del rows[5:]

    for key, rows in metrics["top_files"].items():
        for row in rows:
            row["hint"] = file_hint(key, row.pop("_names"), row.pop("_text"))

    if python_files > js_files:
        domain = "backend"
    elif js_files > python_files:
        domain = "frontend"
    else:
        domain = "general"
    return metrics, domain


def evaluate(
    metrics: Dict[str, Any], domain: str
) -> Tuple[List[Dict[str, Any]], List[str], str]:
    thresholds = THRESHOLDS[domain]
    triggered: List[Dict[str, Any]] = []
    for key in METRIC_KEYS:
        value = metrics[key]
        threshold = thresholds[key]
        if value > threshold["growth"]:
            severity = "structured" if value > threshold["structured"] else "growth"
            triggered.append(
                {
                    "metric": key,
                    "value": value,
                    "growth_threshold": threshold["growth"],
                    "structured_threshold": threshold["structured"],
                    "severity": severity,
                }
            )
    if not triggered:
        stage = "bootstrap"
    elif any(item["severity"] == "structured" for item in triggered):
        stage = "needs_structured"
    else:
        stage = "needs_growth"
    recommendations = []
    for key, rows in metrics.get("top_files", {}).items():
        for row in rows:
            # Duplicate count is aggregated across the project; show its contributors.
            flagged = row["value"] > thresholds[key]["growth"] or (
                key == "duplicate_function_name_count" and row["value"] > 0
                and metrics[key] > thresholds[key]["growth"]
            )
            row["flagged"] = flagged
            if flagged:
                recommendations.append(
                    f"source says: {row['path']} ({key}={row['value']}); we infer: {row['hint']}"
                )
            else:
                row.pop("hint", None)
    return triggered, recommendations, stage


def render_text(result: Dict[str, Any]) -> str:
    metrics = result["metrics"]
    domain = result["domain"]
    thresholds = result["thresholds"][domain]
    lines = [
        f"schema_version: {result['schema_version']}",
        f"project_path: {result['project_path']}",
        f"domain: {domain}",
        f"current_stage: {result['current_stage']}",
        "metrics:",
        f"  scanned_files: {metrics['scanned_files']}",
        f"  max_file_lines: {metrics['max_file_lines']} ({metrics['max_file_lines_path']})",
        f"  max_functions_per_file: {metrics['max_functions_per_file']} ({metrics['max_functions_per_file_path']})",
        f"  duplicate_function_name_count: {metrics['duplicate_function_name_count']}",
        f"  max_imports_per_file: {metrics['max_imports_per_file']} ({metrics['max_imports_per_file_path']})",
        "thresholds:",
    ]
    for key in METRIC_KEYS:
        threshold = thresholds[key]
        lines.append(
            f"  {key}: growth={threshold['growth']} structured={threshold['structured']}"
        )
    lines.append("triggered_upgrades:")
    if result["triggered_upgrades"]:
        for item in result["triggered_upgrades"]:
            lines.append(
                f"  - {item['metric']}: {item['value']} > {item['growth_threshold']} ({item['severity']})"
            )
    else:
        lines.append("  (none)")
    lines.append("top_files (source says; hints are we infer):")
    for key, rows in result["top_files"].items():
        lines.append(f"  {key}:")
        for row in rows:
            lines.append(f"    {row['path']}: {row['value']}" +
                         (f"; {row['hint']}" if row.get("hint") else ""))
    lines.append("recommendations:")
    if result["recommendations"]:
        for recommendation in result["recommendations"]:
            lines.append(f"  - {recommendation}")
    else:
        lines.append("  (none)")
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Scan project architecture health.")
    parser.add_argument("--path", default=os.getcwd(), help="Project path to scan.")
    parser.add_argument(
        "--domain", choices=DOMAINS, default=None, help="Domain to use."
    )
    parser.add_argument(
        "--format", choices=["json", "text"], default="json", help="Output format."
    )
    args = parser.parse_args(argv)

    root = Path(args.path).resolve()
    if not root.exists() or not root.is_dir():
        print(
            f"error: path not found or not a directory: {args.path}", file=sys.stderr
        )
        return 2

    claude_root = (Path.home() / ".claude").resolve()
    if root == claude_root or root.is_relative_to(claude_root):
        print("error: refusing to scan ~/.claude", file=sys.stderr)
        return 2

    try:
        metrics, auto_domain = scan_project(root)
    except (OSError, RuntimeError) as exc:
        print(f"error: cannot scan project: {exc}", file=sys.stderr)
        return 2
    domain = args.domain or auto_domain
    triggered, recommendations, stage = evaluate(metrics, domain)
    result = {
        "schema_version": "1.0.0",
        "project_path": str(root),
        "domain": domain,
        "metrics": metrics,
        "top_files": metrics.pop("top_files"),
        "thresholds": THRESHOLDS,
        "triggered_upgrades": triggered,
        "recommendations": recommendations,
        "current_stage": stage,
    }
    if args.format == "json":
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(render_text(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
