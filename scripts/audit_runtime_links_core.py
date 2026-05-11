"""Compatibility wrapper for the canonical .imo product runtime-link helpers."""

from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_canonical_module():
    target = Path(__file__).resolve().parents[1] / ".imo" / "product" / "scripts" / "audit_runtime_links_core.py"
    spec = importlib.util.spec_from_file_location("_imo_product_audit_runtime_links_core", target)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load canonical module: {target}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_MODULE = _load_canonical_module()
_EXPORTS = getattr(_MODULE, "__all__", None)
if _EXPORTS is None:
    _EXPORTS = [name for name in vars(_MODULE) if not name.startswith("_")]

__all__ = list(_EXPORTS)
for _name in __all__:
    globals()[_name] = getattr(_MODULE, _name)
