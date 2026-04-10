"""
Main Promoter logic for Promote Notes LangChain migration.

Implements the full promotion workflow using LangGraph StateGraph.

This is the main entry point that:
1. Retrieves candidate notes
2. Evaluates each note's promotion eligibility
3. Decides target location (rules/skills/memory/notes)
4. Handles conflicts and deduplication
5. Executes promotion actions
6. Writes results
"""

from typing import TypedDict, Annotated, List, Dict, Any, Optional
from datetime import datetime
import operator

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.runnables import RunnableLambda
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
from langchain_core.language_models import BaseChatModel

from .tools import (
    NoteCandidate,
    PromotionDecision,
    ConflictInfo,
    PROMOTE_NOTES_TOOLS,
    scan_candidate_notes,
    get_note_content,
    check_promotion_queue,
    check_existing_assets,
    create_rule_file,
    create_skill_file,
    update_note_status,
    write_promotion_result,
)
from .chain import (
    create_promotion_evaluation_chain,
    evaluate_note_for_promotion,
)


# State definition

class PromoteNotesState(TypedDict):
    """State for the promote-notes workflow."""
    # Input
    input_candidates: Optional[List[Dict[str, Any]]]  # From promotionScan/promotionDispatch
    queue_path: Optional[str]
    result_path: Optional[str]

    # Candidates
    candidates: List[NoteCandidate]
    current_candidate_index: int

    # Evaluation results
    evaluations: List[Dict[str, Any]]

    # Actions taken
    processed: List[Dict[str, Any]]
    deferred: List[Dict[str, Any]]
    failed: List[Dict[str, Any]]

    # LLM
    llm: Optional[Any]  # Set during initialization

    # Error handling
    errors: Annotated[List[str], operator.add]


# Node functions

async def retrieve_candidates_node(state: PromoteNotesState) -> Dict[str, Any]:
    """
    Step 0: Retrieve candidate notes.

    Equivalent to CC's Step 0: candidate note retrieval.
    """
    candidates = []

    # Priority 1: Use input candidates from promotionScan/promotionDispatch
    if state.get("input_candidates"):
        for c in state["input_candidates"]:
            candidates.append(NoteCandidate(
                path=c.get("path", ""),
                status=c.get("status", "active"),
                signal=c.get("signal"),
                last_verified=None,
                source_cases=[],
                reuse_count=0,
                has_clear_trigger=False,
                has_stable_steps=False,
            ))
        return {"candidates": candidates}

    # Priority 2: Check promotion queue
    queue_result = check_promotion_queue.invoke(state.get("queue_path", ""))
    if queue_result.get("has_queue") and queue_result.get("candidates"):
        for c in queue_result["candidates"]:
            candidates.append(NoteCandidate(
                path=c.get("path", ""),
                status=c.get("status", "processing"),
                signal=c.get("signal"),
                last_verified=None,
                source_cases=[],
                reuse_count=0,
                has_clear_trigger=False,
                has_stable_steps=False,
            ))
        return {"candidates": candidates}

    # Priority 3: Scan notes directory
    candidates = scan_candidate_notes.invoke({})

    return {"candidates": candidates}


async def evaluate_candidate_node(state: PromoteNotesState) -> Dict[str, Any]:
    """
    Step 1-2: Evaluate current candidate for promotion.

    Combines CC's Step 1 (eligibility) and Step 2 (target decision).
    """
    candidates = state.get("candidates", [])
    current_index = state.get("current_candidate_index", 0)

    if current_index >= len(candidates):
        return {"current_candidate_index": current_index}

    current = candidates[current_index]

    # Get note content
    note_content = get_note_content.invoke({"note_path": current["path"]})

    # Check conflicts
    topic = current["path"].split("/")[-1].replace(".md", "")
    conflict_info = check_existing_assets.invoke({"note_topic": topic})

    # Evaluate using LLM chain
    llm = state.get("llm")
    if llm:
        try:
            evaluation = await evaluate_note_for_promotion(
                llm=llm,
                note_candidate=current,
                note_content=note_content,
                conflict_info=conflict_info
            )
        except Exception as e:
            evaluation = {
                "eligibility": {"is_eligible": False, "reasoning": f"Evaluation error: {e}"},
                "target_decision": None,
                "transformed_content": None,
            }
    else:
        # Fallback without LLM: use heuristic
        evaluation = _heuristic_evaluation(current, conflict_info)

    # Store evaluation
    evaluations = state.get("evaluations", [])
    evaluations.append({
        "candidate": current,
        "content": note_content,
        "conflict_info": conflict_info,
        "result": evaluation,
    })

    return {
        "evaluations": evaluations,
        "current_candidate_index": current_index + 1,
    }


