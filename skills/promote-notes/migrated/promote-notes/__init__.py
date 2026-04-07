"""
Promote Notes LangChain Migration

Migrated from CC skill promote-notes to LangGraph StateGraph.

Usage:
    from migrated.promote_notes import run_promotion

    # Basic usage (heuristic evaluation)
    result = await run_promotion()

    # With pre-identified candidates
    result = await run_promotion(
        input_candidates=[
            {"path": "notes/lessons/xxx.md", "signal": "candidate-rule"}
        ]
    )

    # With LLM for evaluation
    from langchain_anthropic import ChatAnthropic
    llm = ChatAnthropic(model="claude-sonnet-4-6-20250519")
    result = await run_promotion(llm=llm)
"""

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
    PromotionEligibility,
    TargetDecision,
    create_eligibility_chain,
    create_target_decision_chain,
    create_content_transform_chain,
    create_promotion_evaluation_chain,
    evaluate_note_for_promotion,
)

from .promoter import (
    PromoteNotesState,
    retrieve_candidates_node,
    evaluate_candidate_node,
    execute_promotion_node,
    write_result_node,
    create_promote_notes_graph,
    compile_promote_notes_graph,
    run_promotion,
)

__all__ = [
    # Tools
    "NoteCandidate",
    "PromotionDecision",
    "ConflictInfo",
    "PROMOTE_NOTES_TOOLS",
    "scan_candidate_notes",
    "get_note_content",
    "check_promotion_queue",
    "check_existing_assets",
    "create_rule_file",
    "create_skill_file",
    "update_note_status",
    "write_promotion_result",
    # Chain
    "PromotionEligibility",
    "TargetDecision",
    "create_eligibility_chain",
    "create_target_decision_chain",
    "create_content_transform_chain",
    "create_promotion_evaluation_chain",
    "evaluate_note_for_promotion",
    # Promoter
    "PromoteNotesState",
    "retrieve_candidates_node",
    "evaluate_candidate_node",
    "execute_promotion_node",
    "write_result_node",
    "create_promote_notes_graph",
    "compile_promote_notes_graph",
    "run_promotion",
]
