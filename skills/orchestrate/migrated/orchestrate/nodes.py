"""
Node implementations for Orchestrate LangGraph migration.

Implements the core nodes: collect_context, decompose, execute, aggregate, verify.
"""
import importlib.util
from pathlib import Path
import sys
from typing import Dict, Any, List, Optional
from langchain_core.runnables import RunnableLambda
from langchain_core.messages import HumanMessage, AIMessage

from .state import (
    OrchestrateState,
    create_initial_state,
    create_feature,
    create_subtask,
    can_execute_subtask,
    update_feature_result,
    update_subtask_result,
    DeltaContext,
)


_MULTI_MODEL_MODULE = None


def _load_multi_model_runtime():
    """Load the migrated multi-model-agent runtime from its sibling directory."""
    global _MULTI_MODEL_MODULE
    if _MULTI_MODEL_MODULE is not None:
        return _MULTI_MODEL_MODULE

    module_path = (
        Path(__file__).resolve().parents[3]
        / "multi-model-agent"
        / "migrated"
        / "multi-model-agent"
        / "__init__.py"
    )
    spec = importlib.util.spec_from_file_location(
        "multi_model_agent_migrated_runtime",
        module_path,
        submodule_search_locations=[str(module_path.parent)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load multi-model runtime from {module_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    _MULTI_MODEL_MODULE = module
    return module


async def _route_subtask_model(subtask: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """
    Route a subtask to the most suitable model using the migrated multi-model runtime.
    """
    runtime = _load_multi_model_runtime()

    role_map = {
        "implementer": "implementer",
        "researcher": "researcher",
        "reviewer": "reviewer",
    }
    routed_state = await runtime.run_multi_model_routing(
        task_request=subtask["description"],
        agent_role=role_map.get(subtask["agent_type"], "implementer"),
    )
    decision = routed_state.get("routing_decision") or {}
    return {
        "recommended_model": decision.get("selected_model"),
        "routing_reason": routed_state.get("summary"),
    }


# Node functions

async def collect_context_node(state: OrchestrateState) -> Dict[str, Any]:
    """
    Step 0: Collect context automatically.

    Equivalent to CC's Step 0: 上下文自动收集.
    """
    # In production, this would use tools to:
    # 1. Glob/Grep search for related files
    # 2. Read similar implementations
    # 3. Extract project constraints from CLAUDE.md, package.json
    # 4. Check notes/ for relevant lessons

    # For migration demo, we simulate context collection
    context_updates = {
        "prd": {
            **state["prd"],
            "from_context": [
                "Related files found via pattern matching",
                "Project constraints extracted from config",
            ],
        }
    }

    return context_updates


async def decompose_node(state: OrchestrateState) -> Dict[str, Any]:
    """
    Step 2: Decompose task into subtasks.

    Equivalent to CC's Step 2: 任务分解.
    """
    task_description = state["task_description"]

    # Simulate LLM-based decomposition
    # In production, this would call an LLM to analyze and decompose

    # Demo: Simple heuristic-based decomposition
    subtasks = []
    features = []

    # Create a main implementation subtask
    subtasks.append(create_subtask(
        subtask_id=1,
        description=f"Implement: {task_description}",
        agent_type="implementer",
        files_to_modify=["(auto-detected)"],
        files_to_read=["(auto-detected)"],
        dependencies=[]
    ))

    # Create a verification feature
    features.append(create_feature(
        feature_id="F001",
        description="Main task completion",
        acceptance_criteria=[
            "All requested functionality implemented",
            "No regressions in existing code",
        ],
        verification_method="manual"
    ))

    return {
        "subtasks": subtasks,
        "features": features,
        "requires_user_confirmation": True,
    }


async def execute_subtask_node(state: OrchestrateState) -> Dict[str, Any]:
    """
    Step 5: Execute a single subtask.

    Equivalent to CC's Agent tool calls with implementer/researcher/reviewer.
    """
    current_index = state["current_subtask_index"]
    subtasks = state["subtasks"]

    if current_index >= len(subtasks):
        return {"fixer_loop_active": False}

    runnable_index = None
    current_subtask = None
    for idx, subtask in enumerate(subtasks):
        if subtask.get("status") != "pending":
            continue
        if can_execute_subtask(state, subtask):
            runnable_index = idx
            current_subtask = subtask
            break

    if current_subtask is None:
        return {
            "fixer_loop_active": False,
            "errors": ["No runnable pending subtasks"],
        }

    if runnable_index is None:
        return {"fixer_loop_active": False}

    routing = await _route_subtask_model(current_subtask)
    current_subtask = {
        **current_subtask,
        **routing,
    }

    # In production, this would:
    # 1. Create an isolated worktree
    # 2. Call implementer agent with the subtask prompt
    # 3. Collect results

    # Demo: Simulate execution
    model_note = current_subtask.get("recommended_model") or "inherit"
    result = (
        f"Simulated execution of subtask {current_subtask['id']} "
        f"with model {model_note}"
    )

    updated_subtasks = []
    for idx, subtask in enumerate(subtasks):
        if idx == runnable_index:
            updated_subtasks.append(dict(current_subtask, status="complete", result=result))
        else:
            updated_subtasks.append(subtask)

    return {
        "subtasks": updated_subtasks,
        "current_subtask_index": max(current_index, runnable_index + 1),
    }


async def aggregate_node(state: OrchestrateState) -> Dict[str, Any]:
    """
    Step 6: Aggregate results from all subtasks.

    Equivalent to CC's Step 6: 结果聚合.
    """
    completed = [s for s in state["subtasks"] if s.get("status") == "complete"]
    blocked = [s for s in state["subtasks"] if s.get("status") == "blocked"]

    updates = {
        "completed_subtasks": completed,
        "blocked_subtasks": blocked,
    }

    return updates


async def verify_node(state: OrchestrateState) -> Dict[str, Any]:
    """
    Step 6.4: Verification node.

    Equivalent to CC's verification-gate + reviewer agent.
    """
    features = state["features"]
    verification_approved = state.get("verification_approved")
    explicit_results = state.get("verification_feature_results", {})

    if verification_approved is False:
        return {
            "errors": ["Verification review was not approved."],
            "fixer_loop_active": False,
        }

    # Check each pending feature
    for feature in features:
        if feature["passes"] is None:
            if feature["id"] in explicit_results:
                passes = explicit_results[feature["id"]]
                notes = "Verified from resume payload"
            else:
                # In production, this would call reviewer agent
                # For demo, simulate verification
                passes = True  # Simulate success
                notes = "Verified automatically"

            updates = update_feature_result(
                state,
                feature["id"],
                passes=passes,
                notes=notes,
            )
            updates["verification_approved"] = None
            updates["verification_feature_results"] = {}
            return updates

    # All features verified
    return {
        "fixer_loop_active": False,
        "verification_approved": None,
        "verification_feature_results": {},
    }


async def fixer_node(state: OrchestrateState) -> Dict[str, Any]:
    """
    Fixer loop node - handles failed verifications.

    Equivalent to CC's delta_context → implementer loop.
    """
    for feature in state["features"]:
        if feature["passes"] is False and feature["attempt_count"] < feature["max_attempts"]:
            # Create delta context for fixer
            delta_context: DeltaContext = {
                "problem_location": {
                    "file": "(auto-detected)",
                    "lines": "(auto-detected)",
                    "code_snippet": "(auto-detected)",
                },
                "root_cause": "Feature verification failed",
                "fix_suggestion": {
                    "action": "fix",
                    "target": feature["description"],
                    "details": "Address the verification failure",
                    "reference_example": None,
                },
                "files_to_read": [],
                "files_to_skip": [],
            }

            return {
                "delta_context": delta_context,
                "current_feature_id": feature["id"],
                "fixer_loop_active": True,
            }

    # No fixer needed
    return {"fixer_loop_active": False}


# Runnable wrappers for LangGraph

collect_context_runnable = RunnableLambda(collect_context_node)
decompose_runnable = RunnableLambda(decompose_node)
execute_subtask_runnable = RunnableLambda(execute_subtask_node)
aggregate_runnable = RunnableLambda(aggregate_node)
verify_runnable = RunnableLambda(verify_node)
fixer_runnable = RunnableLambda(fixer_node)


# Helper to format subtask prompt for implementer

def format_subtask_prompt(
    state: OrchestrateState,
    subtask_id: int
) -> str:
    """Format the prompt for an implementer agent, including Rules Pack."""
    subtask = next(
        (s for s in state["subtasks"] if s["id"] == subtask_id),
        None
    )

    if not subtask:
        return ""

    acceptance = state["features"][0].get("acceptance_criteria", []) if state["features"] else ["Complete the task"]
    acceptance_text = "\n".join(f"- {criterion}" for criterion in acceptance)

    prompt = f"""## Subtask #{subtask['id']}: {subtask['description']}

### Goal
{subtask['description']}

### PRD Reference
Full PRD: See state['prd']

### Context
- Overall task: {state['task_description']}
- Position: Subtask #{subtask['id']} in the orchestration
- Recommended model: {subtask.get('recommended_model') or 'inherit/default'}
- Routing summary: {subtask.get('routing_reason') or 'No routing decision recorded yet'}

### File Ownership
- Can modify: {subtask['files_to_modify']}
- Can read: {subtask['files_to_read']}
- Cannot modify: All other files

### Acceptance Criteria
{acceptance_text}

### Rules Pack
- Minimal change: Each change should affect minimal code
- Root cause: Find root cause, avoid temporary fixes
- No scope creep: Only touch what's necessary

### Output Format
Return results in standard Subtask Report format.
"""
    return prompt
