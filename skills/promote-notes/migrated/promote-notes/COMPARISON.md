# Promote Notes: Claude Code Skill vs LangChain Migration

本文档对照 CC skill `promote-notes` 与 LangChain 迁移后的实现，帮助理解迁移决策和使用方式。

## 核心概念映射

| CC Skill 概念 | LangChain 对应 | 说明 |
|--------------|----------------|------|
| Step 0: 候选 note 检索 | `scan_candidate_notes` Tool | 使用 LangChain Tool 封装检索逻辑 |
| Step 1: 晋升资格判断 | `create_eligibility_chain()` | LLM Chain 输出结构化 `PromotionEligibility` |
| Step 2: 去向决策 | `create_target_decision_chain()` | LLM Chain 输出结构化 `TargetDecision` |
| Step 3: 去重与冲突检查 | `check_existing_assets` Tool | 检索 rules/skills/memory 中的冲突 |
| Step 4: 晋升动作 | `create_rule_file`, `create_skill_file`, `update_note_status` Tools | 文件操作 Tools |
| 输出模板 | `write_promotion_result` Tool | JSON 结果文件 |

## 流程对照

### CC Skill 流程

```
Step 0: 候选 note 检索
    ↓
Step 1: 晋升资格判断
    ↓
Step 2: 去向决策
    ↓
Step 3: 去重与冲突检查
    ↓
Step 4: 晋升动作
    ↓
输出结果
```

### LangChain 迁移流程

```
retrieve_candidates_node (Step 0)
    ↓
evaluate_candidate_node (Step 1 + 2 + 3)
    ├── eligibility chain
    ├── target_decision chain
    └── check_existing_assets tool
    ↓
execute_promotion_node (Step 4)
    ├── create_rule_file / create_skill_file
    └── update_note_status
    ↓
write_result_node
```

## 工具映射

### 检索工具

| CC Tool | LangChain Tool | 功能 |
|---------|----------------|------|
| Glob + Read + Parse | `scan_candidate_notes` | 扫描 notes/ 目录，提取候选 |
| Read | `get_note_content` | 读取 note 文件内容 |
| promotion-queue.json 读取 | `check_promotion_queue` | 检查队列中的预声明候选 |

### 冲突检测工具

| CC Tool | LangChain Tool | 功能 |
|---------|----------------|------|
| Glob rules/skills/memory | `check_existing_assets` | 检查重复/冲突 |

### 文件操作工具

| CC Tool | LangChain Tool | 功能 |
|---------|----------------|------|
| Write + Edit | `create_rule_file` | 创建 rule 文件 |
| Write + Edit | `create_skill_file` | 创建 skill 目录和 SKILL.md |
| Edit | `update_note_status` | 更新 note 状态 |
| Write | `write_promotion_result` | 写结果 JSON |

## Chain 设计

### 晋升资格 Chain

```python
PROMOTION_ELIGIBILITY_PROMPT = ChatPromptTemplate.from_messages([...])

def create_eligibility_chain(llm):
    parser = JsonOutputParser(pydantic_object=PromotionEligibility)
    chain = (
        {"note_path": ..., "note_content": ...}
        | PROMOTION_ELIGIBILITY_PROMPT
        | llm
        | parser
    )
    return chain
```

**CC 对应**：Step 1 中的 "满足任意两项，才进入下一步" 逻辑，通过 LLM 结构化输出实现。

### 去向决策 Chain

```python
TARGET_DECISION_PROMPT = ChatPromptTemplate.from_messages([...])

def create_target_decision_chain(llm):
    parser = JsonOutputParser(pydantic_object=TargetDecision)
    chain = (
        {"note_content": ..., "eligibility": ..., "conflict_info": ...}
        | TARGET_DECISION_PROMPT
        | llm
        | parser
    )
    return chain
```

**CC 对应**：Step 2 中的条件表格，通过 LLM 结构化输出实现决策。

## StateGraph 设计

### State 定义

