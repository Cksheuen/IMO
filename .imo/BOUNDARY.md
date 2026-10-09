# IMO Boundaries

## Ownership

- Canonical product source: `.imo/product/**`.
- Stable runtime contracts: `.imo/runtime/**`.
- Learning policy and schemas: `.imo/learning/**`.
- Local mutable state: `~/.imo/runtime/**` and project namespaces under
  `~/.imo/projects/<project-id>/runtime/**`.
- Root wrappers and projections contain no competing implementation.
- External providers, host configuration, and repository task workflows remain
  independently owned.

## Integration

- Provider discovery is read-only.
- Provider invocation is disabled by default and requires explicit ownership,
  side-effect, and safe-mode metadata.
- Provider failures degrade at the integration boundary and must not break IMO
  native commands.
- Codex integration owns only its exact hook registration and declared skill
  symlinks; installation records prior projections so uninstall can restore them.
- The identity veil is a separate opt-in integration. It owns, per selected
  host, one PreToolUse gate registration and, by default, one SessionStart
  handle-announcement registration, plus two generated hooks, all keyed by
  their own command strings so third-party hooks coexist untouched. It uses a
  dedicated manifest; default `global install` neither requires nor enables it.
  The gate fails open, never logs argv or raw output, and its absence must not
  break IMO-native or normal host commands.

## Learning

- Agents may append raw signals and read reviewed active digests.
- Candidate preparation does not imply promotion.
- There is no autonomous active-digest or hard-rule promotion actor; background
  work stops at candidate preparation and explicit review owns promotion.
- Active digest and hard rule/skill changes require review, provenance, and a
  rollback path.
- Global learning excludes secrets and project-private facts.
- Hard rule/skill promotion resolves the canonical `source_root` from the
  global manifest. Package installs emit reviewed proposals instead of editing
  package caches or host projections.

## Runtime and verification

- Prompt-time context reads cached state only.
- Read-only commands treat missing runtime state as empty or missing.
- Tests that write runtime state must back it up and restore it.
- Durable behavioral guardrails should be schemas, metadata, or executable
  checks rather than prose alone.
