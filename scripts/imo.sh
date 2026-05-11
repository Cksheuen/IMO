#!/usr/bin/env bash
set -euo pipefail

print_placeholder() {
cat <<'EOF'
imo: repo-local host ownership guardrail

Source of truth lives under `.imo/`.

Usage:
  scripts/imo.sh audit [claude|codex|all]

Notes:
  - `audit` is read-only and checks whether IMO reintroduces Trellis-owned
    Claude/Codex host-surface management.
  - This narrow entrypoint only covers the Trellis host-ownership boundary.
    It does not define the full IMO framework surface.
  - `sync` / `generate` are intentionally not exposed in this repo because
    Trellis remains the active owner of that host projection layer.
EOF
}

if [[ $# -eq 0 ]]; then
  print_placeholder
  exit 0
fi

case "${1}" in
  -h|--help|help)
    print_placeholder
    exit 0
    ;;
  audit)
    exec python3 .imo/product/scripts/audit_managed_ownership.py "${@:2}"
    ;;
  *)
    print_placeholder >&2
    printf '\nUnsupported imo command: %s\n' "${1}" >&2
    exit 64
    ;;
esac
