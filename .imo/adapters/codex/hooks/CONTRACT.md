# Codex Hooks Contract

This directory will own templates or mapping rules for generated `.codex/hooks/` content.

## Contract

- Hook scripts are adapter outputs derived from `.imo/` source assets and runtime contracts.
- Host output may include hook registries plus Python or shell hook files, but generated `.codex/hooks/` remains non-authoritative.
- Phase 2 currently manages the runtime-critical Codex hook files only:
  - `session-start.py`
  - `inject-workflow-state.py`
