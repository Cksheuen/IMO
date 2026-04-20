#!/usr/bin/env python3
"""Read-only analyzer for subagent probe JSONL logs."""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

DEFAULT_INPUT = Path.home() / ".claude" / "logs" / "subagent-probe.jsonl"
MISSING_TYPE = "(missing)"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze ~/.claude/logs/subagent-probe.jsonl by subagent type."
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_INPUT),
        help="Path to subagent probe JSONL. Defaults to ~/.claude/logs/subagent-probe.jsonl.",
    )
    return parser.parse_args()


def normalize_text(value: object) -> str:
    return value if isinstance(value, str) else ""


def percentile(sorted_values: list[int], ratio: float) -> int:
    if not sorted_values:
        return 0
    if len(sorted_values) == 1:
        return sorted_values[0]

    position = (len(sorted_values) - 1) * ratio
    lower_index = math.floor(position)
    upper_index = math.ceil(position)
    lower = sorted_values[lower_index]
    upper = sorted_values[upper_index]
    if lower_index == upper_index:
        return lower

    weight = position - lower_index
    return int(round(lower + (upper - lower) * weight))


def sample_indices(total: int) -> list[int]:
    if total <= 0:
        return []
    if total == 1:
        return [0]
    if total == 2:
        return [0, 1]
    return [0, total // 2, total - 1]


def display_sample(text: str) -> str:
    flattened = " ".join(text.split())
    return flattened if flattened else "(empty)"


def load_records(path: Path) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)

    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue

            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                print(
                    f"Warning: skipped invalid JSON on line {line_number}.",
                    file=sys.stderr,
                )
                continue

            if not isinstance(record, dict):
                print(
                    f"Warning: skipped non-object record on line {line_number}.",
                    file=sys.stderr,
                )
                continue

            subagent_type = normalize_text(record.get("subagent_type")).strip() or MISSING_TYPE
            prompt_head = normalize_text(record.get("prompt_head"))
            groups[subagent_type].append(prompt_head)

    return groups


def print_group(name: str, prompts: list[str]) -> None:
    lengths = sorted(len(prompt.encode("utf-8", "ignore")) for prompt in prompts)
    print(f"[{name}]")
    print(f"  total: {len(prompts)}")
    print(
        "  prompt_head_len_bytes:"
        f" p50={percentile(lengths, 0.50)} p95={percentile(lengths, 0.95)}"
    )
    print("  samples:")
    for sample_number, index in enumerate(sample_indices(len(prompts)), start=1):
        print(f"    {sample_number}. {display_sample(prompts[index])}")
    print()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input).expanduser()

    if not input_path.exists():
        print(f"Input file not found: {input_path}")
        return 0

    if not input_path.is_file():
        print(f"Input path is not a file: {input_path}")
        return 0

    groups = load_records(input_path)
    if not groups:
        print(f"No valid probe records found in: {input_path}")
        return 0

    print(f"Input: {input_path}")
    print()
    for name, prompts in sorted(groups.items(), key=lambda item: (-len(item[1]), item[0])):
        print_group(name, prompts)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
