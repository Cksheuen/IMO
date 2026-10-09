# Identity Veil Runtime Contract

`runtime/identity-veil/` defines the stable contract for the local identity
black box. It keeps organization-marking CLI calls and identity files out of
model context when an agent works against an external provider.

## Purpose

Organization CLIs, their config directories, and their output carry identity
markers: real command names, arguments, internal hostnames, usernames,
emails, endpoints, and credentials. When an agent runs them directly, all of
that enters the prompt transcript and is recorded by the model provider.

The veil executes the call locally and returns a graded envelope addressed by
a neutral handle. The model never receives the real command name, path,
working directory, or opaque output.

## Source Privacy Boundary

The tracked framework ships the **mechanism only**. It contains no real
organization command names, hosts, or domains:

- `identity_veil.py` built-in command and path maps are empty.
- Built-in redaction patterns are organization-independent (private keys,
  JWTs, bearer tokens, cloud access keys, generic email, plus the local
  user/home/host).
- The real mapping (for example a specific internal CLI) lives only in the
  user policy under `~/.imo/`, which is never committed or projected.

This keeps the public source repository free of organization identifiers.

## Handles

Each registered command and path has a stable, neutral alias:

```text
real basename/prefix (local policy only)
        │  resolved inside the veil
        ▼
neutral handle (org-cli-1 / org-config-1)
        │  the only reference the model sees
        ▼
./imo veil run --task org-cli-1 [-- <args>]
./imo veil read --task org-config-1 [--rel <relative>]
```

`./imo veil status` lists handles, action levels, and neutral descriptions
only. `status --reveal` is a human-only view that adds real names and
prefixes. A gate denial and the run/read envelopes reference the handle,
never the real identifier.

Calling a registered command by its real name through `veil run`, or reading
a registered path directly, is refused with a handle-only hint. A direct
un-gated tool call is already in the caller's transcript and cannot be
recalled; the rule therefore directs handle-first use, so identity is absent
from steady-state calls.

A registered command's own name and a registered path's own directory name are
automatically redacted in every output and replaced by the handle, so a model
can learn the tool's subcommands via `run --task <handle> -- --help` without
seeing the real name. Free-text organization words inside a tool's own output
(for example a self-description) are not generically detectable; they are
calibrated per tool through user-policy `patterns`, with `opaque` as the
conservative fallback.

## Discovery

The model must not have to guess a real name to learn that a capability exists:

- `./imo veil context` emits a compact, model-safe announcement: active
  status, every neutral handle with its kind, action, and neutral purpose, and
  the `run`/`read`/`--help` usage. It contains no real names or paths.
- On install, that announcement is also wired to a `SessionStart` hook on each
  host, so a fresh session knows the handles before it plans any command and
  does not need to emit a real name first. `--gate-only` installs just the
  gate without the announcement.
- `./imo veil status` is the same capability list on demand; `--reveal` is the
  human-only view with real mappings.

## Planes

```text
session start
    ▼
SessionStart announcement (./imo veil context): neutral handles + usage
    │
agent plans with handles only
    │  direct call (denied by the gate; handle-only rewrite hint)
    ▼
PreToolUse host gate (./imo veil gate, stdin hook payload)
    │  matched command or identity path
    ▼
identity_veil.py (local handle resolution, execution, redaction)
    │  graded JSON envelope, no argv, no path, no cwd, self-names replaced
    ▼
agent receives sanitize | opaque result tagged by handle
```

## Graded Results

| Level | Meaning | Model-visible fields |
| --- | --- | --- |
| `clear` | no pattern matched; a generic command executed through the veil | exit code, output |
| `sanitize` | output matched replace-level patterns | exit code, redacted output, redaction names and counts |
| `opaque` | a high-sensitivity pattern matched or the policy forces it | exit code, byte/line counts, sha256, duration |

The envelope never contains the executed argv, working directory, real path,
or matched raw content. Escalation is one-way: any opaque pattern upgrades the
whole result from `sanitize` to `opaque`.

## Source And State Boundary

Tracked source:

- `.imo/runtime/identity-veil/CONTRACT.md`
- `.imo/runtime/identity-veil/schema.json`
- `.imo/product/scripts/identity_veil.py`
- `.imo/product/scripts/check_identity_veil_contracts.py`
- the identity-veil smoke wired into `./imo verify`

