# Codex Hooks Contract

This directory will own templates or mapping rules for generated `.codex/hooks/` content.

## Contract

- Hook scripts are adapter outputs derived from `.imo/` source assets and runtime contracts.
- Host output may include hook registries plus Python or shell hook files, but generated `.codex/hooks/` remains non-authoritative.
- For the Trellis-owned Codex hook surface, this directory is a boundary contract rather than an active projection source in the current repo state. Do not store copied Trellis hook templates here while Trellis remains the active owner of that surface.
- Hooks are the second planned host-output cutover wave, after the agent-family handoff is proven and only under the upstream-first sequence in `../../HOST_OUTPUT_CUTOVER.md`.
