#!/bin/bash

set -euo pipefail

CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
CODEX_DIR="${CODEX_DIR:-$HOME/.codex}"
CLAUDE_AGENTS="$CLAUDE_DIR/shared-knowledge/AGENTS.md"
CODEX_OVERRIDE="$CODEX_DIR/AGENTS.override.md"
CODEX_AGENTS="$CODEX_DIR/AGENTS.md"
CLAUDE_SKILLS_DIR="$CLAUDE_DIR/skills"
CODEX_SKILLS_DIR="$CODEX_DIR/skills"
CODEX_COMMANDS_DIR="$CODEX_DIR/commands"
SYNC_SCRIPT="$CLAUDE_DIR/hooks/codex-sync/sync-to-codex.sh"

STATUS="aligned"
declare -a ACTIONS=()
declare -a CONFLICTS=()
declare -a CHECKS=()

mark_repaired() {
  if [ "$STATUS" = "aligned" ]; then
    STATUS="repaired"
  fi
}

record_conflict() {
  STATUS="conflicts"
  CONFLICTS+=("$1")
}

ensure_symlink() {
  local source="$1"
  local target="$2"
  local label="$3"

  if [ -L "$target" ] && [ "$(readlink "$target")" = "$source" ]; then
    CHECKS+=("$label: ok ($target -> $source)")
    return 0
  fi

  if [ -e "$target" ] && [ ! -L "$target" ]; then
    record_conflict "$label: target exists and is not a symlink: $target"
    return 1
  fi

  rm -f "$target"
  ln -s "$source" "$target"
  ACTIONS+=("$label: linked $target -> $source")
  mark_repaired
}

sync_agents() {
  if [ ! -f "$CLAUDE_AGENTS" ]; then
    if [ -x "$SYNC_SCRIPT" ]; then
      bash "$SYNC_SCRIPT" --force >/dev/null
      ACTIONS+=("rules: ran $SYNC_SCRIPT --force to generate $CLAUDE_AGENTS")
    fi
  fi

  if [ ! -f "$CLAUDE_AGENTS" ]; then
    record_conflict "rules: missing source AGENTS file: $CLAUDE_AGENTS"
    return
  fi

  if { [ ! -L "$CODEX_OVERRIDE" ] || [ "$(readlink "$CODEX_OVERRIDE" 2>/dev/null || true)" != "$CLAUDE_AGENTS" ]; } \
    || { [ ! -L "$CODEX_AGENTS" ] || [ "$(readlink "$CODEX_AGENTS" 2>/dev/null || true)" != "$CLAUDE_AGENTS" ]; }; then
    if [ -x "$SYNC_SCRIPT" ]; then
      bash "$SYNC_SCRIPT" --force >/dev/null
      ACTIONS+=("rules: ran $SYNC_SCRIPT --force to repair Codex AGENTS links")
    fi
  fi

  ensure_symlink "$CLAUDE_AGENTS" "$CODEX_OVERRIDE" "rules override"
  ensure_symlink "$CLAUDE_AGENTS" "$CODEX_AGENTS" "rules legacy"
}

