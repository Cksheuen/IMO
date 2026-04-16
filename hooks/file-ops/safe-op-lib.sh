#!/bin/bash
# safe-op-lib.sh - 文件操作安全层
# 被 safe-move.sh / extract-block.sh / remove-block.sh source
set -euo pipefail

detect_sed_variant() {
    if [[ "${OSTYPE:-}" == darwin* ]] || [[ "$(uname -s)" == "Darwin" ]]; then
        SED_INPLACE=(-i '')
    else
        SED_INPLACE=(-i)
    fi
}

validate_path_exists() {
    local path="$1"
    if [[ ! -e "$path" ]]; then
        echo "ERROR: Source not found: $path" >&2
        return 1
    fi
}

validate_no_collision() {
    local path="$1"
    if [[ -e "$path" ]]; then
        echo "ERROR: Target already exists: $path. Use --force to overwrite." >&2
        return 1
    fi
}

validate_no_traversal() {
    local path="$1"
    if [[ "$path" == *".."* ]]; then
        echo "ERROR: Path traversal detected: $path" >&2
        return 1
    fi
}

snapshot_create() {
    local operation_description="$1"
    if [[ -z "$(git status --porcelain)" ]]; then
        _SNAPSHOT_CLEAN=1
        return 0
    fi
    git stash push -m "safe-op: $operation_description $(date +%s)" >/dev/null
    _SNAPSHOT_CLEAN=0
}

snapshot_rollback() {
    if [[ "${_SNAPSHOT_CLEAN:-1}" -eq 1 ]]; then
        return 0
    fi
    git stash pop >/dev/null
}

verify_file_exists() {
    local path="$1"
    if [[ ! -s "$path" ]]; then
        echo "ERROR: Verification failed: $path is missing or empty" >&2
        return 1
    fi
}

log_info() {
    echo "[safe-op] $1"
}

log_error() {
    echo "[safe-op] ERROR: $1" >&2
}

detect_sed_variant

locate_block() {
    local file="$1"
    local start_pattern="$2"
    local end_pattern="${3:-}"
    local match_lines start_line total_lines base_line base_indent next_line next_indent current_line line_no
    local -a matches=()

    while IFS= read -r current_line; do
        matches+=("$current_line")
    done < <(grep -n -E -- "$start_pattern" "$file" || true)
    if [[ "${#matches[@]}" -eq 0 ]]; then
        echo "ERROR: No match for start pattern '$start_pattern' in $file" >&2
        return 1
    fi
    if [[ "${#matches[@]}" -gt 1 ]]; then
        match_lines="$(printf '%s\n' "${matches[@]}" | cut -d: -f1 | paste -sd, -)"
        echo "ERROR: Multiple matches for start pattern '$start_pattern' in $file. Matching line numbers: $match_lines" >&2
        return 1
    fi

    start_line="${matches[0]%%:*}"
    total_lines="$(wc -l < "$file" | tr -d ' ')"
    BLOCK_START="$start_line"

    if [[ -n "$end_pattern" ]]; then
        next_line="$(tail -n +"$((start_line + 1))" "$file" | grep -n -m1 -E -- "$end_pattern" | cut -d: -f1 || true)"
        if [[ -n "$next_line" ]]; then
            BLOCK_END=$((start_line + next_line - 1))
        else
            BLOCK_END="$total_lines"
        fi
        return 0
    fi

    base_line="$(sed -n "${start_line}p" "$file")"
    [[ "$base_line" =~ ^([[:space:]]*) ]] && base_indent="${BASH_REMATCH[1]}" || base_indent=""
    BLOCK_END="$total_lines"

    line_no=$((start_line + 1))
    while IFS= read -r current_line || [[ -n "$current_line" ]]; do
        if [[ -z "${current_line//[[:space:]]/}" ]]; then
            line_no=$((line_no + 1))
            continue
        fi
        [[ "$current_line" =~ ^([[:space:]]*) ]] && next_indent="${BASH_REMATCH[1]}" || next_indent=""
        if [[ "${#next_indent}" -le "${#base_indent}" ]]; then
            BLOCK_END=$((line_no - 1))
            break
        fi
        line_no=$((line_no + 1))
    done < <(tail -n +"$((start_line + 1))" "$file")
}
