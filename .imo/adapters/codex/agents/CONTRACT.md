# Codex Agents Contract

This directory will own templates or mapping rules for generated `.codex/agents/` content.

## Contract

- Source data originates in `.imo/`, not in generated host files.
- Host output is expected to mirror Codex agent entry files such as `*.toml`.
- For Trellis-owned Codex agent targets, this directory is a boundary contract rather than an active projection source in the current repo state. Do not store copied Trellis agent templates here while Trellis remains the active owner of `.codex/agents/trellis-*.toml`.
- Future Codex agent projections must use namespaced non-overlapping targets
  such as `.codex/agents/imo-*.toml`; same-path `trellis-*` agent takeover is
  intentionally abandoned.
