"""
State definitions for the multi-model-agent migration.

Maps the CC skill's model matrix, routing rules, cost rules, and
agent-level model selection into a compact LangGraph state.
"""
from __future__ import annotations

from datetime import datetime
from operator import add
from typing import Annotated, Any, Dict, List, Literal, Optional, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph import add_messages


TaskType = Literal[
    "implementation",
    "research",
    "architecture",
    "review",
    "general",
]

CostTier = Literal["low", "medium", "high"]
RoutingSource = Literal["task_type", "cost_rule", "agent_default", "fallback", "manual"]


class ModelProfile(TypedDict):
    """Single model entry from the capability matrix."""
    model_name: str
    provider: str
    strengths: List[str]
    relative_cost: CostTier
    recommended_for: List[TaskType]
    supports_tools: bool
    supports_long_context: bool


class RoutingRule(TypedDict):
    """Declarative routing rule derived from the skill."""
    rule_id: str
    task_types: List[TaskType]
    keywords: List[str]
    route_to: str
    priority: int
    rationale: str


class TaskAnalysis(TypedDict):
    """Structured task analysis before model selection."""
    task_type: TaskType
    estimated_turns: int
    requires_deep_reasoning: bool
    requires_code_generation: bool
    requires_tool_use: bool
    matched_keywords: List[str]
    notes: List[str]


class RoutingDecision(TypedDict):
    """Result of model routing."""
    selected_model: str
    fallback_chain: List[str]
    source: RoutingSource
    reason: str
    confidence: float
    requires_confirmation: bool


class CostSnapshot(TypedDict):
    """Estimated cost envelope for the current routing decision."""
    estimated_input_tokens: int
    estimated_output_tokens: int
    estimated_cost_usd: float
    cost_tier: CostTier
    compared_to_single_strongest_model: Optional[float]


class MonitoringSnapshot(TypedDict):
    """Minimal adapter-level observability state."""
    available_models: List[str]
    healthy: bool
    model_info_endpoint: str
    spend_logs_endpoint: str
    health_endpoint: str
    notes: List[str]


class MultiModelState(TypedDict):
    """
    Main graph state for the multi-model-agent migration.

    Keeps the migration scoped to routing policy and observability adapters.
    """
    created_at: str
    task_request: str
    agent_role: str
    current_agent_model: Optional[str]
    force_fallback: bool
    fallback_review_approved: Optional[bool]

    model_profiles: List[ModelProfile]
    routing_rules: List[RoutingRule]

    task_analysis: Optional[TaskAnalysis]
    routing_decision: Optional[RoutingDecision]
    cost_snapshot: Optional[CostSnapshot]
    monitoring_snapshot: Optional[MonitoringSnapshot]

    summary: Optional[str]

    messages: Annotated[List[BaseMessage], add_messages]
    errors: Annotated[List[str], add]


def create_default_model_profiles() -> List[ModelProfile]:
    """Build the model matrix from the source skill."""
    return [
        ModelProfile(
            model_name="claude-opus",
            provider="anthropic",
            strengths=["complex reasoning", "architecture", "long context"],
            relative_cost="high",
            recommended_for=["architecture", "general"],
            supports_tools=True,
            supports_long_context=True,
        ),
        ModelProfile(
            model_name="claude-sonnet",
            provider="anthropic",
            strengths=["balanced reasoning", "review", "implementation"],
            relative_cost="medium",
            recommended_for=["implementation", "review", "general"],
            supports_tools=True,
            supports_long_context=True,
        ),
        ModelProfile(
            model_name="claude-haiku",
            provider="anthropic",
            strengths=["fast research", "summarization", "format conversion"],
            relative_cost="low",
            recommended_for=["research"],
            supports_tools=True,
            supports_long_context=False,
        ),
        ModelProfile(
            model_name="codex",
            provider="openai",
            strengths=["code generation", "refactoring", "test writing"],
            relative_cost="medium",
            recommended_for=["implementation"],
            supports_tools=True,
            supports_long_context=False,
        ),
        ModelProfile(
            model_name="gpt-4.1",
            provider="openai",
            strengths=["tool calling", "structured output", "api integration"],
            relative_cost="high",
            recommended_for=["general", "implementation"],
            supports_tools=True,
            supports_long_context=True,
        ),
        ModelProfile(
            model_name="gemini-2.5",
            provider="google",
            strengths=["multimodal", "large context", "document analysis"],
            relative_cost="medium",
            recommended_for=["research", "general"],
            supports_tools=True,
            supports_long_context=True,
        ),
    ]


def create_default_routing_rules() -> List[RoutingRule]:
    """Build the routing rules and keep them deterministic."""
    return [
        RoutingRule(
            rule_id="implementation-to-codex",
            task_types=["implementation"],
            keywords=[
                "写代码",
                "实现",
                "重构",
                "测试",
                "code",
                "implement",
                "implementation",
                "refactor",
                "test",
            ],
            route_to="codex",
            priority=100,
            rationale="Code-dense work prefers Codex when available.",
        ),
        RoutingRule(
            rule_id="research-to-haiku",
            task_types=["research"],
            keywords=["调研", "搜索", "总结", "research", "search", "summarize"],
            route_to="claude-haiku",
            priority=90,
            rationale="Research and summarization prefer fast lower-cost models.",
        ),
        RoutingRule(
            rule_id="architecture-to-opus",
            task_types=["architecture"],
            keywords=["架构", "设计", "规划", "architecture", "design", "plan"],
            route_to="claude-opus",
            priority=80,
            rationale="Architecture tasks prefer the strongest reasoning model.",
        ),
        RoutingRule(
            rule_id="review-to-sonnet",
            task_types=["review"],
            keywords=["审查", "review", "verify", "验证"],
            route_to="claude-sonnet",
            priority=70,
            rationale="Review work prefers a balanced reasoning/cost model.",
        ),
        RoutingRule(
            rule_id="default-to-sonnet",
            task_types=["general"],
            keywords=[],
            route_to="claude-sonnet",
            priority=10,
            rationale="Sonnet is the default balanced model.",
        ),
    ]


def create_initial_state(
    task_request: str,
    agent_role: str = "implementer",
    current_agent_model: Optional[str] = None,
    force_fallback: bool = False,
) -> MultiModelState:
    """Create the initial state for the routing graph."""
    return MultiModelState(
        created_at=datetime.now().isoformat(),
        task_request=task_request,
        agent_role=agent_role,
        current_agent_model=current_agent_model,
        force_fallback=force_fallback,
        fallback_review_approved=None,
        model_profiles=create_default_model_profiles(),
        routing_rules=create_default_routing_rules(),
        task_analysis=None,
        routing_decision=None,
        cost_snapshot=None,
        monitoring_snapshot=None,
        summary=None,
        messages=[],
        errors=[],
    )


def get_profile(state: MultiModelState, model_name: str) -> Optional[ModelProfile]:
    """Find a model profile by name."""
    for profile in state["model_profiles"]:
        if profile["model_name"] == model_name:
            return profile
    return None


def get_default_fallback_chain(model_name: str) -> List[str]:
    """Fallbacks derived from the source skill and local config rule."""
    fallback_map = {
        "claude-opus": ["claude-sonnet", "gpt-4.1"],
        "codex": ["claude-sonnet"],
        "claude-haiku": ["claude-sonnet"],
        "gpt-4.1": ["claude-sonnet"],
        "gemini-2.5": ["claude-sonnet"],
        "claude-sonnet": [],
    }
    return fallback_map.get(model_name, ["claude-sonnet"])
