"""Importable compatibility package for the migrated self-verification module."""

import importlib.util
import sys
from pathlib import Path


_PKG_DIR = Path(__file__).resolve().parent
_SOURCE_DIR = _PKG_DIR.parent / "self-verification"


def _load_submodule(name: str):
    module_name = f"{__name__}.{name}"
    source = _SOURCE_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(module_name, source)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load {module_name} from {source}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _load_source_package():
    module_name = f"{__name__}._source"
    source = _SOURCE_DIR / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        module_name,
        source,
        submodule_search_locations=[str(_SOURCE_DIR)],
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load source package from {source}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


state = _load_submodule("state")
nodes = _load_submodule("nodes")
graph = _load_submodule("graph")
_source_pkg = _load_source_package()

for _name in getattr(_source_pkg, "__all__", []):
    globals()[_name] = getattr(_source_pkg, _name)

__all__ = list(getattr(_source_pkg, "__all__", []))
