"""
Chain definitions for Promote Notes LangChain migration.

Implements:
1. Promotion eligibility chain
2. Target decision chain
3. Main promotion workflow chain
"""

from typing import Dict, Any, List, Optional
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser, StrOutputParser
from langchain_core.runnables import RunnableLambda, RunnablePassthrough
from pydantic import BaseModel, Field

from .tools import (
    NoteCandidate,
    PromotionDecision,
    ConflictInfo,
)


# Pydantic models for structured output

class PromotionEligibility(BaseModel):
    """Result of promotion eligibility check."""
    is_eligible: bool = Field(description="Whether the note is eligible for promotion")
    criteria_met: List[str] = Field(description="List of criteria that are met")
    criteria_missing: List[str] = Field(description="List of criteria that are missing")
    confidence: float = Field(description="Confidence level 0.0-1.0")
    reasoning: str = Field(description="Explanation of the decision")


class TargetDecision(BaseModel):
    """Result of target location decision."""
    target: str = Field(description="Target location: rules, skills, memory, or notes")
    reasoning: str = Field(description="Explanation for the target choice")
    file_name_suggestion: Optional[str] = Field(description="Suggested file name if promoted")


# Chain 1: Promotion Eligibility Chain

PROMOTION_ELIGIBILITY_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are an expert at evaluating knowledge assets for promotion readiness.

Your job is to determine if a note in the notes/ directory has reached sufficient
stability to be promoted to a more structured knowledge format (rules/, skills/, memory/).

## Promotion Criteria

A note is eligible for promotion if it meets at least 2 of these criteria:

1. **Reuse Evidence**: The same topic has been reused across multiple tasks
2. **Clear Trigger**: There are well-defined conditions for when to apply this knowledge
3. **Stable Steps**: There are clear, tested execution steps
4. **Decision Framework**: There's a reusable decision-making structure
5. **Cross-task Pattern**: The pattern has appeared in different tasks

## Anti-patterns (should NOT promote)

- Note is primarily explanatory/background (stays in notes/)
- Heavily dependent on a single case study
- Trigger conditions are vague or missing
- No clear actionable steps

## Input Format

You will receive:
- Note content
- Metadata (reuse count, has trigger, has steps)

## Output Format

Return a JSON object with:
- is_eligible: boolean
- criteria_met: list of criteria that are satisfied
- criteria_missing: list of criteria not satisfied
- confidence: float between 0.0 and 1.0
- reasoning: explanation of the decision
"""),
    ("human", """Evaluate this note for promotion eligibility.

## Note Metadata
- Path: {note_path}
- Status: {note_status}
- Reuse Count: {reuse_count}
- Has Clear Trigger: {has_clear_trigger}
- Has Stable Steps: {has_stable_steps}

## Note Content
{note_content}

Return your evaluation as JSON.""")
])


def create_eligibility_chain(llm):
    """
    Create the promotion eligibility evaluation chain.

    This chain evaluates whether a note meets the criteria for promotion.

    Args:
        llm: The LLM to use for evaluation

    Returns:
        A chain that takes note info and returns PromotionEligibility
    """
    parser = JsonOutputParser(pydantic_object=PromotionEligibility)

    chain = (
        {
            "note_path": lambda x: x["path"],
            "note_status": lambda x: x["status"],
            "reuse_count": lambda x: x.get("reuse_count", 0),
            "has_clear_trigger": lambda x: x.get("has_clear_trigger", False),
            "has_stable_steps": lambda x: x.get("has_stable_steps", False),
            "note_content": lambda x: x.get("content", ""),
        }
        | PROMOTION_ELIGIBILITY_PROMPT
        | llm
        | parser
    )

    return chain


# Chain 2: Target Decision Chain

TARGET_DECISION_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are an expert at determining the best location for knowledge assets.

Your job is to decide where a note should be promoted to (or if it should stay in notes).

## Target Locations

| Target | Criteria |
|--------|----------|
| rules/ | Short, stable, executable, should be frequently referenced |
| skills/ | Long workflow, tool-oriented, suitable for on-demand triggering |
| memory/ | Primarily retrieval landmarks or project indexes |
| notes/ | Still explanatory or case-based, not ready for stronger constraints |

## Decision Rules

1. If it's a quick reference or decision framework → rules/
2. If it's a multi-step workflow with tools → skills/
3. If it's an index or navigation aid → memory/
4. If it's mainly context/explanation → stay in notes/

## Input

You will receive:
- Note content
- Eligibility assessment
- Conflict information

## Output

Return JSON with:
- target: "rules" | "skills" | "memory" | "notes"
- reasoning: explanation
- file_name_suggestion: suggested filename (if promoting)
"""),
    ("human", """Decide the target location for this note.

## Note Content
{note_content}

## Eligibility Assessment
{eligibility}

## Conflict Information
{conflict_info}

Return your decision as JSON.""")
])


