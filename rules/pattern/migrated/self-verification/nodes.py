"""
LangGraph 节点函数 - Self-Verification Mechanism

迁移自: ~/.claude/rules/pattern/self-verification-mechanism.md

节点类型:
1. gate_check - Verification Gate 检查
2. reviewer - 验证 feature
3. implementer - 修复 feature
4. mark_completed - 标记任务完成
"""

from datetime import datetime
from typing import Literal
from .state import (
    VerificationGateState,
    Feature,
    FeatureList,
    DeltaContext,
)


# ==================== Gate Check Node ====================

def gate_check(state: VerificationGateState) -> dict:
    """
    Verification Gate 检查节点

    迁移自 Stop hook 触发的验证门控逻辑:

    流程:
    1. stop_hook_active = true -> 允许退出（防止循环）
    2. 无 feature-list.json -> 允许退出（无验证需求）
    3. status = "completed" -> 允许退出（任务已完成）
    4. pending = 0 -> 允许退出（全部通过）
    5. 有 feature 超过 max_attempts -> 标记 completed，允许退出
    6. 有 passes = false -> 阻止退出，触发 fixer
    7. 有 passes = null -> 阻止退出，触发 reviewer
    """
    # 防循环检查
    if state.get("stop_hook_active", False):
        return {"gate_decision": "exit_completed"}

    feature_list = state.get("feature_list")

    # 无 feature list
    if feature_list is None:
        return {"gate_decision": "exit_no_features"}

    # 任务已完成
    if feature_list["status"] == "completed":
        return {"gate_decision": "exit_completed"}

    features = feature_list["features"]

    # 分类 features
    pending_features = [f for f in features if f["passes"] is None]
    failed_features = [f for f in features if f["passes"] is False]
    passed_features = [f for f in features if f["passes"] is True]

    # 超过迭代上限的 features
    exceeded_features = [
        f for f in failed_features
        if f["attempt_count"] >= f["max_attempts"]
    ]

    # 有超过迭代上限的 feature
    if exceeded_features:
        return {
            "gate_decision": "exit_max_attempts",
            "exceeded_features": exceeded_features,
        }

    # 全部通过
    if not pending_features and not failed_features:
        return {"gate_decision": "exit_completed"}

    # 有失败待修复
    if failed_features:
        return {
            "gate_decision": "trigger_fixer",
            "failed_features": failed_features,
            "current_feature_id": failed_features[0]["id"],
        }

    # 有待验证
    if pending_features:
        return {
            "gate_decision": "trigger_reviewer",
            "pending_features": pending_features,
            "current_feature_id": pending_features[0]["id"],
        }

    # 默认退出
    return {"gate_decision": "exit_completed"}


# ==================== Reviewer Node ====================

def reviewer(state: VerificationGateState) -> dict:
    """
    Reviewer 节点 - 验证 feature

    职责:
    1. 读取 feature 及其 acceptance_criteria
    2. 执行验证（e2e/unit/manual）
    3. 更新 feature 状态

    输出:
    - passes=true: 标记通过，清除 delta_context
    - passes=false: 填充 delta_context，增加 attempt_count
    """
    feature_list = state["feature_list"]
    current_id = state.get("current_feature_id")

    if not current_id:
        return {"gate_decision": "exit_completed"}

    # 找到当前 feature
    feature = next(
        (f for f in feature_list["features"] if f["id"] == current_id),
        None
    )

    if not feature:
        return {"gate_decision": "exit_completed"}

    # === 实际验证逻辑（由外部 LLM 或工具实现） ===
    # 这里是占位符，实际实现应该:
    # 1. 运行测试
    # 2. 检查 acceptance_criteria
    # 3. 决定 passes
    passes, notes, delta_context = _run_verification(feature)
    # ==============================================

    # 更新 feature
    updated_features = []
    for f in feature_list["features"]:
        if f["id"] == current_id:
            updated_f = {
                **f,
                "passes": passes,
                "verified_at": datetime.now().isoformat() if passes else None,
                "notes": notes or "",
                "attempt_count": f["attempt_count"] + (0 if passes else 1),
                "delta_context": delta_context if not passes else None,
            }
            updated_features.append(updated_f)
        else:
            updated_features.append(f)

    # 更新 summary
    summary = _calculate_summary(updated_features)

    return {
        "feature_list": {
            **feature_list,
            "features": updated_features,
            "summary": summary,
        },
        "reviewer_output": f"Feature {current_id}: {'PASSED' if passes else 'FAILED'}",
    }


def _run_verification(feature: Feature) -> tuple[bool, str | None, DeltaContext | None]:
    """
    执行实际验证（占位符）

    实际实现应该:
    - 根据 verification_method 选择验证方式
    - 运行 e2e/unit 测试
    - 检查 acceptance_criteria

    Returns:
        (passes, notes, delta_context)
    """
    # 占位符实现
    # 实际应该调用外部验证工具
    return True, None, None