async def execute_promotion_node(state: PromoteNotesState) -> Dict[str, Any]:
    """
    Step 4: Execute promotion actions.

    Equivalent to CC's Step 4: promotion action.
    """
    evaluations = state.get("evaluations", [])

    processed = state.get("processed", [])
    deferred = state.get("deferred", [])
    failed = state.get("failed", [])

    for eval_item in evaluations:
        candidate = eval_item["candidate"]
        result = eval_item.get("result", {})

        eligibility = result.get("eligibility", {})
        target_decision = result.get("target_decision", {})
        transformed_content = result.get("transformed_content")

        # Check eligibility
        if not eligibility.get("is_eligible", False):
            # Defer - not ready for promotion
            deferred.append({
                "path": candidate["path"],
                "reason": eligibility.get("reasoning", "Not eligible"),
                "criteria_missing": eligibility.get("criteria_missing", []),
            })

            # Update note status
            update_note_status.invoke({
                "note_path": candidate["path"],
                "new_status": "active",
                "promotion_reason": eligibility.get("reasoning"),
            })
            continue

        # Determine target
        target = target_decision.get("target", "notes")

        if target == "notes":
            # Stay in notes - update status only
            deferred.append({
                "path": candidate["path"],
                "reason": "Better suited for notes/",
            })

            update_note_status.invoke({
                "note_path": candidate["path"],
                "new_status": "active",
                "promotion_reason": "Remains in notes - explanatory nature",
            })
            continue

        # Handle conflicts
        conflict_info = eval_item.get("conflict_info", {})
        if conflict_info.get("has_conflict"):
            # Check if it's a duplicate
            if conflict_info.get("conflict_type") == "duplicate":
                # Don't promote - update existing instead
                processed.append({
                    "path": candidate["path"],
                    "action": "skipped_duplicate",
                    "existing_assets": conflict_info.get("conflict_paths", []),
                })
                continue

            # For partial overlap, merge (simplified)
            # In production would do more sophisticated merging

        # Execute promotion
        try:
            if target == "rules":
                file_name = target_decision.get("file_name_suggestion", "new-rule")
                create_result = create_rule_file.invoke({
                    "rule_name": file_name,
                    "content": transformed_content or eval_item.get("content", ""),
                    "category": "pattern",  # Default category
                })

                if create_result.get("success"):
                    processed.append({
                        "path": candidate["path"],
                        "action": "promoted_to_rule",
                        "target_path": create_result["path"],
                    })

                    update_note_status.invoke({
                        "note_path": candidate["path"],
                        "new_status": "promoted",
                        "promotion_target": create_result["path"],
                        "promotion_reason": target_decision.get("reasoning"),
                    })
                else:
                    failed.append({
                        "path": candidate["path"],
                        "error": create_result.get("error", "Unknown error"),
                    })

            elif target == "skills":
                file_name = target_decision.get("file_name_suggestion", "new-skill")
                create_result = create_skill_file.invoke({
                    "skill_name": file_name,
                    "description": f"Skill for {candidate['path']}",
                    "content": transformed_content or eval_item.get("content", ""),
                })

                if create_result.get("success"):
                    processed.append({
                        "path": candidate["path"],
                        "action": "promoted_to_skill",
                        "target_path": create_result["path"],
                    })

                    update_note_status.invoke({
                        "note_path": candidate["path"],
                        "new_status": "promoted",
                        "promotion_target": create_result["path"],
                        "promotion_reason": target_decision.get("reasoning"),
                    })
                else:
                    failed.append({
                        "path": candidate["path"],
                        "error": create_result.get("error", "Unknown error"),
                    })

            elif target == "memory":
                # For memory, just update the note and track
                processed.append({
                    "path": candidate["path"],
                    "action": "indexed_in_memory",
                })

                update_note_status.invoke({
                    "note_path": candidate["path"],
                    "new_status": "indexed",
                    "promotion_target": "memory",
                })

        except Exception as e:
            failed.append({
                "path": candidate["path"],
                "error": str(e),
            })

    return {
        "processed": processed,
        "deferred": deferred,
        "failed": failed,
    }


async def write_result_node(state: PromoteNotesState) -> Dict[str, Any]:
    """
    Step 5: Write promotion result file.
    """
    from pathlib import Path

    result_path = state.get("result_path") or str(Path.home() / ".claude" / "promotion-result.json")

    write_promotion_result.invoke({
        "result_path": result_path,
        "processed": state.get("processed", []),
        "deferred": state.get("deferred", []),
        "failed": state.get("failed", []),
    })

    return {}


