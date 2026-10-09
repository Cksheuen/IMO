# Identity Veil Rule

## Summary

When a task needs an organization-marking CLI (a command registered in the
veil policy under a neutral handle such as `org-cli-1`), or needs to read one
of its registered identity directories or files (a handle such as
`org-config-1`), never invoke or read it directly and never type its real
name or path. Route the call through the local identity veil by handle
(`./imo veil run --task <handle>` / `./imo veil read --task <handle>`). The
veil executes locally and returns only a graded, redacted envelope so the
model and its external provider never see the command fingerprint or raw
identity-bearing content.

Discover available handles with `./imo veil status`; it shows neutral handles
and purposes, not real names. The veil hides the identity channel; it does not
hide the task. Ask for the business outcome, call the handle, and work from
the sanitized result. When a result comes back `opaque`, the missing content
is intentional: report what was obtained and what stays hidden instead of
trying to extract it.

## Trigger

Apply this rule when any of these is true:

- the next shell command is, wraps, or pipes a CLI registered in the veil
  policy, or it references a registered identity path
- the task asks to inspect credentials, tokens, auth/config files, or session
  state belonging to an organization tool
- a file read (`Read`/`Grep`/`Glob`, `cat`, `grep`, editor open) targets a
  registered identity path
- tool output about to be quoted back contains internal hosts, emails,
  usernames, or token-shaped strings
- you are tempted to write the real internal CLI name or config path into a
  command, message, search, commit, or report

Do not apply it to ordinary repository commands or files that carry no
identity marker.

## Priority

```text
explicit user instruction
> repository hard rules / specs
> local neighboring patterns
> active IMO learning digest
> generic agent training defaults
```

A user explicitly asking to reveal a specific value locally overrides the
default; provider-side visibility cannot be overridden by this rule because
the veil only changes what enters model context.

## Required Local Evidence

Before using the veil, establish:

- the exact business result the task needs from the marked tool
- whether the host gate is installed: `./imo veil status`
- which level the last result used: `clear`, `sanitize`, or `opaque`
- the redaction names/counts or the opaque hash and byte count

Do not inspect the real command location, config directory, or credential
store "to understand the tool" outside the veil.

## Habits To Suppress

- running a registered organization CLI directly in a shell tool or by its
  real name instead of its `--task` handle
- reading identity config or credential files with `Read`, `cat`, `grep`, or
  an editor
- wrapping the marked command in `bash -lc`, `env`, `sudo`, or a script to
  slip it past the gate
- typing the marked command or its raw output into your own narration, a
  search, a commit message, or a report
- retrying the same direct call after the gate denies it
- treating an `opaque` envelope as a failure to route around with another tool
- pasting internal hosts, emails, or token-shaped strings into external tools
- logging or echoing the command's argv under a different label

## Implementation Behavior

1. Use the session announcement (`./imo veil context`, or the handles already
   announced at session start) and `./imo veil status` to resolve a handle;
   never guess, search, or read local source/policy for the real name. Call
   `./imo veil run --task <handle> -- <args>` or
   `./imo veil read --task <handle> [--rel <path>]`. When the gate blocks a
   direct call, follow its handle-only hint and retry that way without
   restating the blocked command or its arguments.
2. Learn a handled CLI's subcommands only through the veil:
   `./imo veil run --task <handle> -- --help`. The tool's own name is replaced
   by the handle, so help is safe to read; do not run the real binary to learn
   it.
3. Let the veil execute locally. Treat the returned envelope as the only
   command output:
   - `clear`: use the output normally.
   - `sanitize`: use the redacted text; refer to values by their
     `[REDACTED:...]` placeholders, never by reconstruction.
   - `opaque`: report exit code, byte/line counts, and the content hash only;
     do not request or attempt to reveal the bytes.
4. If the task genuinely requires opaque bytes (for example copying a
   credential into another local command), stop and ask the user to run that
   step locally; do not pull the secret into context.
5. Registering a real tool is a human, local action (`./imo veil register` in
   the user's own terminal); never ask the user to type the real name into the
   conversation or pass it as an agent-run argument. Real names, domains, and
   free-text organization words stay only in the local user policy; never add
   them to tracked framework source.
6. Verify behavior with `./imo veil selftest`; treat a missing runner or
   disabled policy as a reported state, not as permission to call directly.
7. Keep task artifacts, diffs, and messages free of the redacted substrings;
   the veil protects the transcript, and you must not reintroduce what it hid.

## Allowed Exceptions

- The user explicitly asks to see a concrete value and accepts it entering the
  local session; surface that it will be visible to the provider first.
- A non-registered, non-identity command may run directly; the gate allows it.
- Pure offline reasoning that references no identity-bearing data needs no
  veil.
- Local-only operations the user performs themselves outside the agent are
  outside the rule.

## Review Questions

- Did any marked command or identity file bypass the veil?
- Does the final work product contain raw internal hosts, emails, usernames,
  paths, or tokens the veil would have removed?
- Were `opaque` results respected rather than extracted by another route?
- After a gate denial, was the exact rewrite hint used instead of a retry?
- Was a genuinely needed new tool added to policy instead of handled ad hoc?

## Non-Goals

- The veil does not erase data the provider already recorded.
- It does not stop a user from deliberately pasting content.
- It does not cover MCP tool calls; those are a separate contract.
- It is not encryption, DLP, or an authorization system; it limits model and
  provider visibility, never the local machine's own access.
- It does not gate ordinary commands or slow unrelated work.
