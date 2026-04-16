#!/bin/bash
# remove-block.sh - 基于内容锚定的代码块删除
# Usage: remove-block.sh [--dry-run] <file> <start-pattern> [end-pattern]
# Examples:
#   remove-block.sh sample.ts "^export function foo" "^export"
#   remove-block.sh sample.py "^class Foo"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/safe-op-lib.sh"

DRY_RUN=0

usage() {
    echo "Usage: remove-block.sh [--dry-run] <file> <start-pattern> [end-pattern]" >&2
    exit 1
}

on_error() {
    trap - ERR
    snapshot_rollback || true
    log_error "Remove failed: ${FILE:-unknown}:${BLOCK_START:-?}-${BLOCK_END:-?}. Check the previous error and retry."
    exit 1
}

trap on_error ERR

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --help|-h) usage ;;
        --*) log_error "Unknown option: $1"; usage ;;
        *) break ;;
    esac
    shift
done

if [[ $# -eq 3 ]]; then
    FILE="$1"
    START_PATTERN="$2"
    END_PATTERN="$3"
elif [[ $# -eq 2 ]]; then
    FILE="$1"
    START_PATTERN="$2"
    END_PATTERN=""
else
    usage
fi

validate_path_exists "$FILE"
validate_no_traversal "$FILE"
locate_block "$FILE" "$START_PATTERN" "$END_PATTERN"

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: Would remove lines $BLOCK_START-$BLOCK_END from $FILE"
    exit 0
fi

snapshot_create "remove $FILE:$BLOCK_START-$BLOCK_END"
sed "${SED_INPLACE[@]}" "${BLOCK_START},${BLOCK_END}d" "$FILE"
[[ -e "$FILE" ]] || { log_error "Verification failed: $FILE is missing after removal"; exit 1; }
log_info "Removed: $FILE:$BLOCK_START-$BLOCK_END"
