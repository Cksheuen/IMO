# IMO

`.imo/` is the canonical source for IMO capabilities, stable runtime contracts,
learning policy, and the global CLI. Consumer repositories need no local IMO
installation; mutable state lives under `~/.imo/`.

## Start here

```bash
./imo --help
./imo budget audit
./imo defensive audit
./imo profile status
./imo learning list
./imo metrics status
./imo codex context --empty --stats
./imo verify
```

The root `./imo` command and compatibility surfaces under `scripts/` and
`skills/` are source-checkout entrypoints. `imo global install --apply` connects
Codex through one bounded hook and lazy skill symlinks. `imo init <project>` is
optional registration only and writes zero framework files into that project.

## Quality gates

- `./imo global status --json` — read-only state check.
- `./imo global doctor --json` — exits nonzero when unhealthy.
- `python3 .imo/product/scripts/check_tracked_references.py --require-tracked --json` — release gate.
- `./imo verify` — runs verification.

CI runs the strict tracked-reference checker, `verify`, and
`npm pack --dry-run`. `verify` emits lifecycle events to the normal project
runtime; all smoke fixture state uses a temporary runtime and never touches
source `.imo/.runtime`.

Full verification requires the pinned migrated-runtime dependencies. Follow
the virtual-environment setup in `UPDATE.md` on a new machine.

## Layout

- `KNOWLEDGE.md`: lazy-loaded router for stable decisions and contracts.
- `ARCHITECTURE.md`: source, runtime, and integration boundaries.
- `BOUNDARY.md`: ownership and safety invariants.
- `RUNBOOK.md`: compact acceptance commands.
- `UPDATE.md`: cross-device update and managed-file rules.
- `product/`: canonical scripts, rules, and skills.
- `learning/`: learning policy and schemas.
- `providers/`: optional external capability metadata.
- `runtime/`: stable contracts and shared runtime helpers.

Detailed knowledge is intentionally not injected on every prompt. The bounded
`imo codex context` block routes an agent to these files only when relevant.
