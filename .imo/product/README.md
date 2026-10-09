# IMO Product Source

`.imo/product/` owns reusable scripts, rules, and skills.

- `scripts/`: canonical CLI implementations and contract checkers.
- `rules/`: compact behavior rules with machine-readable metadata.
- `skills/`: on-demand capability entrypoints and references.

Root `imo`, `scripts/`, and `skills/` are compatibility surfaces only. Host
agent configuration, external providers, and downloaded skills remain outside
this subtree unless explicitly adopted with clear ownership and verification.

See `../KNOWLEDGE.md` for the durable decision index and the nearest contract
file before changing a product surface.
