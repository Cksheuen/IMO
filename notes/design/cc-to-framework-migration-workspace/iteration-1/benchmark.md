# Benchmark Report: cc-to-framework-migration

## Summary

| Configuration | Pass Rate | Mean Duration | Tokens |
|--------------|-----------|---------------|--------|
| **with_skill** | 100% (4/4) | 151.8s | - |
| **without_skill** | 100% (4/4) | 164.2s | - |
| **Delta** | 0% | **-12.4s (7.5% faster)** | - |

## Eval: full-scan-migration

**Prompt**: 扫描我的 CC 配置，告诉我哪些适合迁移到 LangChain 框架

### with_skill (151.8s)

| Assertion | Result | Evidence |
|-----------|--------|----------|
| 生成了迁移分析报告 | ✅ | 文件存在：migration-analysis-report.md |
| 报告包含扫描结果 | ✅ | Skills: 95个、Rules: 37个、Agents: 12个 |
| 报告包含迁移价值评分 | ✅ | orchestrate 评分8、self-verification 评分8 |
| 识别出高价值迁移候选 | ✅ | 5 个高价值候选 |

### without_skill (164.2s)

| Assertion | Result | Evidence |
|-----------|--------|----------|
| 生成了迁移分析报告 | ✅ | 文件存在：migration-report.md |
| 报告包含扫描结果 | ✅ | Skills: 20个、Rules: 37个、Agents: 12个 |
| 报告包含迁移价值评分 | ✅ | orchestrate 评分9、self-verification 评分8 |
| 识别出高价值迁移候选 | ✅ | 8 个高价值候选 |

## Analysis

### Key Differences

1. **扫描范围**: with_skill 扫描了更多 skills（95 vs 20），因为 skill 明确定义了扫描路径
2. **耗时**: with_skill 快 12.4 秒（7.5%），可能因为 skill 提供了结构化的执行流程
3. **输出质量**: 两者都完成了核心任务，但 baseline 识别了更多高价值候选

### Conclusion

Skill 成功提供了结构化的迁移分析流程，两个版本都达到了 100% 通过率。Skill 版本在执行效率上略有优势。
