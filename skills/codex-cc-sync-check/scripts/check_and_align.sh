#!/bin/bash

set -euo pipefail

CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
CODEX_DIR="${CODEX_DIR:-$HOME/.codex}"
MANIFEST_PATH="${MANIFEST_PATH:-$CLAUDE_DIR/shared-knowledge/sync-manifest.json}"
CLAUDE_SKILLS_DIR="$CLAUDE_DIR/skills"
CODEX_SKILLS_DIR="$CODEX_DIR/skills"
CLAUDE_COMMANDS_DIR="$CLAUDE_DIR/commands"
CODEX_COMMANDS_DIR="$CODEX_DIR/commands"

require_tool() {
  local tool_name="$1"
  if ! command -v "$tool_name" >/dev/null 2>&1; then
    echo "missing required tool: $tool_name" >&2
    exit 1
  fi
}

require_tool jq

if [ ! -f "$MANIFEST_PATH" ]; then
  echo "missing manifest: $MANIFEST_PATH" >&2
  exit 1
fi

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/codex-cc-sync-check.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT

normalize_name() {
  local name="$1"
  name="${name%.md}"
  printf '%s\n' "$name"
}

write_json_array_file() {
  local jq_expr="$1"
  local output_file="$2"

  jq -r "$jq_expr | .[]?" "$MANIFEST_PATH" | sed '/^$/d' | sort -u > "$output_file"
}