# ==================== Implementer Node ====================

def implementer(state: VerificationGateState) -> dict:
    """
    Implementer 节点 - 修复 feature

    职责:
    1. 读取 delta_context
    2. 只读取 files_to_read（收窄上下文）
    3. 按 fix_suggestion 修复
    4. 重置 passes=null 触发重新验证

    输入:
    - feature: 待修复的 feature
    - delta_context: reviewer 提供的修复上下文
    """
    feature_list = state["feature_list"]
    current_id = state.get("current_feature_id")

    if not current_id:
        return {"gate_decision": "exit_completed"}

    feature = next(
        (f for f in feature_list["features"] if f["id"] == current_id),
        None
    )

    if not feature or not feature.get("delta_context"):
        return {"gate_decision": "exit_completed"}

    delta = feature["delta_context"]

    # === 实际修复逻辑（由外部 LLM 或工具实现） ===
    # 这里是占位符，实际实现应该:
    # 1. 读取 delta.files_to_read
    # 2. 按 delta.fix_suggestion 修复
    # 3. 不读取 delta.files_to_skip
    success, changes = _apply_fix(feature, delta)
    # ==============================================

    # 重置为待验证状态
    updated_features = []
    for f in feature_list["features"]:
        if f["id"] == current_id:
            updated_f = {
                **f,
                "passes": None,  # 重置为待验证
                "verified_at": None,
                "notes": "",
            }
            updated_features.append(updated_f)
        else:
            updated_features.append(f)

    summary = _calculate_summary(updated_features)

    return {
        "feature_list": {
            **feature_list,
            "features": updated_features,
            "summary": summary,
        },
        "implementer_output": f"Feature {current_id}: {'FIXED' if success else 'FAILED TO FIX'}",
    }


def _apply_fix(feature: Feature, delta: DeltaContext) -> tuple[bool, list[str]]:
    """
    执行实际修复（占位符）

    实际实现应该:
    - 读取 delta.files_to_read
    - 按 delta.fix_suggestion 修改代码
    - 不读取 delta.files_to_skip

    Returns:
        (success, changes_made)
    """
    # 占位符实现
    return True, []


# ==================== Helper Functions ====================

def _calculate_summary(features: list[Feature]) -> dict:
    """计算 feature list summary"""
    total = len(features)
    passed = sum(1 for f in features if f["passes"] is True)
    failed = sum(1 for f in features if f["passes"] is False)
    pending = sum(1 for f in features if f["passes"] is None)

    return {
        "total": total,
        "passed": passed,
        "failed": failed,
        "pending": pending,
    }


def mark_completed(state: VerificationGateState) -> dict:
    """标记任务完成"""
    feature_list = state.get("feature_list")
    if not feature_list:
        return {"gate_decision": "exit_completed"}

    return {
        "feature_list": {
            **feature_list,
            "status": "completed",
        },
        "gate_decision": "exit_completed",
    }


def mark_blocked(state: VerificationGateState) -> dict:
    """标记任务阻塞（超过迭代上限）"""
    feature_list = state.get("feature_list")
    if not feature_list:
        return {"gate_decision": "exit_completed"}

    return {
        "feature_list": {
            **feature_list,
            "status": "completed",  # 标记完成，但需要人工干预
        },
        "gate_decision": "exit_max_attempts",
    }


# ==================== 条件边函数 ====================

def route_after_gate(state: VerificationGateState) -> str:
    """
    Gate 检查后的路由决策

    Returns:
        节点名称: "reviewer" | "implementer" | "mark_completed" | "mark_blocked" | END
    """
    decision = state.get("gate_decision")

    if decision == "trigger_reviewer":
        return "reviewer"
    elif decision == "trigger_fixer":
        return "implementer"
    elif decision == "exit_max_attempts":
        return "mark_blocked"
    elif decision in ("exit_completed", "exit_no_features"):
        return "mark_completed"
    else:
        return "mark_completed"


def route_after_reviewer(state: VerificationGateState) -> str:
    """
    Reviewer 后的路由决策

    Returns:
        节点名称: "gate_check" (循环) | "mark_completed"
    """
    feature_list = state.get("feature_list")
    if not feature_list:
        return "mark_completed"

    # 检查是否还有 pending 或 failed
    features = feature_list["features"]
    pending = [f for f in features if f["passes"] is None]
    failed = [f for f in features if f["passes"] is False]

    if pending or failed:
        return "gate_check"  # 继续循环
    else:
        return "mark_completed"


def route_after_implementer(state: VerificationGateState) -> str:
    """
    Implementer 后的路由决策

    Returns:
        节点名称: "gate_check" (循环回去验证)
    """
    # 修复后总是回到 gate_check 进行验证
    return "gate_check"
