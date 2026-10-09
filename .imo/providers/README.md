# IMO Providers

Providers describe optional external capabilities without absorbing their
source or routing normal usage through IMO.

- Discovery is read-only.
- Invocation is disabled by default.
- Adoption requires explicit side effects, ownership, risk, and safe modes.
- Optional absence is `not_installed`, not an IMO failure.
- Provider failures remain isolated from IMO-native commands.

`registry.json` declares provider metadata. `root_surfaces.json` classifies
tracked compatibility and external surfaces. Both are checked by
`./imo verify`.