write_skill_listing() {
  local base_dir="$1"
  local output_file="$2"
  local dangling_file="$3"

  : > "$output_file"

  if [ -n "$dangling_file" ]; then
    : > "$dangling_file"
  fi

  for path in "$base_dir"/*; do
    [ -e "$path" ] || [ -L "$path" ] || continue

    name="$(basename "$path")"
    if [ "$name" = ".system" ]; then
      continue
    fi

    if [ -L "$path" ] && [ ! -e "$path" ]; then
      if [ -n "$dangling_file" ]; then
        target="$(readlink "$path" 2>/dev/null || true)"
        jq -nc \
          --arg name "$name" \
          --arg path "$path" \
          --arg target "$target" \
          '{name:$name,path:$path,target:$target}' >> "$dangling_file"
        printf '\n' >> "$dangling_file"
      fi
      continue
    fi

    if [ -d "$path" ] && [ -f "$path/SKILL.md" ]; then
      printf '%s\n' "$name" >> "$output_file"
    fi
  done

  sort -u -o "$output_file" "$output_file"
}

write_command_listing() {
  local base_dir="$1"
  local output_file="$2"

  : > "$output_file"

  for path in "$base_dir"/*; do
    [ -e "$path" ] || [ -L "$path" ] || continue
    name="$(basename "$path")"
    normalize_name "$name" >> "$output_file"
  done

  sort -u -o "$output_file" "$output_file"
}

append_comm_drift() {
  local left_file="$1"
  local right_file="$2"
  local kind="$3"
  local source="$4"
  local target="$5"
  local output_file="$6"

  while IFS= read -r name; do
    [ -n "$name" ] || continue
    jq -nc \
      --arg kind "$kind" \
      --arg name "$name" \
      --arg source "$source" \
      --arg target "$target" \
      '{kind:$kind,name:$name,source:$source,target:$target}' >> "$output_file"
    printf '\n' >> "$output_file"
  done < <(comm -23 "$left_file" "$right_file")
}

manifest_excluded="$tmpdir/manifest_excluded.txt"
manifest_skills="$tmpdir/manifest_skills.txt"
manifest_commands="$tmpdir/manifest_commands.txt"
actual_claude_skills="$tmpdir/actual_claude_skills.txt"
actual_codex_skills="$tmpdir/actual_codex_skills.txt"
actual_claude_commands="$tmpdir/actual_claude_commands.txt"
actual_codex_commands="$tmpdir/actual_codex_commands.txt"
dangling_jsonl="$tmpdir/dangling.jsonl"
drift_jsonl="$tmpdir/drift.jsonl"

write_json_array_file '.excluded_skills // []' "$manifest_excluded"
write_json_array_file '.synced_skills // []' "$manifest_skills"
write_json_array_file '.synced_commands // [] | map(sub("\\.md$"; ""))' "$manifest_commands"
write_skill_listing "$CLAUDE_SKILLS_DIR" "$actual_claude_skills" ""
write_skill_listing "$CODEX_SKILLS_DIR" "$actual_codex_skills" "$dangling_jsonl"
write_command_listing "$CLAUDE_COMMANDS_DIR" "$actual_claude_commands"
write_command_listing "$CODEX_COMMANDS_DIR" "$actual_codex_commands"

if [ -s "$manifest_excluded" ]; then
  grep -vxF -f "$manifest_excluded" "$actual_claude_skills" > "$tmpdir/actual_claude_skills.filtered" || true
  grep -vxF -f "$manifest_excluded" "$actual_codex_skills" > "$tmpdir/actual_codex_skills.filtered" || true
else
  cp "$actual_claude_skills" "$tmpdir/actual_claude_skills.filtered"
  cp "$actual_codex_skills" "$tmpdir/actual_codex_skills.filtered"
fi

mv "$tmpdir/actual_claude_skills.filtered" "$actual_claude_skills"
mv "$tmpdir/actual_codex_skills.filtered" "$actual_codex_skills"

: > "$drift_jsonl"

append_comm_drift \
  "$actual_claude_skills" \
  "$manifest_skills" \
  "manifest_missing_skill" \
  "claude" \
  "manifest" \
  "$drift_jsonl"

append_comm_drift \
  "$manifest_skills" \
  "$actual_claude_skills" \
  "missing_skill_in_claude" \
  "manifest" \
  "claude" \
  "$drift_jsonl"

append_comm_drift \
  "$manifest_skills" \
  "$actual_codex_skills" \
  "missing_skill_in_codex" \
  "manifest" \
  "codex" \
  "$drift_jsonl"

append_comm_drift \
  "$actual_codex_skills" \
  "$manifest_skills" \
  "extra_skill_in_codex" \
  "codex" \
  "manifest" \
  "$drift_jsonl"

if [ -s "$manifest_commands" ]; then
  append_comm_drift \
    "$manifest_commands" \
    "$actual_claude_commands" \
    "missing_command_in_claude" \
    "manifest" \
    "claude" \
    "$drift_jsonl"

  append_comm_drift \
    "$manifest_commands" \
    "$actual_codex_commands" \
    "missing_command_in_codex" \
    "manifest" \
    "codex" \
    "$drift_jsonl"
fi

if [ -s "$drift_jsonl" ]; then
  drift_json="$(jq -s '.' "$drift_jsonl")"
else
  drift_json='[]'
fi

if [ -s "$dangling_jsonl" ]; then
  dangling_json="$(jq -s '.' "$dangling_jsonl")"
else
  dangling_json='[]'
fi

drift_count="$(jq 'length' <<<"$drift_json")"
dangling_count="$(jq 'length' <<<"$dangling_json")"

jq -n \
  --arg manifest_path "$MANIFEST_PATH" \
  --arg policy_statement "$(jq -r '.commands_divergence_policy.statement // ""' "$MANIFEST_PATH")" \
  --arg codex_only_purpose "$(jq -r '.commands_divergence_policy.codex_only_purpose // ""' "$MANIFEST_PATH")" \
  --argjson cc_only_patterns "$(jq '.commands_divergence_policy.cc_only_patterns // []' "$MANIFEST_PATH")" \
  --argjson excluded_skills "$(jq '.excluded_skills // []' "$MANIFEST_PATH")" \
  --argjson synced_skills "$(jq '.synced_skills // []' "$MANIFEST_PATH")" \
  --argjson synced_commands "$(jq '.synced_commands // []' "$MANIFEST_PATH")" \
  --argjson drift_items "$drift_json" \
  --argjson dangling_links "$dangling_json" \
  --argjson ok "$( [ "$drift_count" -eq 0 ] && [ "$dangling_count" -eq 0 ] && echo true || echo false )" \
  '{
    ok: $ok,
    drift_items: $drift_items,
    dangling_links: $dangling_links,
    manifest: {
      path: $manifest_path,
      excluded_skills: $excluded_skills,
      synced_skills: $synced_skills,
      synced_commands: $synced_commands
    },
    commands_divergence_policy: {
      statement: $policy_statement,
      cc_only_patterns: $cc_only_patterns,
      codex_only_purpose: $codex_only_purpose
    }
  }'
