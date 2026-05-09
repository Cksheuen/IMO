# IMO Framework Source of Truth

This directory is the source-of-truth workspace for the IMO framework.

## Principles

- `.imo/` is the only intended source of truth for future framework-owned assets.
- Generated `.claude/` and `.codex/` content are adapter outputs, not truth.
- Stable runtime contracts live in-repo under `.imo/runtime/`.
- High-churn runtime state stays local under `.imo/.runtime/` and is ignored.
- Existing root `skills/`, `scripts/`, `.agents/`, `.claude/`, and `.codex/` remain legacy/reference until each surface is explicitly migrated behind IMO-managed outputs.

## Layout

- `product/`: reusable framework assets that will eventually replace legacy root sources.
- `adapters/`: host-specific template boundaries for Claude Code and Codex outputs.
- `runtime/`: stable runtime contracts, schemas, and bootstrap expectations.

## Current Status

- Phase 1 built directory and contract scaffolding only.
- Phase 2 introduces the first executable managed-output loop through `scripts/imo.sh`.
- The current Phase 2 closure only manages:
  - Claude/Codex agent files
  - Claude/Codex hook scripts
  - Claude/Codex shared config fragments (`.claude/settings.json`, `.codex/hooks.json`, `.codex/config.toml`)
- Skills, commands, and broader product migration remain deferred until the first output loop is stable.

## Runtime State

- Fully managed file outputs use `.imo/.runtime/managed-hashes.json` to remember the last generated content hash.
- Shared config outputs preserve non-IMO content and only replace IMO-owned keys or blocks.
