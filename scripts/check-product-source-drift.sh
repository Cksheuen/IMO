#!/usr/bin/env bash
# check-product-source-drift.sh
#
# 检测 staged 自动生成产物有无对应 source 也 staged。
# 典型场景：sync-manifest.json 已含 concept-flow-mode 但 skills/concept-flow-mode/ 仍 untracked。
#
# 使用：bash scripts/check-product-source-drift.sh
# 退出码：0 = 干净；1 = 检测到 drift。

set -u

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "${REPO_ROOT}" ]]; then
  echo "[drift] not inside a git repo" >&2
  exit 2
fi

cd "${REPO_ROOT}"

# product → source 前缀列表（空格分隔）。生成器路径也算作合法 source。
declare -a PRODUCTS=(
  "rules-index.json|rules/ rules-library/ scripts/build-rules-index.py"
  "shared-knowledge/sync-manifest.json|rules/ rules-library/ notes/lessons/ skills/ commands/ hooks/codex-sync/"
  "shared-knowledge/AGENTS.md|rules/ rules-library/ notes/lessons/ CLAUDE.md hooks/codex-sync/"
  "metrics/dashboard/preview.svg|metrics/events/ metrics/daily/ hooks/metrics/gen_svg.py"
)

STAGED_FILES="$(git diff --cached --name-only)"
[[ -z "${STAGED_FILES}" ]] && exit 0

drift_found=0

is_staged() {
  local path="$1"
  printf '%s\n' "${STAGED_FILES}" | grep -Fxq "${path}"
}

has_staged_under() {
  local prefix="$1"
  printf '%s\n' "${STAGED_FILES}" | grep -q "^${prefix}"
}

for entry in "${PRODUCTS[@]}"; do
  product="${entry%%|*}"
  sources_str="${entry##*|}"
  if ! is_staged "${product}"; then
    continue
  fi
  read -r -a sources <<< "${sources_str}"
  matched=0
  for src in "${sources[@]}"; do
    if has_staged_under "${src}"; then
      matched=1
      break
    fi
  done
  if [[ ${matched} -eq 0 ]]; then
    echo "[drift] ${product} staged 但未发现对应 source 改动 (${sources_str})" >&2
    drift_found=1
  fi
done

# 额外检查：metrics/weekly/*.json staged 但没有 metrics/events/、metrics/daily/ 或生成器改动
if printf '%s\n' "${STAGED_FILES}" | grep -q "^metrics/weekly/.*\.json$"; then
  if ! printf '%s\n' "${STAGED_FILES}" | grep -qE "^metrics/(events|daily)/|^hooks/metrics/aggregate\.py$"; then
    echo "[drift] metrics/weekly/*.json staged 但 metrics/events/、metrics/daily/ 或 aggregate.py 均未变" >&2
    drift_found=1
  fi
fi

exit ${drift_found}
