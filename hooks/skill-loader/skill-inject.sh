#!/bin/bash
# skill-inject.sh - Skills 按需加载注入器
#
# 触发时机: UserPromptSubmit
# 功能: 检测用户输入中的关键词，注入轻量 skill 推荐
#
# 基于 Claude Code 架构:
# - Skills 应按需加载，避免 prefix 膨胀
# - Hook 只做轻量路由提示，不注入 SKILL.md 正文
# - 保持 prefix 稳定性以最大化缓存命中

set -euo pipefail

OUTPUT="{}"
METRICS_STATUS="ok"
METRICS_LIB="$HOME/.claude/hooks/metrics/emit.sh"

# 读取完整 stdin JSON。
# UserPromptSubmit hook 的 payload 可能是多行 JSON，单行 read 会截断并导致 jq 解析失败。
stdin_json=$(cat)

session_id=$(printf '%s' "$stdin_json" | jq -r '.session_id // .sessionId // ""')
export METRICS_SESSION_ID="$session_id"
export METRICS_SCOPE="global"

if [ -f "$METRICS_LIB" ]; then
    # shellcheck disable=SC1090
    . "$METRICS_LIB"
fi

metrics_start_ms=0
if command -v metrics_now_ms >/dev/null 2>&1; then
    metrics_start_ms=$(metrics_now_ms)
fi

metrics_finalize() {
    local exit_code=$?
    local duration_ms=""

    if [ "$exit_code" -ne 0 ]; then
        METRICS_STATUS="error"
    fi

    if command -v metrics_now_ms >/dev/null 2>&1 && [ "${metrics_start_ms:-0}" -gt 0 ] 2>/dev/null; then
        duration_ms=$(( $(metrics_now_ms) - metrics_start_ms ))
    fi

    if command -v metrics_emit >/dev/null 2>&1; then
        metrics_emit "skill-inject" "UserPromptSubmit" "hook_run" "$METRICS_STATUS" "$duration_ms"
    fi
}

trap metrics_finalize EXIT

if [ -z "$stdin_json" ]; then
    echo "$OUTPUT"
    exit 0
fi

# 提取用户输入
user_prompt=$(printf '%s' "$stdin_json" | jq -r '.prompt // ""' | tr '[:upper:]' '[:lower:]')

# 定义关键词到 skill 的映射
# 格式: "关键词:skill名称:推荐理由"
KEYWORD_SKILL_MAP=(
    "architecture-health:architecture-health:架构健康度仪表盘。分析项目的架构适应度指"
    "brainstorm|调研|需求发现:brainstorm:问题偏调研、选型或需求收敛"
    "cc-to-framework-migration:cc-to-framework-migration:Claude Code 配置到 Lang"
    "codex-cc-sync-check:codex-cc-sync-check:检查 Codex 是否与 Claude "
    "design|设计|ui设计:design:任务目标是设计界面或原型"
    "docx|word文档|word文件:docx:涉及 Word 文档生成或编辑"
    "dual-review-loop:dual-review-loop:CC + Codex 双重审查循环。用户"
    "eat|吸收|知识吸收:eat:需要消化外部资料并沉淀知识"
    "freeze|冻结|冷存储:freeze:需要把不常用知识移入冷存储"
    "freshness|时效|过期检查:freshness:需要检查引用或知识时效性"
    "functional-test-chain:functional-test-chain:为可测试的项目生成功能测试原子操作、可复"
    "定位|索引|代码地图:locate:需要记录代码位置或建立索引"
    "metrics-daily:metrics-daily:将本地 CC/Codex hook 指标"
    "metrics-weekly:metrics-weekly:生成覆盖最近 7 天 hook、skil"
    "multi-model|多模型|模型切换:multi-model-agent:需要配置多模型协作"
    "orchestrate|编排|多代理:orchestrate:任务需要拆解、委派或并发协作"
    "pdf|pdf文件|pdf文档:pdf:涉及 PDF 读写或转换"
    "pkg-dive|包源码|依赖分析:pkg-dive:需要分析依赖包源码"
    "pptx|ppt|幻灯片|演示文稿:pptx:涉及幻灯片解析、生成或修改"
    "promote|晋升|笔记晋升:promote-notes:需要把 notes 晋升为规则或技能"
    "promotion-mode:promotion-mode:用于管理 Promotion Loop "
    "shit|精简|结构优化:shit:需要清理冗余结构或压缩上下文资产"
    "skill.*创建|新建.*skill|skill-creator:skill-creator:需要创建或优化 skill"
    "team-builder|团队组建|招聘:team-builder:需要设计或优化 agent 团队"
    "thaw|解冻|恢复:thaw:需要从冷存储恢复知识"
    "voice|口吻|个人风格:voice:输出需要匹配个人写作风格"
    "xmind:xmind:当用户要求\"解析 xmind\"、\"打开思"
)

# 检测匹配的 skills
matched_entries=()
for mapping in "${KEYWORD_SKILL_MAP[@]}"; do
    patterns=${mapping%%:*}
    remainder=${mapping#*:}
    skill=${remainder%%:*}
    reason=${remainder#*:}

    # 检查任意模式匹配
    IFS='|' read -ra pattern_array <<< "$patterns"
    for pattern in "${pattern_array[@]}"; do
        if echo "$user_prompt" | grep -qE "$pattern"; then
            matched_entries+=("$skill:$reason")
            break
        fi
    done
done

# 去重并限制数量，避免注入过多路由提示
unique_entries=()
seen_skills=" "
if [ "${#matched_entries[@]}" -eq 0 ]; then
    echo "$OUTPUT"
    exit 0
fi

for entry in "${matched_entries[@]}"; do
    skill=${entry%%:*}
    if [[ "$seen_skills" == *" $skill "* ]]; then
        continue
    fi

    unique_entries+=("$entry")
    seen_skills+="$skill "

    if [ "${#unique_entries[@]}" -ge 3 ]; then
        break
    fi
done

# 构建轻量推荐文案
recommendation=""
if [ "${#unique_entries[@]}" -gt 0 ]; then
    recommendation="Possible skills to consider:\n"
    for entry in "${unique_entries[@]}"; do
        skill=${entry%%:*}
        reason=${entry#*:}
        recommendation+="- $skill: $reason\n"
    done

    recommendation+="Use this as routing guidance only. Read or invoke the matching skill when it is actually needed; do not preload full SKILL.md content."
fi

# 构建输出
if [ -n "$recommendation" ]; then
    OUTPUT=$(jq -n \
        --arg ctx "$recommendation" \
        '{"hookSpecificOutput": {"additionalContext": $ctx}}')
fi

echo "$OUTPUT"
