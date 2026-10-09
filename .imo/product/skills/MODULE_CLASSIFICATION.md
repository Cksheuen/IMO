# IMO Skill Classification

The machine-readable source is `modules.json`; `./imo verify` validates it.

| Class | Meaning |
| --- | --- |
| `native` | IMO owns the capability and implementation policy. |
| `provider-backed` | IMO owns policy; execution depends on an external host, runtime, or credentials. |
| `extension-candidate` | Useful optional capability that should not gain core dependencies without explicit adoption. |

Every module declares an id, owner surface, lifecycle, enabled state,
integration modes, external dependencies, and learning access. Provider-backed
modules must keep dependencies explicit and degrade cleanly when unavailable.

Do not duplicate the module list here. Read `modules.json` only when changing
ownership, lifecycle, provider requirements, or verification.
