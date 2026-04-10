"""
Minimal local example for the multi-model-agent migration.

This example avoids relying on package import semantics for the directory name
and instead loads the sibling module entrypoint directly from __init__.py.
"""

from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path
import sys


def _load_entry_module():
    module_path = Path(__file__).with_name("__init__.py")
    spec = importlib.util.spec_from_file_location(
        "multi_model_agent_migrated",
        module_path,
        submodule_search_locations=[str(module_path.parent)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {module_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    try:
        module = _load_entry_module()
    except ModuleNotFoundError as exc:
        print(
            "Prerequisite missing for runtime example:",
            exc,
            "- install dependencies from skills/multi-model-agent/migrated/requirements.txt to run this example.",
        )
        return

    result = asyncio.run(
        module.run_multi_model_routing(
            "Review a medium-sized refactor and choose the most suitable model."
        )
    )

    print("Selected model:", result["routing_decision"]["selected_model"])
    print("Summary:", result["summary"])


if __name__ == "__main__":
    main()
