#!/bin/bash
# safe-move.sh - 安全文件移动
# Usage: safe-move.sh [--dry-run] [--force] <src> <dst>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/safe-op-lib.sh"

DRY_RUN=0
FORCE=0

usage() {
    echo "Usage: safe-move.sh [--dry-run] [--force] <src> <dst>" >&2
    exit 1
}

on_error() {
    trap - ERR
    snapshot_rollback || true
    log_error "Move failed: ${SRC:-unknown} -> ${DST:-unknown}. Check the previous error and retry."
    exit 1
}

trap on_error ERR

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --force) FORCE=1 ;;
        --help|-h) usage ;;
        --*) log_error "Unknown option: $1"; usage ;;
        *) break ;;
    esac
    shift
done

[[ $# -eq 2 ]] || usage
SRC="$1"
DST="$2"

validate_path_exists "$SRC"
validate_no_traversal "$SRC"
validate_no_traversal "$DST"
if [[ "$FORCE" -eq 0 ]]; then
    validate_no_collision "$DST"
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: Would move $SRC -> $DST"
    exit 0
fi

snapshot_create "move $SRC -> $DST"
mkdir -p "$(dirname "$DST")"
mv "$SRC" "$DST"
verify_file_exists "$DST"
log_info "Moved: $SRC -> $DST"
