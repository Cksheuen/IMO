#!/usr/bin/env python3
"""Promotion Loop mode management: enable / disable / status."""

from __future__ import annotations

import json
import sys
from pathlib import Path

CONFIG_PATH = Path.home() / ".claude" / "promotion-config.json"

DEFAULT_CONFIG = {"autoBackgroundEnabled": False}


def load_config() -> dict:
    if CONFIG_PATH.is_file():
        return json.loads(CONFIG_PATH.read_text())
    return dict(DEFAULT_CONFIG)


def save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: promotion-mode.py [enable|disable|status]")
        raise SystemExit(1)

    action = sys.argv[1].lower()
    cfg = load_config()

    if action == "enable":
        cfg["autoBackgroundEnabled"] = True
        save_config(cfg)
        print("autoBackgroundEnabled = true")
    elif action == "disable":
        cfg["autoBackgroundEnabled"] = False
        save_config(cfg)
        print("autoBackgroundEnabled = false")
    elif action == "status":
        print(f"autoBackgroundEnabled = {json.dumps(cfg.get('autoBackgroundEnabled', False))}")
    else:
        print(f"Unknown action: {action}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