generate_command_stub() {
  local skill_md="$1"
  local target="$2"
  local label="$3"

  local title trigger_line tmp_file stub_size
  # 优先从 frontmatter 提取 name 字段
  title=$(awk '
    BEGIN { in_frontmatter=0 }
    /^---$/ {
      if (!in_frontmatter) { in_frontmatter=1; next }
      exit
    }
    in_frontmatter && /^name:/ {
      sub(/^name:[[:space:]]*/, "")
      sub(/^[\"\047]/, "")
      sub(/[\"\047]$/, "")
      print
      exit
    }
  ' "$skill_md")
  if [ -z "$title" ]; then
    # fallback: 跳过 frontmatter 后取第一个 # heading
    title=$(sed '1,/^---$/{ /^---$/!d; }; /^---$/d' "$skill_md" | grep -m1 '^#' | sed 's/^#\+[[:space:]]*//')
  fi
  if [ -z "$title" ]; then
    title=$(basename "$(dirname "$skill_md")")
  fi

  # 提取 body（跳过 frontmatter）
  local body
  body=$(awk 'BEGIN{skip=0; count=0} /^---$/{count++; if(count<=2){skip=1-skip; next}} !skip{print}' "$skill_md")

  # 在 body 中查找触发条件/何时使用 heading 后的第一行有意义内容
  trigger_line=$(echo "$body" | awk '
    /^##[[:space:]]+(触发条件|何时使用|When to [Uu]se|Trigger)/ { found=1; next }
    found && /^##/ { exit }
    found && /^[[:space:]]*$/ { next }
    found && /^[>|`]/ { next }
    found && /^[-*+][[:space:]]/ { sub(/^[-*+][[:space:]]+/, ""); print; exit }
    found { print; exit }
  ' | head -c 150)

  # fallback: 从 frontmatter 提取 description 字段
  if [ -z "$trigger_line" ]; then
    trigger_line=$(awk '
      BEGIN { in_frontmatter=0 }
      /^---$/ {
        if (!in_frontmatter) { in_frontmatter=1; next }
        exit
      }
      in_frontmatter && /^description:/ {
        sub(/^description:[[:space:]]*/, "")
        sub(/^[\"\047]/, "")
        sub(/[\"\047]$/, "")
        print
        exit
      }
    ' "$skill_md" | head -c 150)
  fi

  if [ -e "$target" ] && [ ! -L "$target" ] && ! grep -Fqx "Full spec: $skill_md" "$target" 2>/dev/null; then
    record_conflict "$label: target exists and is not a managed stub: $target"
    return 1
  fi

  tmp_file="$(mktemp "${TMPDIR:-/tmp}/codex-command-stub.XXXXXX")"
  {
    echo "$title"
    echo ""
    if [ -n "$trigger_line" ]; then
      echo "Trigger: $trigger_line"
      echo ""
    fi
    echo "---"
    echo "Full spec: $skill_md"
  } > "$tmp_file"

  if [ -f "$target" ] && [ ! -L "$target" ] && cmp -s "$tmp_file" "$target"; then
    CHECKS+=("$label: ok ($target)")
    rm -f "$tmp_file"
    return 0
  fi

  rm -f "$target"
  mv "$tmp_file" "$target"

  stub_size=$(wc -c < "$target" | tr -d ' ')
  ACTIONS+=("$label: generated stub ($stub_size bytes) at $target")
  mark_repaired
}

sync_skills() {
  local linked_count=0
  local command_count=0
  local source_skill

  mkdir -p "$CODEX_SKILLS_DIR"
  mkdir -p "$CODEX_COMMANDS_DIR"

  for source_skill in "$CLAUDE_SKILLS_DIR"/*; do
    local skill_name target_skill target_command

    [ -d "$source_skill" ] || continue
    [ -f "$source_skill/SKILL.md" ] || continue

    skill_name="$(basename "$source_skill")"
    target_skill="$CODEX_SKILLS_DIR/$skill_name"
    target_command="$CODEX_COMMANDS_DIR/$skill_name.md"

    if ensure_symlink "$source_skill" "$target_skill" "skill $skill_name"; then
      linked_count=$((linked_count + 1))
    fi

    if [ -f "$target_command" ] && [ -L "$target_command" ]; then
      rm -f "$target_command"
    fi
    if generate_command_stub "$source_skill/SKILL.md" "$target_command" "command $skill_name"; then
      command_count=$((command_count + 1))
    fi
  done

  CHECKS+=("skills: checked $linked_count custom skill links")
  CHECKS+=("commands: checked $command_count direct skill wrappers")
}

sync_agents
sync_skills

echo "status: $STATUS"
echo "checks:"
for item in "${CHECKS[@]}"; do
  echo "- $item"
done

echo "actions:"
if [ "${#ACTIONS[@]}" -eq 0 ]; then
  echo "- none"
else
  for item in "${ACTIONS[@]}"; do
    echo "- $item"
  done
fi

echo "conflicts:"
if [ "${#CONFLICTS[@]}" -eq 0 ]; then
  echo "- none"
else
  for item in "${CONFLICTS[@]}"; do
    echo "- $item"
  done
fi

echo "notes:"
echo "- skill list changes only appear in newly started Codex sessions; existing sessions keep the prompt snapshot they started with"
