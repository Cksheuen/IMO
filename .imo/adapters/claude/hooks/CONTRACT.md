# Claude Hooks Contract

This directory will own templates or mapping rules for generated `.claude/hooks/` content.

## Contract

- Hook scripts are adapter outputs derived from `.imo/` source assets and runtime contracts.
- Host output may include Python or shell hook files, but generated `.claude/hooks/` remains non-authoritative.
- Phase 2 currently manages the runtime-critical hook files only:
  - `session-start.py`
  - `inject-subagent-context.py`
  - `inject-workflow-state.py`
- Other hook files under the legacy host surface remain deferred until explicitly migrated.
