"""
LangGraph State 定义 - Self-Verification Mechanism

迁移自: ~/.claude/rules/pattern/self-verification-mechanism.md

关键映射:
- Feature List JSON -> State(TypedDict)
- delta_context -> state 字段
- verification status -> 枚举类型
"""

from typing import Any, Dict, List, Literal, Optional, TypedDict


class ProblemLocation(TypedDict):
    """问题位置定义"""
    file: str
    lines: str
    code_snippet: str


class FixSuggestion(TypedDict):
    """修复建议"""
    action: str
    target: str
    details: str
    reference_example: Optional[str]


class DeltaContext(TypedDict):
    """
    修复上下文 - 当 passes=false 时由 reviewer 填充

    用途:
    - problem_location: 精确定位
    - root_cause: 避免新 implementer 重新诊断
    - fix_suggestion: 具体指导
    - files_to_read: 收窄上下文
    - files_to_skip: 避免 token 浪费
    """
    problem_location: ProblemLocation
    root_cause: str
    fix_suggestion: FixSuggestion
    files_to_read: List[str]
    files_to_skip: List[str]


# 验证状态枚举
VerificationStatus = Literal["pending", "passed", "failed"]


class Feature(TypedDict):
    """
    单个 Feature 定义

    字段说明:
    - passes: 验证状态，null=待验证, true=通过, false=失败
    - attempt_count: 已尝试修复次数
    - max_attempts: 最大尝试次数（默认 3）
    - notes: 失败原因或备注
    - delta_context: 修复上下文，失败时由 reviewer 填充
    """
    id: str
    category: str
    description: str
    acceptance_criteria: List[str]
    verification_method: str  # "e2e", "unit", "manual"
    passes: Optional[bool]  # null=pending, true=passed, false=failed
    verified_at: Optional[str]
    attempt_count: int
    max_attempts: int
    notes: str
    delta_context: Optional[DeltaContext]


class FeatureListSummary(TypedDict):
    """Feature List 汇总"""
    total: int
    passed: int
    pending: int
    failed: int


class FeatureList(TypedDict):
    """
    Feature List 根结构

    迁移自 feature-list.json schema
    """
    task_id: str
    created_at: str
    session_id: str
    status: Literal["in_progress", "completed", "blocked"]
    features: List[Feature]
    summary: FeatureListSummary


# ==================== Graph State ====================

class VerificationGateState(TypedDict):
    """
    LangGraph State - Verification Gate 子图

    核心字段:
    - feature_list: 当前任务状态跟踪
    - current_feature_id: 当前正在处理/验证的 feature
    - stop_hook_active: 防止循环
    - iteration_count: 全局迭代计数
    """
    # Feature List (核心状态)
    feature_list: FeatureList

    # 当前处理的 feature
    current_feature_id: Optional[str]

    # 防循环标志
    stop_hook_active: bool

    # 迭代计数
    iteration_count: int

    # Gate 决策结果
    gate_decision: Optional[Literal[
        "exit_completed",      # 任务完成
        "exit_no_features",    # 无 feature list
        "exit_max_attempts",   # 超过迭代上限
        "trigger_reviewer",    # 需要 reviewer 验证
        "trigger_fixer",       # 需要 implementer 修复
    ]]

    # Reviewer/Implementer 输出
    reviewer_output: Optional[str]
    implementer_output: Optional[str]

    # 外部 resume 注入的输入
    resume_input: Optional[Dict[str, Any]]


# ==================== 节点输入/输出类型 ====================

class GateCheckInput(TypedDict):
    """Verification Gate 检查节点输入"""
    feature_list: Optional[FeatureList]
    stop_hook_active: bool


class GateCheckOutput(TypedDict):
    """Verification Gate 检查节点输出"""
    gate_decision: str
    pending_features: List[Feature]
    failed_features: List[Feature]
    exceeded_features: List[Feature]  # 超过 max_attempts


class ReviewerInput(TypedDict):
    """Reviewer 节点输入"""
    feature: Feature
    feature_list: FeatureList


class ReviewerOutput(TypedDict):
    """Reviewer 节点输出"""
    passes: bool
    notes: Optional[str]
    delta_context: Optional[DeltaContext]


class ImplementerInput(TypedDict):
    """Implementer 节点输入"""
    feature: Feature
    delta_context: DeltaContext


class ImplementerOutput(TypedDict):
    """Implementer 节点输出"""
    success: bool
    changes_made: List[str]