def create_target_decision_chain(llm):
    """
    Create the target location decision chain.

    This chain decides where a promoted note should go.

    Args:
        llm: The LLM to use for decision making

    Returns:
        A chain that takes note info and eligibility, returns TargetDecision
    """
    parser = JsonOutputParser(pydantic_object=TargetDecision)

    chain = (
        {
            "note_content": lambda x: x.get("content", ""),
            "eligibility": lambda x: str(x.get("eligibility", {})),
            "conflict_info": lambda x: str(x.get("conflict_info", {})),
        }
        | TARGET_DECISION_PROMPT
        | llm
        | parser
    )

    return chain


# Chain 3: Content Transformation Chain

CONTENT_TRANSFORM_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are an expert at transforming knowledge content.

Your job is to transform a note into the appropriate format for its target location.

## Format Guidelines

### For rules/
- Keep it short and actionable
- Include: Trigger conditions, Execution steps, Decision framework
- Follow the rule template format
- Add reference links if applicable

### For skills/
- Include: Skill description, Core principles, Execution flow, Output format
- Follow the SKILL.md template format
- Make it tool-oriented and on-demand triggerable

### For memory/
- Focus on retrieval keywords and index structures
- Keep as navigation aid

## Input

You will receive:
- Original note content
- Target location
- Suggested filename

## Output

Return the transformed content in markdown format.
"""),
    ("human", """Transform this note for its target location.

## Original Note
{note_content}

## Target Location
{target}

## Suggested Filename
{file_name}

Return the transformed markdown content.""")
])


def create_content_transform_chain(llm):
    """
    Create the content transformation chain.

    This chain transforms note content to the appropriate format.

    Args:
        llm: The LLM to use for transformation

    Returns:
        A chain that transforms note content
    """
    chain = (
        {
            "note_content": lambda x: x.get("content", ""),
            "target": lambda x: x.get("target", "notes"),
            "file_name": lambda x: x.get("file_name_suggestion", "unnamed"),
        }
        | CONTENT_TRANSFORM_PROMPT
        | llm
        | StrOutputParser()
    )

    return chain


# Combined workflow chain

def create_promotion_evaluation_chain(llm):
    """
    Create the full promotion evaluation chain.

    This combines eligibility check, target decision, and content transform.

    Args:
        llm: The LLM to use

    Returns:
        A dict of chains for different stages
    """
    return {
        "eligibility": create_eligibility_chain(llm),
        "target_decision": create_target_decision_chain(llm),
        "content_transform": create_content_transform_chain(llm),
    }


# Helper function to run full evaluation

async def evaluate_note_for_promotion(
    llm,
    note_candidate: NoteCandidate,
    note_content: str,
    conflict_info: ConflictInfo
) -> Dict[str, Any]:
    """
    Run the full promotion evaluation for a single note.

    Args:
        llm: The LLM to use
        note_candidate: Note metadata
        note_content: Full note content
        conflict_info: Conflict detection result

    Returns:
        Dict with eligibility, target, and transformed content
    """
    chains = create_promotion_evaluation_chain(llm)

    # Step 1: Check eligibility
    eligibility_input = {
        **note_candidate,
        "content": note_content,
    }
    eligibility = await chains["eligibility"].ainvoke(eligibility_input)

    # If not eligible, return early
    if not eligibility.get("is_eligible", False):
        return {
            "eligibility": eligibility,
            "target_decision": None,
            "transformed_content": None,
        }

    # Step 2: Decide target
    target_input = {
        "content": note_content,
        "eligibility": eligibility,
        "conflict_info": conflict_info,
    }
    target_decision = await chains["target_decision"].ainvoke(target_input)

    # Step 3: Transform content if promoting
    transformed_content = None
    if target_decision.get("target") != "notes":
        transform_input = {
            "content": note_content,
            "target": target_decision["target"],
            "file_name_suggestion": target_decision.get("file_name_suggestion"),
        }
        transformed_content = await chains["content_transform"].ainvoke(transform_input)

    return {
        "eligibility": eligibility,
        "target_decision": target_decision,
        "transformed_content": transformed_content,
    }
