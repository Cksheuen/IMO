"""
Node implementations for the multi-model-agent migration.

The graph is intentionally lightweight:
- analyze the task
- select a model
- optionally apply fallback
- summarize the routing result
"""
from __future__ import annotations

from typing import Any, Dict, List

from langchain_core.runnables import RunnableLambda

from .state import (
    MultiModelState,
    CostSnapshot,
    MonitoringSnapshot,
    RoutingDecision,
    TaskAnalysis,
    get_default_fallback_chain,
    get_profile,
)
from .tools import get_litellm_adapter


def _classify_task_type(task_request: str, agent_role: str) -> str:
    text = f"{task_request} {agent_role}".lower()

    if any(keyword in text for keyword in ["review", "审查", "验证", "reviewer"]):
        return "review"
    if any(keyword in text for keyword in ["architecture", "架构", "设计", "plan", "规划"]):
        return "architecture"
    if any(keyword in text for keyword in ["research", "调研", "搜索", "总结", "researcher"]):
        return "research"
    if any(keyword in text for keyword in ["implement", "implementation", "写代码", "实现", "重构", "测试"]):
        return "implementation"
    return "general"


def _matched_keywords(task_request: str, rules: List[Dict[str, Any]]) -> List[str]:
    text = task_request.lower()
    matched: List[str] = []
    for rule in rules:
        for keyword in rule.get("keywords", []):
            if keyword.lower() in text and keyword not in matched:
                matched.append(keyword)
    return matched


