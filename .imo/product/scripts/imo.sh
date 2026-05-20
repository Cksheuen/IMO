#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

print_placeholder() {
cat <<'EOF'
imo: repo-local host ownership guardrail

Source of truth lives under `.imo/`.

Usage:
  scripts/imo.sh audit [claude|codex|all]
  scripts/imo.sh verify

Notes:
  - `audit` is read-only and checks whether IMO reintroduces Trellis-owned
    Claude/Codex host-surface management.
  - `verify` runs the current read-only IMO guardrail, wrapper, and runtime
    compatibility checks.
  - IMO does not proxy Trellis by default. Use Trellis directly for Trellis
    task flow, and use IMO directly for IMO-owned capabilities and learning.
  - External frameworks, plugins, and skills stay outside `.imo/product/*` by
    default. Optional provider integration is an advanced path.
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
    exec python3 "$REPO_ROOT/.imo/product/scripts/audit_managed_ownership.py" "${@:2}"
    ;;
  verify)
    exec python3 "$REPO_ROOT/.imo/product/scripts/verify.py" "${@:2}"
    ;;
  *)
    print_placeholder >&2
    printf '\nUnsupported imo command: %s\n' "${1}" >&2
    exit 64
    ;;
esac
