"""
State definitions for Orchestrate LangGraph migration.

Maps CC feature-list.json and PRD to LangGraph State.
"""
from typing import TypedDict, Annotated, Optional, List, Dict, Any
from datetime import datetime
import operator
from langgraph.graph import add_messages
from langchain_core.messages import BaseMessage


class Feature(TypedDict):
    """Single feature in the feature list."""
    id: str
    category: str  # functional, refactor, fix, etc.
    description: str
    acceptance_criteria: List[str]
    verification_method: str  # e2e, manual, unit
    passes: Optional[bool]  # None=pending, True=passed, False=failed
    verified_at: Optional[str]
    attempt_count: int
    max_attempts: int
    notes: str
    delta_context: Optional[Dict[str, Any]]


class DeltaContext(TypedDict):
    """Context for fixer loop - passed from reviewer to implementer."""
    problem_location: Dict[str, str]  # file, lines, code_snippet
    root_cause: str
    fix_suggestion: Dict[str, str]  # action, target, details, reference_example
    files_to_read: List[str]
    files_to_skip: List[str]


class Subtask(TypedDict):
    """Subtask in the orchestration."""
    id: int
    description: str
    agent_type: str  # implementer, researcher, reviewer
    files_to_modify: List[str]
    files_to_read: List[str]
    dependencies: List[int]  # IDs of dependent subtasks
    status: str  # pending, in_progress, complete, blocked
    recommended_model: Optional[str]
    routing_reason: Optional[str]
    result: Optional[str]


class PRD(TypedDict):
    """Product Requirements Document."""
    goal: str
    from_user: List[str]
    from_context: List[str]
    assumptions: List[Dict[str, str]]  # assumption, verification_method
    open_questions: List[Dict[str, Any]]  # question, options
    requirements: List[str]
    acceptance_criteria: List[str]
    definition_of_done: List[str]
    out_of_scope: List[str]
    technical_notes: Dict[str, Any]


class OrchestrateState(TypedDict):
    """
    Main state for the orchestrate LangGraph.

    Corresponds to CC's feature-list.json + PRD + runtime state.
    """
    # Task metadata
    task_id: str
    task_description: str
    created_at: str

    # PRD (evolving)
    prd: PRD

    # Subtasks
    subtasks: List[Subtask]
    current_subtask_index: int

    # Feature list (verification)
    features: List[Feature]

    # Aggregated results
    completed_subtasks: Annotated[List[Subtask], operator.add]
    blocked_subtasks: Annotated[List[Subtask], operator.add]

    # Conversation history
    messages: Annotated[List[BaseMessage], add_messages]

    # Fixer loop state
    fixer_loop_active: bool
    current_feature_id: Optional[str]
    delta_context: Optional[DeltaContext]

    # Control flow
    requires_user_confirmation: bool
    user_confirmed: bool

    # Error handling
    errors: Annotated[List[str], operator.add]


# Helper functions for state manipulation

def create_initial_state(
    task_description: str,
    task_id: Optional[str] = None
) -> OrchestrateState:
    """Create initial state for a new orchestration."""
    return OrchestrateState(
        task_id=task_id or f"task-{datetime.now().isoformat()}",
        task_description=task_description,
        created_at=datetime.now().isoformat(),
        prd=PRD(
            goal="",
            from_user=[task_description],
            from_context=[],
            assumptions=[],
            open_questions=[],
            requirements=[],
            acceptance_criteria=[],
            definition_of_done=[],
            out_of_scope=[],
            technical_notes={}
        ),
        subtasks=[],
        current_subtask_index=0,
        features=[],
        completed_subtasks=[],
        blocked_subtasks=[],
        messages=[],
        fixer_loop_active=False,
        current_feature_id=None,
        delta_context=None,
        requires_user_confirmation=False,
        user_confirmed=False,
        errors=[]
    )


def create_feature(
    feature_id: str,
    description: str,
    acceptance_criteria: List[str],
    verification_method: str = "manual",
    max_attempts: int = 3
) -> Feature:
    """Create a new feature."""
    return Feature(
        id=feature_id,
        category="functional",
        description=description,
        acceptance_criteria=acceptance_criteria,
        verification_method=verification_method,
        passes=None,
        verified_at=None,
        attempt_count=0,
        max_attempts=max_attempts,
        notes="",
        delta_context=None
    )


def create_subtask(
    subtask_id: int,
    description: str,
    agent_type: str,
    files_to_modify: List[str],
    files_to_read: List[str],
    dependencies: List[int] = None
) -> Subtask:
    """Create a new subtask."""
    return Subtask(
        id=subtask_id,
        description=description,
        agent_type=agent_type,
        files_to_modify=files_to_modify,
        files_to_read=files_to_read,
        dependencies=dependencies or [],
        status="pending",
        recommended_model=None,
        routing_reason=None,
        result=None
    )


def get_pending_features(state: OrchestrateState) -> List[Feature]:
    """Get features with passes=None."""
    return [f for f in state["features"] if f["passes"] is None]


def get_failed_features(state: OrchestrateState) -> List[Feature]:
    """Get features with passes=False."""
    return [f for f in state["features"] if f["passes"] is False]


def get_pending_subtasks(state: OrchestrateState) -> List[Subtask]:
    """Get subtasks with status='pending'."""
    return [s for s in state["subtasks"] if s["status"] == "pending"]


def can_execute_subtask(state: OrchestrateState, subtask: Subtask) -> bool:
    """Check if a subtask's dependencies are satisfied."""
    for dep_id in subtask["dependencies"]:
        dep_subtask = next(
            (s for s in state["subtasks"] if s["id"] == dep_id),
            None
        )
        if dep_subtask is None or dep_subtask["status"] != "complete":
            return False
    return True


def update_feature_result(
    state: OrchestrateState,
    feature_id: str,
    passes: bool,
    notes: str = "",
    delta_context: Optional[DeltaContext] = None
) -> Dict[str, Any]:
    """Update feature verification result."""
    features = []
    for f in state["features"]:
        if f["id"] == feature_id:
            updated_feature = dict(f)
            updated_feature["passes"] = passes
            updated_feature["verified_at"] = datetime.now().isoformat()
            updated_feature["notes"] = notes
            if passes:
                updated_feature["attempt_count"] = 1
                updated_feature["delta_context"] = None
            else:
                updated_feature["attempt_count"] = f["attempt_count"] + 1
                updated_feature["delta_context"] = delta_context
            features.append(updated_feature)
        else:
            features.append(f)

    return {"features": features}


def update_subtask_result(
    state: OrchestrateState,
    subtask_id: int,
    status: str,
    result: Optional[str] = None
) -> Dict[str, Any]:
    """Update subtask execution result."""
    subtasks = []
    for s in state["subtasks"]:
        if s["id"] == subtask_id:
            updated_subtask = dict(s)
            updated_subtask["status"] = status
            updated_subtask["result"] = result
            subtasks.append(updated_subtask)
        else:
            subtasks.append(s)

    return {"subtasks": subtasks}


# Alias for backward compatibility
is_subtask_ready = can_execute_subtask  # Legacy alias