# Helper functions

def _heuristic_evaluation(
    candidate: NoteCandidate,
    conflict_info: ConflictInfo
) -> Dict[str, Any]:
    """
    Heuristic evaluation when LLM is not available.

    Uses simple rules based on metadata.
    """
    # Count criteria met
    criteria_met = []
    criteria_missing = []

    if candidate.get("reuse_count", 0) >= 2:
        criteria_met.append("reuse_evidence")
    else:
        criteria_missing.append("reuse_evidence")

    if candidate.get("has_clear_trigger"):
        criteria_met.append("clear_trigger")
    else:
        criteria_missing.append("clear_trigger")

    if candidate.get("has_stable_steps"):
        criteria_met.append("stable_steps")
    else:
        criteria_missing.append("stable_steps")

    # Need at least 2 criteria met
    is_eligible = len(criteria_met) >= 2

    # Determine target
    target = "notes"
    if is_eligible:
        if candidate.get("has_stable_steps"):
            target = "rules"
        elif candidate.get("reuse_count", 0) >= 3:
            target = "skills"

    return {
        "eligibility": {
            "is_eligible": is_eligible,
            "criteria_met": criteria_met,
            "criteria_missing": criteria_missing,
            "confidence": 0.6,
            "reasoning": "Heuristic evaluation based on metadata",
        },
        "target_decision": {
            "target": target,
            "reasoning": "Heuristic target decision",
            "file_name_suggestion": candidate["path"].split("/")[-1].replace(".md", ""),
        },
        "transformed_content": None,
    }


# Graph construction

def create_promote_notes_graph():
    """Create the promote-notes StateGraph."""
    graph = StateGraph(PromoteNotesState)

    # Add nodes
    graph.add_node("retrieve_candidates", RunnableLambda(retrieve_candidates_node))
    graph.add_node("evaluate_candidate", RunnableLambda(evaluate_candidate_node))
    graph.add_node("execute_promotion", RunnableLambda(execute_promotion_node))
    graph.add_node("write_result", RunnableLambda(write_result_node))

    # Set entry point
    graph.set_entry_point("retrieve_candidates")

    # Add edges
    graph.add_edge("retrieve_candidates", "evaluate_candidate")

    # Conditional: continue evaluating or move to execution
    graph.add_conditional_edges(
        "evaluate_candidate",
        _should_continue_evaluation,
        {
            "continue": "evaluate_candidate",
            "execute": "execute_promotion",
        }
    )

    graph.add_edge("execute_promotion", "write_result")
    graph.add_edge("write_result", END)

    return graph


def _should_continue_evaluation(state: PromoteNotesState) -> str:
    """Check if more candidates need evaluation."""
    candidates = state.get("candidates", [])
    current_index = state.get("current_candidate_index", 0)

    if current_index < len(candidates):
        return "continue"
    return "execute"


def compile_promote_notes_graph(checkpoint: bool = False):
    """Compile the graph with optional checkpointing."""
    graph = create_promote_notes_graph()

    if checkpoint:
        checkpointer = MemorySaver()
        return graph.compile(checkpointer=checkpointer)

    return graph.compile()


# Main entry point

async def run_promotion(
    input_candidates: Optional[List[Dict[str, Any]]] = None,
    queue_path: Optional[str] = None,
    result_path: Optional[str] = None,
    llm: Optional[BaseChatModel] = None,
    checkpoint: bool = False,
    thread_id: Optional[str] = None,
) -> PromoteNotesState:
    """
    Run the full promotion workflow.

    Args:
        input_candidates: Pre-identified candidates (from promotionScan/promotionDispatch)
        queue_path: Path to promotion-queue.json
        result_path: Path to promotion-result.json
        llm: LLM for evaluation (optional - falls back to heuristics)
        checkpoint: Whether to use checkpointing
        thread_id: Optional thread ID required when using checkpoint persistence

    Returns:
        Final state with processed/deferred/failed lists
    """
    # Create initial state
    initial_state = PromoteNotesState(
        input_candidates=input_candidates,
        queue_path=queue_path,
        result_path=result_path,
        candidates=[],
        current_candidate_index=0,
        evaluations=[],
        processed=[],
        deferred=[],
        failed=[],
        llm=llm,
        errors=[],
    )

    # Compile and run
    graph = compile_promote_notes_graph(checkpoint=checkpoint)
    invoke_config = None
    if checkpoint:
        invoke_config = {
            "configurable": {
                "thread_id": thread_id or f"promote-notes:{datetime.now().isoformat()}",
            }
        }
    result = await graph.ainvoke(initial_state, config=invoke_config)

    return result