def _estimate_turns(task_type: str, task_request: str) -> int:
    if task_type == "architecture":
        return 35
    if task_type == "implementation":
        return 25
    if task_type == "review":
        return 18
    if task_type == "research":
        return 12
    return max(8, min(20, len(task_request.split()) // 2))


def _select_by_task_rules(state: MultiModelState, analysis: TaskAnalysis) -> RoutingDecision:
    current_model = state.get("current_agent_model")

    for rule in sorted(state["routing_rules"], key=lambda item: item["priority"], reverse=True):
        if analysis["task_type"] not in rule["task_types"] and "general" not in rule["task_types"]:
            continue
        if rule["keywords"]:
            if not any(keyword in analysis["matched_keywords"] for keyword in rule["keywords"]):
                continue
        selected_model = rule["route_to"]
        return RoutingDecision(
            selected_model=selected_model,
            fallback_chain=get_default_fallback_chain(selected_model),
            source="task_type",
            reason=rule["rationale"],
            confidence=0.9,
            requires_confirmation=False,
        )

    if current_model:
        return RoutingDecision(
            selected_model=current_model,
            fallback_chain=get_default_fallback_chain(current_model),
            source="agent_default",
            reason="No higher-priority routing rule matched; kept agent default model.",
            confidence=0.6,
            requires_confirmation=False,
        )

    return RoutingDecision(
        selected_model="claude-sonnet",
        fallback_chain=[],
        source="manual",
        reason="Defaulted to claude-sonnet as the balanced fallback.",
        confidence=0.5,
        requires_confirmation=False,
    )


def _apply_cost_rule(decision: RoutingDecision, analysis: TaskAnalysis) -> RoutingDecision:
    if analysis["estimated_turns"] < 10 and decision["selected_model"] not in {"claude-haiku", "claude-sonnet"}:
        return {
            **decision,
            "selected_model": "claude-haiku",
            "fallback_chain": ["claude-sonnet"],
            "source": "cost_rule",
            "reason": "Short task forced to a lower-cost model.",
            "confidence": 0.8,
        }

    if analysis["estimated_turns"] < 30 and decision["selected_model"] == "claude-opus":
        return {
            **decision,
            "selected_model": "claude-sonnet",
            "fallback_chain": ["gpt-4.1"],
            "source": "cost_rule",
            "reason": "Medium task downgraded from opus to sonnet for cost balance.",
            "confidence": 0.75,
        }

    return decision


def _build_cost_snapshot(selected_model: str, analysis: TaskAnalysis) -> CostSnapshot:
    base_prices = {
        "claude-haiku": 0.01,
        "claude-sonnet": 0.05,
        "codex": 0.06,
        "gemini-2.5": 0.05,
        "gpt-4.1": 0.08,
        "claude-opus": 0.12,
    }
    estimated_input_tokens = analysis["estimated_turns"] * 800
    estimated_output_tokens = analysis["estimated_turns"] * 250
    estimated_cost = base_prices.get(selected_model, 0.05) * analysis["estimated_turns"]
    strongest_model_cost = base_prices["claude-opus"] * analysis["estimated_turns"]

    profile_cost = "medium"
    if selected_model == "claude-haiku":
        profile_cost = "low"
    elif selected_model in {"claude-opus", "gpt-4.1"}:
        profile_cost = "high"

    return CostSnapshot(
        estimated_input_tokens=estimated_input_tokens,
        estimated_output_tokens=estimated_output_tokens,
        estimated_cost_usd=round(estimated_cost, 4),
        cost_tier=profile_cost,
        compared_to_single_strongest_model=round(strongest_model_cost - estimated_cost, 4),
    )


async def analyze_task_node(state: MultiModelState) -> Dict[str, Any]:
    """Analyze task type, expected effort, and routing signals."""
    task_type = _classify_task_type(state["task_request"], state["agent_role"])
    matched_keywords = _matched_keywords(state["task_request"], state["routing_rules"])
    estimated_turns = _estimate_turns(task_type, state["task_request"])

    analysis = TaskAnalysis(
        task_type=task_type,
        estimated_turns=estimated_turns,
        requires_deep_reasoning=task_type in {"architecture", "general"},
        requires_code_generation=task_type == "implementation",
        requires_tool_use=task_type in {"implementation", "research", "review"},
        matched_keywords=matched_keywords,
        notes=[f"Detected task type: {task_type}"],
    )
    return {"task_analysis": analysis}


async def select_model_node(state: MultiModelState) -> Dict[str, Any]:
    """Select a model from rules + cost heuristics + agent defaults."""
    analysis = state.get("task_analysis")
    if not analysis:
        return {"errors": ["Task analysis missing before model selection."]}

    decision = _select_by_task_rules(state, analysis)
    decision = _apply_cost_rule(decision, analysis)
    cost_snapshot = _build_cost_snapshot(decision["selected_model"], analysis)

    adapter = get_litellm_adapter()
    available_models = adapter.load_available_models(
        known_models=[profile["model_name"] for profile in state["model_profiles"]]
    )
    health = adapter.get_health_snapshot()
    model_info = adapter.get_model_info_snapshot(available_models)

    monitoring = MonitoringSnapshot(
        available_models=available_models,
        healthy=bool(health["healthy"]),
        model_info_endpoint=str(model_info["endpoint"]),
        spend_logs_endpoint=adapter.endpoints.spend_logs,
        health_endpoint=str(health["endpoint"]),
        notes=list(health["notes"]) + list(model_info["notes"]),
    )

    return {
        "routing_decision": decision,
        "cost_snapshot": cost_snapshot,
        "monitoring_snapshot": monitoring,
    }


async def apply_fallback_node(state: MultiModelState) -> Dict[str, Any]:
    """Fallback to the first healthy/available model when needed."""
    decision = state.get("routing_decision")
    monitoring = state.get("monitoring_snapshot")
    analysis = state.get("task_analysis")
    if not decision or not monitoring or not analysis:
        return {"errors": ["Fallback requested without decision/monitoring/analysis."]}

    available_models = monitoring["available_models"]
    fallback_choice = None
    for candidate in decision["fallback_chain"]:
        if candidate in available_models:
            fallback_choice = candidate
            break

    if fallback_choice is None:
        fallback_choice = "claude-sonnet"

    updated_decision = RoutingDecision(
        selected_model=fallback_choice,
        fallback_chain=[],
        source="fallback",
        reason=f"Fallback applied because {decision['selected_model']} was unavailable or fallback was forced.",
        confidence=0.7,
        requires_confirmation=False,
    )
    return {
        "routing_decision": updated_decision,
        "cost_snapshot": _build_cost_snapshot(fallback_choice, analysis),
    }


async def summarize_node(state: MultiModelState) -> Dict[str, Any]:
    """Summarize the routing result for downstream usage."""
    analysis = state.get("task_analysis")
    decision = state.get("routing_decision")
    cost_snapshot = state.get("cost_snapshot")
    monitoring = state.get("monitoring_snapshot")

    if not analysis or not decision or not cost_snapshot or not monitoring:
        return {"errors": ["Cannot summarize incomplete routing state."]}

    profile = get_profile(state, decision["selected_model"])
    strengths = ", ".join(profile["strengths"]) if profile else "unknown"
    summary = (
        f"Task type `{analysis['task_type']}` routed to `{decision['selected_model']}` "
        f"via `{decision['source']}`. Reason: {decision['reason']} "
        f"Estimated cost tier: `{cost_snapshot['cost_tier']}`. "
        f"Key strengths: {strengths}. "
        f"Available models observed: {', '.join(monitoring['available_models'])}."
    )
    return {"summary": summary}


analyze_task_runnable = RunnableLambda(analyze_task_node)
select_model_runnable = RunnableLambda(select_model_node)
apply_fallback_runnable = RunnableLambda(apply_fallback_node)
summarize_runnable = RunnableLambda(summarize_node)