```python
class PromoteNotesState(TypedDict):
    # Input
    input_candidates: Optional[List[Dict[str, Any]]]
    queue_path: Optional[str]

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
    llm: Optional[Any]

    # Error handling
    errors: Annotated[List[str], operator.add]
```

**CC 对应**：
- `input_candidates` 对应 `promotionScan.candidates` / `promotionDispatch.candidates`
- `processed/deferred/failed` 对应输出模板中的分类

### Graph 结构

```python
def create_promote_notes_graph():
    graph = StateGraph(PromoteNotesState)

    graph.add_node("retrieve_candidates", ...)
    graph.add_node("evaluate_candidate", ...)
    graph.add_node("execute_promotion", ...)
    graph.add_node("write_result", ...)

    graph.set_entry_point("retrieve_candidates")
    graph.add_edge("retrieve_candidates", "evaluate_candidate")

    graph.add_conditional_edges(
        "evaluate_candidate",
        _should_continue_evaluation,
        {"continue": "evaluate_candidate", "execute": "execute_promotion"}
    )

    graph.add_edge("execute_promotion", "write_result")
    graph.add_edge("write_result", END)

    return graph
```

**CC 对应**：Skill 文档中的 Step 0 → Step 1 → Step 2 → Step 3 → Step 4 顺序流程。

## 使用示例

### CC Skill 使用

```
/promote-notes

# 或自动触发（Stop hook 检测到 candidate-rule）
```

### LangChain 迁移使用

```python
from migrated.promote_notes import run_promotion

# 基本使用
result = await run_promotion()

# 带预设候选
result = await run_promotion(
    input_candidates=[
        {"path": "notes/lessons/xxx.md", "signal": "candidate-rule"}
    ]
)

# 带 LLM
from langchain_anthropic import ChatAnthropic
llm = ChatAnthropic(model="claude-sonnet-4-5-20250519")

result = await run_promotion(llm=llm)

# 结果
print(f"Processed: {len(result['processed'])}")
print(f"Deferred: {len(result['deferred'])}")
print(f"Failed: {len(result['failed'])}")
```

## 关键差异

### 1. LLM 可选性

**CC Skill**：LLM 是隐式的（通过 Agent 工具调用）

**LangChain**：LLM 是可选的，无 LLM 时使用 heuristic 评估

```python
def _heuristic_evaluation(candidate, conflict_info):
    # Fallback when no LLM available
    ...
```

### 2. 结构化输出

**CC Skill**：输出格式由 Skill 文档约定，Agent 自行组织

**LangChain**：使用 Pydantic + JsonOutputParser 强制结构化

```python
class PromotionEligibility(BaseModel):
    is_eligible: bool
    criteria_met: List[str]
    criteria_missing: List[str]
    confidence: float
    reasoning: str
```

### 3. 可测试性

**CC Skill**：需要集成测试或手动验证

**LangChain**：每个 Node 和 Chain 可独立单元测试

```python
def test_eligibility_chain():
    chain = create_eligibility_chain(mock_llm)
    result = chain.invoke({...})
    assert "is_eligible" in result
```

### 4. 扩展性

**CC Skill**：修改 Skill 文档，Agent 需要理解新逻辑

**LangChain**：修改 Prompt 或添加 Node，可独立测试

## 迁移收益

| 方面 | CC Skill | LangChain |
|------|----------|-----------|
| 可测试性 | 低（集成测试） | 高（单元测试） |
| 可观测性 | 低（黑盒） | 高（State 可追踪） |
| 扩展性 | 中（修改文档） | 高（修改代码） |
| LLM 灵活性 | 隐式 | 显式可选 |
| 结构化输出 | 约定 | 强制 |

## 后续优化建议

1. **添加 Content Transform Chain**：当前简化为直接使用原始内容，可增加 LLM 生成适合目标格式的版本

2. **Conflict Merge Chain**：当前简化为跳过，可增加智能合并逻辑

3. **Checkpoint 支持**：已预留 `compile_promote_notes_graph(checkpoint=True)`

4. **Interrupt 支持**：可添加 `interrupt_before=["execute_promotion"]` 实现人工确认
