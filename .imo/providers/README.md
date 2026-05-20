# IMO Providers

Providers are optional integrations. They are not the default path for Trellis
or IMO usage.

## Purpose

The provider layer documents how IMO may discover or call external capabilities
without absorbing their source code and without requiring users to route normal
Trellis work through IMO.

## Default Rule

- Trellis remains directly usable as Trellis.
- External plugins and downloaded skills remain directly usable from their host
  environments.
- IMO remains directly usable through IMO commands and IMO-owned skills.
- Provider integration is added only when a task needs cross-plane discovery,
  health checks, optional callbacks, or advanced orchestration.

## Provider Categories

| Category | Examples | Default relationship |
| --- | --- | --- |
| Task provider | Trellis | Independent; optional discovery/callback only |
| Plugin provider | Claude Code plugins, Codex plugins | External; discoverable if needed |
| Skill provider | marketplace skills, downloaded skill packs | External; not vendored into IMO |
| Runtime provider | LiteLLM, model gateways, local runtimes | External execution substrate |
| IMO native provider | `.imo/product/*` capabilities | IMO-owned |

## Discovery Model

Provider discovery must be read-only.

Expected discovery inputs may include:

- known project-local directories, such as `.trellis/` or `.agents/skills/`
- known user-level directories, such as `~/.claude/plugins/`,
  `~/.claude/skills/`, or `~/.codex/skills/`
- provider manifests, when a provider exposes one
- executable entrypoints with stable command contracts

Discovery output is a capability inventory, not generated source files.

## Invocation Model

Provider invocation is an advanced mode.

It requires a capability contract that states:

- provider id
- capability id
- entrypoint
- required inputs
- expected outputs
- side effects
- risk level
- safe modes such as `dry_run`, `observe`, or `apply`
- ownership of files it may read or write

IMO should refuse ambiguous calls when ownership or side effects are unclear.

## Failure Model

Provider integration must degrade cleanly:

- missing provider -> unavailable capability
- broken provider -> health warning
- invocation failure -> isolated failure record
- provider update drift -> adapter update task, not IMO core corruption

Provider failures must not break IMO native capabilities or Trellis native task
flow.

## Health Severity

Provider health should distinguish optional absence from real failure:

| Severity | Meaning |
| --- | --- |
| `not_installed` | Provider is optional and not present. |
| `unavailable` | Provider is expected by current config but cannot be used. |
| `degraded` | Provider is present but some capabilities are unavailable. |
| `ok` | Provider discovery is healthy. |

`not_installed` must not fail IMO native verification.

## Current Scope

This directory is contract-only. It does not yet implement provider discovery,
callback handling, or invocation.

The first implementation step should be read-only discovery and health
reporting. Provider execution should remain out of scope until discovery and
side-effect metadata are stable.
