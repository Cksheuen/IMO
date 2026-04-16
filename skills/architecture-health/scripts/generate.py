#!/usr/bin/env python3
"""Generate the Knowledge System Health Dashboard.

Runs scan.py to collect data, injects it into dashboard.html template,
and writes the final report to a timestamped or specified output path.
"""

import json
import os
import subprocess
import sys
import webbrowser
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
SCAN_SCRIPT = SCRIPT_DIR / "scan.py"
TEMPLATE = SCRIPT_DIR / "dashboard.html"
DEFAULT_OUTPUT = Path.home() / ".claude" / "health-report.html"


def generate_issues(data: dict) -> list[dict]:
    """Generate diagnostic issues from scan data."""
    issues = []
    m = data["health_metrics"]

    # Critical issues
    if m["promotion_rate"] == 0 and data["total_counts"]["lessons"] > 0:
        issues.append({
            "severity": "critical",
            "message": f"晋升管道从未运行：0 条 rule 来自 notes 晋升（共 {data['total_counts']['lessons']} 个 lessons）"
        })

    if m["knowledge_source_diversity"] == 0 and data["total_counts"]["rules"] > 0:
        issues.append({
            "severity": "critical",
            "message": "知识来源单一：所有 rules 均来自 eat/brainstorm 直通车，notes 晋升路径未贡献任何 rule"
        })

    # Warning issues
    if m["lesson_spec_rate"] < 0.8 and data["total_counts"]["lessons"] > 0:
        total = data["total_counts"]["lessons"]
        compliant = int(m["lesson_spec_rate"] * total)
        issues.append({
            "severity": "warning",
            "message": f"{total - compliant}/{total} lessons 缺少标准元数据字段（Status/First Seen/Last Verified/Source Cases）"
        })

    if m["merge_ratio"] < 0.7 and data["total_counts"]["lessons"] > 0:
        issues.append({
            "severity": "warning",
            "message": f"归并率 {m['merge_ratio']:.0%}：存在日期前缀命名的 lesson，可能是流水账模式"
        })

    if m["design_landed_rate"] < 0.3 and data["total_counts"]["design"] > 0:
        proposed = data["status_distribution"].get("design", {}).get("proposed", 0)
        total = data["total_counts"]["design"]
        issues.append({
            "severity": "warning",
            "message": f"{proposed}/{total} design notes 仍为 proposed 状态，未落地实施"
        })

    if m["source_cases_density"] < 1.0 and data["total_counts"]["lessons"] > 0:
        issues.append({
            "severity": "warning",
            "message": f"Source Cases 密度偏低（{m['source_cases_density']:.1f}），lessons 缺少足够的支撑案例"
        })

    # Consolidation system
    cs = data.get("consolidation", {})
    if cs:
        if not cs.get("script_exists"):
            issues.append({
                "severity": "warning",
                "message": "整合框架未安装：hooks/consolidate/consolidate.py 缺失"
            })
        elif not cs.get("settings_session_end_hook"):
            issues.append({
                "severity": "warning",
                "message": "整合 SessionEnd hook 未在 settings.json 中注册"
            })
        else:
            state = cs.get("state")
            if state and state.get("total_runs", 0) > 0:
                hours = state.get("hours_since_last_run")
                sessions = state.get("session_count", 0)
                issues.append({
                    "severity": "info",
                    "message": f"整合系统已激活：已运行 {state['total_runs']} 次，距上次 {hours:.0f}h，待整合 {sessions} 个会话"
                })
            else:
                issues.append({
                    "severity": "info",
                    "message": "整合系统已配置，等待首次触发"
                })

    # Lesson capture system
    lc = data.get("lesson_capture", {})
    if lc:
        if not lc.get("hooks_exist"):
            issues.append({
                "severity": "critical",
                "message": "教训捕获系统未安装：hooks/lesson-capture/ 脚本缺失"
            })
        elif not lc.get("settings_statusline_integrated"):
            issues.append({
                "severity": "warning",
                "message": "信号检测未集成到 StatusLine，实时检测不可用"
            })
        else:
            issues.append({
                "severity": "info",
                "message": "教训捕获系统已激活：信号检测可用，Stop hook 接入为可选"
            })

    # Info
    if not issues:
        issues.append({
            "severity": "info",
            "message": "所有指标健康，知识系统运行良好"
        })

    return issues


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    output_path = Path(args[0]) if args else DEFAULT_OUTPUT

    # Run scanner
    result = subprocess.run(
        [sys.executable, str(SCAN_SCRIPT)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"Error running scan: {result.stderr}", file=sys.stderr)
        sys.exit(1)

    data = json.loads(result.stdout)

    # Generate issues
    data["issues"] = generate_issues(data)

    # Read template
    template = TEMPLATE.read_text(encoding="utf-8")

    # Inject data: replace the content between /*__DATA__*/ markers
    data_json = json.dumps(data, ensure_ascii=False, indent=2)

    # Pattern: /*__DATA__*/{...}/*__DATA__*/
    import re
    pattern = r'/\*__DATA__\*/.*?/\*__DATA__\*/'
    replacement = f'/*__DATA__*/{data_json}/*__DATA__*/'
    output_html = re.sub(pattern, replacement, template, flags=re.DOTALL)

    # Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(output_html, encoding="utf-8")
    print(f"Report generated: {output_path}")

    # Open in browser unless --no-open
    if "--no-open" not in sys.argv:
        webbrowser.open(f"file://{output_path}")


if __name__ == "__main__":
    main()
