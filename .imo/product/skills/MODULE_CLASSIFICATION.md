# IMO Skill Module Classification

This file records the intended ownership class for current IMO skill modules.

The classification is a planning contract. A future task should convert it into
machine-readable module metadata and have `imo verify` check drift.

## Classification Types

| Type | Meaning |
| --- | --- |
| `native` | IMO-owned capability that belongs in `.imo/product/skills/*`. |
| `provider-backed` | IMO owns strategy/policy, but execution depends on an external provider or host environment. |
| `extension-candidate` | Useful capability, but not necessarily IMO core. May become an external extension later. |

## Native

| Module | Reason |
| --- | --- |
| `brainstorm` | Core requirement discovery and research workflow. |
| `architecture-health` | Core architecture assessment and governance capability. |
| `eat` | Core knowledge ingestion pipeline. |
| `freshness` | Core knowledge freshness maintenance. |
| `promote-notes` | Core promotion pipeline for reusable knowledge. |
| `lesson-review` | Core lesson review workflow. |
| `codex-feedback-review` | Core feedback ingestion for Codex execution lessons. |
| `locate` | Core code-location memory capability. |
| `shit` | Core structure simplification and context hygiene capability. |
| `cc-to-framework-migration` | Core framework migration scenario for IMO. |

## Provider-Backed

| Module | External dependency |
| --- | --- |
| `codex-cc-sync-check` | Claude/Codex global configuration environment. |
| `metrics-daily` | Claude metrics runtime. |
| `metrics-weekly` | Claude metrics runtime. |
| `dual-review-loop` | Claude Code and Codex review execution surfaces. |
| `multi-model-agent` | Model gateways such as LiteLLM and provider credentials/config. |
| `orchestrate` | Host agent execution, worktrees, and platform-specific delegation. |
| `promotion-mode` | External promotion scripts or global configuration. |

Provider-backed modules may stay in IMO when IMO owns the policy layer. Their
external execution dependencies must remain explicit.

## Extension Candidates

| Module | Reason |
| --- | --- |
| `pkg-dive` | General development utility; useful but not necessarily IMO core. |
| `functional-test-chain` | Test-design utility; useful as an optional capability. |

Extension candidates should not gain more IMO core dependencies without a task
that explains why they should become native.
