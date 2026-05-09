#!/usr/bin/env bash
set -euo pipefail

print_placeholder() {
cat <<'EOF'
imo: repo-local managed output entry

Source of truth lives under `.imo/`.

Usage:
  scripts/imo.sh sync [claude|codex|all] [--force]
  scripts/imo.sh generate [claude|codex|all] [--force]

Notes:
  - `generate` is currently an alias of `sync`.
  - This Phase 2 surface only manages the minimal adapter closed loop
    (agents, hooks, and shared config fragments).
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
  sync|generate)
    exec python3 .imo/product/scripts/sync_managed_outputs.py "$@"
    ;;
  *)
    print_placeholder >&2
    printf '\nUnsupported imo command: %s\n' "${1}" >&2
    exit 64
    ;;
esac
