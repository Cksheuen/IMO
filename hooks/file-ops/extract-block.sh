#!/bin/bash
# extract-block.sh - 基于内容锚定的代码块提取
# Usage: extract-block.sh [--dry-run] <file> <start-pattern> [end-pattern] <dst>
# Examples:
#   extract-block.sh sample.ts "^export function foo" "^export" extracted.ts
#   extract-block.sh sample.py "^class Foo" extracted.py
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/safe-op-lib.sh"

DRY_RUN=0

usage() {
    echo "Usage: extract-block.sh [--dry-run] <file> <start-pattern> [end-pattern] <dst>" >&2
    exit 1
}

on_error() {
    trap - ERR
    snapshot_rollback || true
    log_error "Extract failed: ${FILE:-unknown}:${BLOCK_START:-?}-${BLOCK_END:-?} -> ${DST:-unknown}. Check the previous error and retry."
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

if [[ $# -eq 4 ]]; then
    FILE="$1"
    START_PATTERN="$2"
    END_PATTERN="$3"
    DST="$4"
elif [[ $# -eq 3 ]]; then
    FILE="$1"
    START_PATTERN="$2"
    END_PATTERN=""
    DST="$3"
else
    usage
fi

validate_path_exists "$FILE"
validate_no_traversal "$FILE"
validate_no_traversal "$DST"
validate_no_collision "$DST"
locate_block "$FILE" "$START_PATTERN" "$END_PATTERN"

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: Would extract lines $BLOCK_START-$BLOCK_END from $FILE to $DST"
    exit 0
fi

snapshot_create "extract $FILE:$BLOCK_START-$BLOCK_END -> $DST"
mkdir -p "$(dirname "$DST")"
sed -n "${BLOCK_START},${BLOCK_END}p" "$FILE" > "$DST"
verify_file_exists "$DST"
log_info "Extracted: $FILE:$BLOCK_START-$BLOCK_END -> $DST"
