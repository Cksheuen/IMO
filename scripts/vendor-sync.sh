#!/bin/bash
# vendor-sync.sh - 同步 marketplace 缓存到 skills/vendor/
#
# 用法:
#   bash ~/.claude/scripts/vendor-sync.sh           # 对比差异（dry-run）
#   bash ~/.claude/scripts/vendor-sync.sh --apply   # 实际同步
#
# 来源: plugins/marketplaces/anthropic-agent-skills/skills/
# 目标: skills/vendor/

set -euo pipefail

BASE="$HOME/.claude"
MARKETPLACE="$BASE/plugins/marketplaces/anthropic-agent-skills/skills"
VENDOR="$BASE/skills/vendor"
MANIFEST="$VENDOR/.vendor-manifest.json"

MODE="dry-run"
if [ "${1:-}" = "--apply" ]; then
    MODE="apply"
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "错误: 未找到 jq，请先安装 jq 后再运行此脚本。"
    exit 1
fi

if [ ! -d "$MARKETPLACE" ]; then
    echo "错误: marketplace 缓存不存在: $MARKETPLACE"
    exit 1
fi

if [ ! -d "$VENDOR" ]; then
    echo "错误: vendor 目录不存在: $VENDOR"
    exit 1
fi

if [ ! -f "$MANIFEST" ]; then
    echo "错误: manifest 不存在: $MANIFEST"
    exit 1
fi

SKILLS=()
while IFS= read -r skill; do
    if [ -n "$skill" ]; then
        SKILLS+=("$skill")
    fi
done < <(jq -r '.skills | keys[]?' "$MANIFEST" 2>/dev/null)

if [ "${#SKILLS[@]}" -eq 0 ]; then
    echo "错误: manifest 中无注册 skill"
    exit 1
fi

has_diff=false
synced_skills=()

for skill in "${SKILLS[@]}"; do
    src="$MARKETPLACE/$skill"
    dst="$VENDOR/$skill"

    if [ ! -d "$src" ]; then
        echo "警告: marketplace 中不存在 $skill，跳过"
        continue
    fi

    if [ ! -d "$dst" ]; then
        diff_output="目标目录不存在: $dst"
    else
        diff_output=$(diff -rq "$src" "$dst" 2>/dev/null || true)
    fi

    if [ -n "$diff_output" ]; then
        has_diff=true
        echo "发现差异: $skill"
        echo "$diff_output" | sed 's/^/  /'

        if [ "$MODE" = "apply" ]; then
            echo "  正在同步..."
            rm -rf "$dst"
            cp -R "$src" "$dst"
            synced_skills+=("$skill")
            echo "  已同步"
        fi
    else
        echo "一致: $skill"
    fi
done

if [ "$MODE" = "apply" ] && [ "${#synced_skills[@]}" -gt 0 ]; then
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    for skill in "${synced_skills[@]}"; do
        tmp=$(mktemp)
        jq --arg s "$skill" --arg t "$timestamp" \
            '.skills[$s].synced_at = $t' "$MANIFEST" > "$tmp" && mv "$tmp" "$MANIFEST"
    done

    echo ""
    echo "已更新 manifest，同步时间: $timestamp"
fi

if [ "$has_diff" = false ]; then
    echo ""
    echo "所有 vendor skill 与 marketplace 缓存一致，无需同步。"
elif [ "$MODE" = "dry-run" ]; then
    echo ""
    echo "以上为差异预览。运行 'bash ~/.claude/scripts/vendor-sync.sh --apply' 执行同步。"
fi
