# Codex Hooks Contract

This directory will own templates or mapping rules for generated `.codex/hooks/` content.

## Contract

- Hook scripts are adapter outputs derived from `.imo/` source assets and runtime contracts.
- Host output may include hook registries plus Python or shell hook files, but generated `.codex/hooks/` remains non-authoritative.
- For the Trellis-owned Codex hook surface, this directory is a boundary contract rather than an active projection source in the current repo state. Do not store copied Trellis hook templates here while Trellis remains the active owner of that surface.
- Hooks are the second planned host-output cutover wave, after the agent-family handoff is proven and only under the upstream-first sequence in `../../HOST_OUTPUT_CUTOVER.md`.
- A local experiment may append a project `.codex/hooks.json` command that calls `./imo codex context`, but that is not a manifest claim and does not make `.codex/hooks.json` an IMO-owned generated target.
- `./imo codex context` must remain informational: it may point Codex to repo-local `.imo/` and `./imo`, but it must not override user instructions, parent-agent instructions, or Trellis workflow state.
