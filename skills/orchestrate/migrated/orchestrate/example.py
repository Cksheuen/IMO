"""
Example usage and tests for Orchestrate LangGraph migration.

Demonstrates how to use the migrated orchestration system.
"""
from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path
import sys
from typing import Dict, Any


def _load_runtime():
    module_path = Path(__file__).with_name("__init__.py")
    spec = importlib.util.spec_from_file_location(
        "orchestrate_migrated_runtime",
        module_path,
        submodule_search_locations=[str(module_path.parent)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load runtime from {module_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_RUNTIME_IMPORT_ERROR = None
if __package__ in (None, ""):
    try:
        _runtime = _load_runtime()
    except ModuleNotFoundError as exc:
        _runtime = None
        _RUNTIME_IMPORT_ERROR = exc
else:
    _runtime = None

if __package__ not in (None, ""):
    from .state import (
        OrchestrateState,
        create_initial_state,
        create_feature,
        create_subtask,
        DeltaContext,
    )
    from .graph import (
        create_orchestrate_graph,
        compile_orchestrate_graph,
        compile_orchestrate_graph_with_checkpoint,
        compile_orchestrate_graph_with_interrupt,
        run_orchestration,
    )
    from .nodes import execute_subtask_node
    from .verification import (
        VerificationGate,
        FixerLoop,
        run_verification_with_interrupt,
        resume_with_approval,
        get_feature_summary,
        has_pending_features,
        all_features_passed,
    )
else:
    if _runtime is not None:
        OrchestrateState = _runtime.OrchestrateState
        create_initial_state = _runtime.create_initial_state
        create_feature = _runtime.create_feature
        create_subtask = _runtime.create_subtask
        DeltaContext = _runtime.DeltaContext
        create_orchestrate_graph = _runtime.create_orchestrate_graph
        compile_orchestrate_graph = _runtime.compile_orchestrate_graph
        compile_orchestrate_graph_with_checkpoint = _runtime.compile_orchestrate_graph_with_checkpoint
        compile_orchestrate_graph_with_interrupt = _runtime.compile_orchestrate_graph_with_interrupt
        run_orchestration = _runtime.run_orchestration
        execute_subtask_node = _runtime.execute_subtask_node
        VerificationGate = _runtime.VerificationGate
        FixerLoop = _runtime.FixerLoop
        run_verification_with_interrupt = _runtime.run_verification_with_interrupt
        resume_with_approval = _runtime.resume_with_approval
        get_feature_summary = _runtime.get_feature_summary
        has_pending_features = _runtime.has_pending_features
        all_features_passed = _runtime.all_features_passed


# Example 1: Basic orchestration

async def example_basic_orchestration():
    """
    Basic example: Run a simple task through the orchestration graph.
    """
    print("=== Example 1: Basic Orchestration ===\n")

    task_description = "Implement a simple authentication feature"

    # Run orchestration
    final_state = await run_orchestration(
        task_description=task_description,
        task_id="auth-feature-demo",
        checkpoint=False
    )

    # Print results
    print(f"Task ID: {final_state['task_id']}")
    print(f"Subtasks: {len(final_state['subtasks'])}")
    print(f"Features: {len(final_state['features'])}")
    print(f"Completed: {len(final_state['completed_subtasks'])}")

    return final_state


# Example 2: Orchestration with checkpoint

async def example_checkpoint_orchestration():
    """
    Example with checkpoint support for cross-session persistence.
    """
    print("=== Example 2: Checkpoint Orchestration ===\n")

    task_description = "Refactor the database layer for better performance"

    # Run with checkpoint
    final_state = await run_orchestration(
        task_description=task_description,
        task_id="db-refactor-demo",
        checkpoint=True
    )

    # Print feature summary
    summary = get_feature_summary(final_state)
    print(f"Feature Summary: {summary}")

    return final_state


# Example 3: Interrupt-based verification

async def example_interrupt_verification():
    """
    Example with interrupt-based verification gate.

    This mimics CC's Stop hook blocking exit until verification passes.
    """
    print("=== Example 3: Interrupt-Based Verification ===\n")

    # Create initial state
    initial_state = create_initial_state(
        task_description="Add unit tests for authentication module",
        task_id="auth-tests-demo"
    )
    initial_state["user_confirmed"] = True

    # Add a feature
    feature = create_feature(
        feature_id="F001",
        description="Unit tests cover all auth functions",
        acceptance_criteria=[
            "Test coverage > 80%",
            "All edge cases tested",
        ],
        verification_method="unit"
    )
    initial_state["features"].append(feature)

    # Create and compile graph
    graph = compile_orchestrate_graph_with_interrupt()

    # Run with interrupt
    thread_id = "auth-tests-thread"
    result = await run_verification_with_interrupt(graph, initial_state, thread_id)

    print(f"State after interrupt: {result.get('__interrupt__')}")

    # Simulate external approval
    approved_state = await resume_with_approval(
        graph,
        thread_id,
        approved=True,
        feature_results={"F001": True}
    )

    print(f"All features passed: {all_features_passed(approved_state)}")

    return approved_state


# Example 4: Fixer loop

async def example_fixer_loop():
    """
    Example demonstrating the fixer loop mechanism.

    Shows how failed features trigger the fixer loop.
    """
    print("=== Example 4: Fixer Loop ===\n")

    # Create state with a failed feature
    state = create_initial_state(
        task_description="Fix the failing login tests",
        task_id="fix-login-tests"
    )

    # Add a failed feature
    feature = create_feature(
        feature_id="F001",
        description="Login tests pass",
        acceptance_criteria=["All tests pass"],
        verification_method="unit",
        max_attempts=3
    )
    feature["passes"] = False
    feature["attempt_count"] = 1
    feature["delta_context"] = {
        "problem_location": {
            "file": "tests/auth/login.test.ts",
            "lines": "45-52",
            "code_snippet": "expect(token).toBeValid()",
        },
        "root_cause": "Token validation mock not configured",
        "fix_suggestion": {
            "action": "add_parameter",
            "target": "mock configuration",
            "details": "Add token validation mock",
            "reference_example": "tests/auth/setup.ts",
        },
        "files_to_read": ["tests/auth/login.test.ts"],
        "files_to_skip": [],
    }
    state["features"].append(feature)

    # Check verification gate
    gate = VerificationGate(max_attempts=3)
    fixer_loop = FixerLoop(max_iterations=3)
    gate_result = gate.check(state)

    print(f"Gate blocked: {gate_result.get('block')}")
    print(f"Action needed: {gate_result.get('action')}")
    print(f"Reason: {gate_result.get('reason')}")

    # Get next feature to fix
    next_feature_id = fixer_loop.get_next_feature_to_fix(state)
    print(f"Next feature to fix: {next_feature_id}")

    return state


# Example 5: Parallel subtask execution simulation

async def example_parallel_execution():
    """
    Example showing parallel subtask execution pattern.

    In CC, this would use asyncio.gather or parallel nodes.
    """
    print("=== Example 5: Parallel Execution ===\n")

    # Create state with multiple independent subtasks
    state = create_initial_state(
        task_description="Implement frontend, backend, and database layers",
        task_id="full-stack-feature"
    )

    # Add parallel subtasks
    state["subtasks"] = [
        create_subtask(
            subtask_id=1,
            description="Implement database schema",
            agent_type="implementer",
            files_to_modify=["prisma/schema.prisma"],
            files_to_read=[],
            dependencies=[]
        ),
        create_subtask(
            subtask_id=2,
            description="Implement API endpoints",
            agent_type="implementer",
            files_to_modify=["src/api/routes.ts"],
            files_to_read=[],
            dependencies=[]  # Independent of subtask 1 for demo
        ),
        create_subtask(
            subtask_id=3,
            description="Implement frontend components",
            agent_type="implementer",
            files_to_modify=["src/components/Feature.tsx"],
            files_to_read=[],
            dependencies=[1, 2]  # Depends on 1 and 2
        ),
    ]

    # Mark some as complete
    state["subtasks"][0]["status"] = "complete"
    state["subtasks"][1]["status"] = "complete"

    # Check if subtask 3 is ready
    subtask_3 = state["subtasks"][2]
    deps_satisfied = all(
        state["subtasks"][dep - 1].get("status") == "complete"
        for dep in subtask_3["dependencies"]
    )

    print(f"Subtask 3 dependencies satisfied: {deps_satisfied}")

    return state


# Example 6: Dynamic model routing for subtasks

async def example_dynamic_model_routing():
    """
    Example showing how orchestrate can route different subtask types
    to different models through the migrated multi-model runtime.
    """
    print("=== Example 6: Dynamic Model Routing ===\n")

    state = create_initial_state(
        task_description="Research, implement, and review a new feature",
        task_id="dynamic-model-routing-demo"
    )
    state["user_confirmed"] = True
    state["subtasks"] = [
        create_subtask(
            subtask_id=1,
            description="Research the API options and summarize tradeoffs",
            agent_type="researcher",
            files_to_modify=[],
            files_to_read=["docs/api.md"],
            dependencies=[],
        ),
        create_subtask(
            subtask_id=2,
            description="Implement the selected API integration",
            agent_type="implementer",
            files_to_modify=["src/api/client.ts"],
            files_to_read=["src/api/client.ts"],
            dependencies=[1],
        ),
        create_subtask(
            subtask_id=3,
            description="Review the integration changes for correctness",
            agent_type="reviewer",
            files_to_modify=[],
            files_to_read=["src/api/client.ts"],
            dependencies=[2],
        ),
    ]

    state = {
        **state,
        **(await execute_subtask_node(state)),
    }
    first = state["subtasks"][0]
    print(f"Subtask 1 -> model: {first['recommended_model']}")
    print(f"Routing summary: {first['routing_reason']}")

    state = {
        **state,
        **(await execute_subtask_node(state)),
    }
    second = state["subtasks"][1]
    print(f"Subtask 2 -> model: {second['recommended_model']}")

    state = {
        **state,
        **(await execute_subtask_node(state)),
    }
    third = state["subtasks"][2]
    print(f"Subtask 3 -> model: {third['recommended_model']}")

    return state


# Test functions

def test_state_creation():
    """Test state creation functions."""
    state = create_initial_state("Test task", "test-001")

    assert state["task_id"] == "test-001"
    assert state["task_description"] == "Test task"
    assert len(state["features"]) == 0
    assert len(state["subtasks"]) == 0
    print("✓ test_state_creation passed")


def test_feature_creation():
    """Test feature creation."""
    feature = create_feature(
        feature_id="F001",
        description="Test feature",
        acceptance_criteria=["Criterion 1"],
        verification_method="manual"
    )

    assert feature["id"] == "F001"
    assert feature["passes"] is None
    assert feature["attempt_count"] == 0
    print("✓ test_feature_creation passed")


def test_subtask_creation():
    """Test subtask creation."""
    subtask = create_subtask(
        subtask_id=1,
        description="Test subtask",
        agent_type="implementer",
        files_to_modify=["test.ts"],
        files_to_read=["config.ts"],
        dependencies=[]
    )

    assert subtask["id"] == 1
    assert subtask["status"] == "pending"
    assert subtask["agent_type"] == "implementer"
    print("✓ test_subtask_creation passed")


def test_verification_gate():
    """Test verification gate logic."""
    gate = VerificationGate(max_attempts=3)

    # No features = no block
    state = create_initial_state("Test", "test")
    result = gate.check(state)
    assert result["block"] is False

    # Pending feature = block
    feature = create_feature("F001", "Test", [])
    feature["passes"] = None
    state["features"].append(feature)
    result = gate.check(state)
    assert result["block"] is True
    assert result["action"] == "spawn_reviewer"

    print("✓ test_verification_gate passed")


def test_feature_summary():
    """Test feature summary calculation."""
    state = create_initial_state("Test", "test")

    # Add features with different states
    f1 = create_feature("F001", "Passed", [])
    f1["passes"] = True
    state["features"].append(f1)

    f2 = create_feature("F002", "Failed", [])
    f2["passes"] = False
    state["features"].append(f2)

    f3 = create_feature("F003", "Pending", [])
    state["features"].append(f3)

    summary = get_feature_summary(state)

    assert summary["total"] == 3
    assert summary["passed"] == 1
    assert summary["failed"] == 1
    assert summary["pending"] == 1

    print("✓ test_feature_summary passed")


# Main test runner

async def run_all_examples():
    """Run all examples."""
    if _RUNTIME_IMPORT_ERROR is not None:
        print(
            "Prerequisite missing for runtime example:",
            _RUNTIME_IMPORT_ERROR,
            "- install LangGraph/LangChain dependencies before running this example.",
        )
        return

    print("Running all examples...\n")

    await example_basic_orchestration()
    print()

    await example_checkpoint_orchestration()
    print()

    await example_interrupt_verification()
    print()

    await example_fixer_loop()
    print()

    await example_parallel_execution()
    print()

    print("All examples completed!")


def run_all_tests():
    """Run all unit tests."""
    print("Running unit tests...\n")

    test_state_creation()
    test_feature_creation()
    test_subtask_creation()
    test_verification_gate()
    test_feature_summary()

    print("\nAll tests passed! ✓")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        run_all_tests()
    else:
        asyncio.run(run_all_examples())
