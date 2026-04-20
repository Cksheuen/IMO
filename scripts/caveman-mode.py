#!/usr/bin/env python3
"""Caveman mode manager.

Actions:
  enable / disable / status
  intensity <lite|full|ultra>
  allowlist add <skill>
  allowlist remove <skill>
  allowlist list

Config: ~/.claude/caveman-config.json (machine-local, not version-controlled).
Consumed by hooks/caveman-inject.py on UserPromptSubmit.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

CONFIG_PATH = Path.home() / ".claude" / "caveman-config.json"

VALID_INTENSITIES = {"lite", "full", "ultra"}

DEFAULT_ALLOWLIST = [
    "brainstorm",
    "eat",
    "orchestrate",
    "locate",
    "promote-notes",
    "dual-review-loop",
    "lesson-review",
    "metrics-weekly",
    "metrics-daily",
    "architecture-health",
    "skill-creator",
    "pencil-design",
    "multi-model-agent",
]

DEFAULT_CONFIG = {
    "version": 1,
    "enabled": True,
    "intensity": "lite",
    "allowlist_skills": list(DEFAULT_ALLOWLIST),
    "updatedAt": None,
}


def load_config() -> dict:
    if CONFIG_PATH.is_file():
        try:
            cfg = json.loads(CONFIG_PATH.read_text())
            for key, default_val in DEFAULT_CONFIG.items():
                cfg.setdefault(key, default_val)
            return cfg
        except json.JSONDecodeError:
            pass
    return dict(DEFAULT_CONFIG)


def save_config(cfg: dict) -> None:
    cfg["updatedAt"] = datetime.utcnow().isoformat(timespec="seconds")
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")


def print_status(cfg: dict) -> None:
    print(json.dumps(cfg, indent=2, ensure_ascii=False))


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: caveman-mode.py [enable|disable|status|intensity|allowlist] [...]")
        raise SystemExit(1)

    action = sys.argv[1].lower()
    cfg = load_config()

    if action == "enable":
        cfg["enabled"] = True
        save_config(cfg)
        print(f"caveman enabled = true (intensity={cfg['intensity']})")
    elif action == "disable":
        cfg["enabled"] = False
        save_config(cfg)
        print("caveman enabled = false")
    elif action == "status":
        print_status(cfg)
    elif action == "intensity":
        if len(sys.argv) < 3 or sys.argv[2] not in VALID_INTENSITIES:
            print(f"Usage: caveman-mode.py intensity <{'|'.join(sorted(VALID_INTENSITIES))}>")
            raise SystemExit(1)
        cfg["intensity"] = sys.argv[2]
        save_config(cfg)
        print(f"caveman intensity = {cfg['intensity']}")
    elif action == "allowlist":
        if len(sys.argv) < 3:
            print("Usage: caveman-mode.py allowlist <add|remove|list> [skill]")
            raise SystemExit(1)
        sub = sys.argv[2].lower()
        if sub == "list":
            print("\n".join(cfg["allowlist_skills"]))
        elif sub in {"add", "remove"}:
            if len(sys.argv) < 4:
                print(f"Usage: caveman-mode.py allowlist {sub} <skill>")
                raise SystemExit(1)
            name = sys.argv[3]
            lst = cfg["allowlist_skills"]
            if sub == "add" and name not in lst:
                lst.append(name)
            elif sub == "remove" and name in lst:
                lst.remove(name)
            save_config(cfg)
            print("\n".join(lst))
        else:
            print(f"Unknown allowlist action: {sub}")
            raise SystemExit(1)
    else:
        print(f"Unknown action: {action}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