Global user-scoped runtime state:

```text
~/.imo/runtime/identity-veil/policy.json
~/.imo/hooks/veil-gate.sh
~/.imo/hooks/veil-context.sh
~/.imo/install/identity-veil/manifest.json
```

The user policy is the only extension point for real commands, paths, and
internal-host/name patterns; `veil register` writes it interactively and
`veil policy init` writes a template with neutral `example-*` placeholders.
Generated state is rebuildable and is never the source of truth.

## Command Contract

```bash
./imo veil gate                                   # hook entrypoint; PreToolUse JSON on stdin
./imo veil context                                # model-safe handle announcement (SessionStart)
./imo veil register                               # interactive local registration (human terminal only)
./imo veil run --task <handle> [-- <args>]        # registered command by handle
./imo veil run -- <generic command> [args...]     # generic command, still redacted
./imo veil read --task <handle> [--rel <path>]    # registered path by handle
./imo veil read <generic-path>                    # generic file, still redacted
./imo veil check --command <text>                 # static command-string classification
./imo veil check --path <path>                    # static path classification
./imo veil status [--json] [--reveal]             # handles, policy, host state
./imo veil policy path|init|show
./imo veil selftest
./imo veil install [--apply] [--gate-only] [--host both|claude|codex]
./imo veil uninstall [--apply] [--host both|claude|codex]
```

Rules:

- `gate`, `context`, `check`, `status`, and `policy path` never write runtime
  state.
- `register` is interactive and TTY-only; the real name is typed into the
  local terminal (for example `! ./imo veil register` inside an agent prompt),
  never passed as an argument, so it does not enter an agent conversation or a
  process listing. It assigns the next `org-cli-N`/`org-config-N` handle.
- Only `install --apply` and `uninstall --apply` mutate host settings.
- Registered commands execute only via `--task`; `run` refuses their real
  basename. Generic `run -- <cmd>` still applies the redaction pipeline.
- `read --task` confines relative paths to the handle directory and refuses
  scope escape.

## Host Gate Protocol

The gate speaks the PreToolUse hook protocol shared by Claude Code and the
local Codex fork:

- stdin carries `hook_event_name`, `tool_name`, and `tool_input`.
- Tool mapping: `Bash` / `shell` / `local_shell` use `tool_input.command`;
  `Read`, `Grep`, `Glob` use `tool_input.file_path` or `tool_input.path`.
- Allow: exit `0` with no output.
- Deny: exit `2` with a non-empty stderr handle-only rewrite hint. The
  original call is blocked; the agent retries with `--task`.
- Unknown tools and non-PreToolUse events allow.

Matchers are intentionally wide (`Bash|Read|Grep|Glob`, respectively
`shell|local_shell|Read|Grep|Glob`); all classification lives in
`identity_veil.py`. The gate fails open when the runner is missing or input
is unreadable, and never logs argv or content.

## Installation Posture

The veil is strictly opt-in and is not part of `./imo global install`:

- `./imo veil install --apply` generates `veil-gate.sh` and, unless
  `--gate-only` is given, `veil-context.sh`, and registers per selected host
  one `PreToolUse` gate and one `SessionStart` announcement.
- Registrations are keyed by their own command string, so third-party hooks
  coexist and are never rewritten.
- A dedicated manifest under `~/.imo/install/identity-veil/` records both hook
  hashes and every host registration; uninstall removes only IMO veil entries.
- Dry run performs the same conflict and shape preflight without writes.

## Privacy And Observability

- The veil never logs argv, file contents, matched substrings, or raw output.
- `register` reads the real name from the TTY, never from argv, so it is
  absent from shell history, process listings, and the agent transcript.
- Telemetry may record only command family (`veil`), result level, exit class,
  byte counts, and durations.

## Non-Goals

- It does not erase data a provider already recorded, including an already
  emitted direct tool call; handle-first discovery is what prevents new markers.
- It does not generically detect organization words embedded in a tool's
  free-text output; those are calibrated through local patterns or `opaque`.
- It does not stop a user from pasting content manually.
- It does not hide the mapping from someone reading local source or policy; it
  hides identity from the model transcript and provider.
- It does not cover MCP tool calls in this version; those need a separate
  contract.
- It is not encryption, DLP, or authorization; it limits model/provider
  visibility, never the local machine's own access.
