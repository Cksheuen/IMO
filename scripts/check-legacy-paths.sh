#!/usr/bin/env bash
# check-legacy-paths.sh
#
# 扫整库（除 notes/lessons/、tasks/、.git、recall/）有无 legacy 路径字符串。
# 防止后续文档或脚本写回旧路径。
#
# 使用：bash scripts/check-legacy-paths.sh
# 退出码：0 = 干净；1 = 发现 legacy 引用。

set -u

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "${REPO_ROOT}" ]]; then
  echo "[legacy] not inside a git repo" >&2
  exit 2
fi

cd "${REPO_ROOT}"

# 已迁出 hooks/ 的 helper / CLI 工具（aa07f90 + 52ef8dd + 8b00b6c）
LEGACY_PATTERNS=(
  "hooks/task-bootstrap.sh"
  "hooks/verification-gate.sh"
  "hooks/architecture-fitness.py"
  "hooks/audit-runtime-links.py"
  "hooks/build-rules-index.py"
  "hooks/caveman-mode.py"
  "hooks/check-langchain-runtime-deps.py"
  "hooks/context-bundle.py"
  "hooks/promote-notes-run.py"
  "hooks/promotion-apply-result.py"
  "hooks/promotion-dispatch.py"
  "hooks/promotion-mode.py"
  "hooks/runtime-profile-audit.py"
  "hooks/runtime-storage-audit.py"
  "hooks/task-audit.py"
  "hooks/vendor-sync.sh"
)

EXCLUDE_DIRS=(
  ":(exclude)notes/lessons/"
  ":(exclude)notes/research/"
  ":(exclude)tasks/"
  ":(exclude)recall/"
  ":(exclude)scripts/check-legacy-paths.sh"
)

found=0
for pattern in "${LEGACY_PATTERNS[@]}"; do
  hits="$(git grep -nF -- "${pattern}" -- . "${EXCLUDE_DIRS[@]}" 2>/dev/null || true)"
  if [[ -n "${hits}" ]]; then
    echo "[legacy] 发现旧路径引用 '${pattern}':" >&2
    echo "${hits}" >&2
    found=1
  fi
done

exit ${found}
