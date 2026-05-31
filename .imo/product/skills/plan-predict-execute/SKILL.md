---
name: plan-predict-execute
description: Use when the user asks to formulate a plan and implement it, asks for "方案->预测->优化", "循环制定方案", "制定完整方案后执行", "总任务和多级子任务", or wants the agent to predict implementation defects before execution. Runs a bounded plan -> defect prediction -> plan optimization loop, then hands off to the existing task/orchestration workflow.
description_zh: "当用户要求制定方案并执行、方案->预测->优化、循环制定方案、制定总任务和多级子任务，或希望执行前预测落地缺陷时使用。先做有边界的方案、缺陷预测、方案优化循环，再接入现有任务/编排流程执行。"
---

# Plan Predict Execute

Turn a vague "make a plan and implement it" request into a checked, executable plan before writing code.

## When To Use

Use this skill when the user asks for any of these patterns:

- "制定方案并执行"
- "方案 -> 预测 -> 优化"
- "循环制定完整方案"
- "预测完成后可能有什么问题"
- "制定总任务和多级子任务"
- "先整理上下文，然后并行/编排实现"
- "plan, predict defects, optimize, then implement"

Do not use it for:

- Pure Q&A or concept explanation
- A tiny edit where the user explicitly asks to skip planning
- Urgent debugging where the first priority is restoring service
- Plan-only requests where the user only wants a written plan

## Core Principle

Plan quality is judged by predicted failure modes, not by plan length.

The loop must stay bounded: run at most 3 iterations, and stop earlier when the remaining defects are low-value, speculative, or already mitigated.

## Workflow

### Step 1: Classify The Request

Decide which mode applies:

| Mode | Meaning | Action |
|------|---------|--------|
| Plan only | User asks for a plan, design, or analysis | Stop after the optimized plan |
| Plan then execute | User asks to plan and implement | Continue into the execution workflow |
| Plan then confirm | User asks for confirmation before work | Ask once after the optimized plan |

If the repo already has a task system such as Trellis, follow that system. This skill shapes the planning loop; it does not replace task creation, PRD, context loading, implementation, review, or commit rules.

### Step 2: Gather Context

Collect only context that can change the plan:

- Current user goal and constraints
- Relevant task or PRD files
- Existing local patterns and neighboring code
- Known tests, commands, and verification gates
- Prior decisions from rules, specs, memories, or project profiles when already available

Avoid broad repository scans unless the task scope requires them.

### Step 3: Draft Plan V1

Write a concrete plan with:

- Goal
- Assumptions
- Out of scope
- Workstreams or task tree
- Files or modules likely affected
- Verification strategy

For complex work, express the hierarchy as:

```text
Total task
  - Child task 1
  - Child task 2
  - Child task 3
```

### Step 4: Predict Landing Defects

Review the plan as if it has already been implemented and ask:

- What could still be wrong after completion?
- Which layer boundary could break?
- Which tests could pass while behavior is still wrong?
- Which existing convention might the plan violate?
- Which part could create unnecessary defensive code or abstraction?
- Which step is underspecified enough that an implementer could make the wrong call?

Keep the prediction concrete. Each risk should point to a plan step, module, interface, test gap, or operational failure mode.

### Step 5: Optimize The Plan

Revise the plan to remove or mitigate the predicted defects.

Use this loop:

```text
plan_vN -> predicted_defects -> optimized_plan_vN+1
```

Exit when one of these is true:

- No material new defects are found
- Remaining defects are accepted tradeoffs
- The loop has run 3 times
- The next improvement would be more expensive than the risk it removes

### Step 6: Choose Execution Shape

Before implementation, decide whether the work should be direct or delegated:

| Condition | Execution shape |
|-----------|-----------------|
| 1-2 files, simple dependency chain | Main agent executes directly |
| 3+ files, 2+ domains, or user says "并行/orchestrate" | Use the orchestration workflow |
| Investigation-only bounded role | Consider a custom reviewer/researcher subagent |
| Existing Trellis task is active | Continue from the current Trellis phase |

Do not spawn agents just because a plan exists. Delegate only when the work has separable ownership, clear acceptance criteria, and a real context benefit.

### Step 7: Execute And Verify

When execution is requested:

- Load the required project/task guidelines before editing.
- Keep changes scoped to the optimized plan.
- Run the planned verification commands.
- If verification reveals a plan defect, update the plan before retrying.
- Summarize what was implemented, what was verified, and what risk remains.

## Output Shape

Use a compact structure:

```markdown
## Context
- ...

## Plan v1
- ...

## Predicted Defects
- ...

## Optimized Plan
- ...

## Task Tree
- ...

## Execution
- Mode: direct / orchestrated / plan-only / confirm-first
- Next step: ...
```

For small tasks, collapse sections and keep only the useful parts.

## Anti-Patterns

| Anti-pattern | Correct behavior |
|--------------|------------------|
| Infinite planning loop | Stop after 3 iterations or no material improvements |
| Long abstract plan with no defect prediction | Predict concrete failure modes tied to the plan |
| Planning replaces task workflow | Use Trellis/other workflow for task state and verification |
| Delegating without ownership boundaries | Delegate only with clear file/module ownership |
| Implementing after a plan-only request | Stop at the optimized plan |
| Expanding scope during optimization | Record out-of-scope findings separately |

## Checklist

- [ ] Did I identify plan-only vs plan-and-execute?
- [ ] Did I gather only context that can change the plan?
- [ ] Did I predict concrete landing defects?
- [ ] Did I optimize the plan based on those defects?
- [ ] Did I stop the loop with an explicit exit reason?
- [ ] Did I choose direct vs orchestration based on task shape?
- [ ] Did I preserve existing workflow rules for implementation and verification?
