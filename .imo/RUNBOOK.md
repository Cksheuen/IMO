# IMO Acceptance Runbook

Run from the repository root:

```bash
./imo --help
./imo budget audit --json
./imo codex context --empty --stats
./imo profile status
./imo learning list
./imo metrics status
./imo defensive audit --json
./imo veil selftest
./imo veil status
./imo global doctor --json
python3 .imo/product/scripts/check_tracked_references.py --require-tracked --json
./imo verify
```

Acceptance criteria:

- root wrappers delegate to `.imo/product/**`;
- context modes stay within `1200 / 2200 / 4000` characters;
- status and audit commands do not create missing runtime state;
- global install registers one Codex hook and lazy canonical skill symlinks;
- `global doctor` reports six explicit states and exits nonzero when unhealthy;
- dry-run global install preflights conflicts without writes;
- project init/update write zero framework files into consumer repositories;
- legacy uninstall removes only hash-matched managed files and preserves runtime;
- provider absence does not fail IMO-native verification;
- the identity veil selftest passes; `gate` denies marked commands/files with
  exit 2 and fails open on unknown payloads; `run`/`read` envelopes never
  contain argv or opaque bytes; veil install/uninstall preserves third-party
  hooks;
- `verify_start`, per-check start/end, and `verify_end` events are paired;
- write-path smokes use a temporary runtime and leave source `.imo/.runtime`
  unchanged.

Use `./imo global install` before `--apply`. Use `imo uninstall <target>
--dry-run` before cleaning an old direct-run profile from another repository.
