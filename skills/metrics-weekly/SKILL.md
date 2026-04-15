---
name: metrics-weekly
description: Generate a weekly metrics report covering the last 7 days of hook/skill/rule usage. Supports two modes — data-only (just refresh data + open dashboard) and full analysis (with AI effectiveness evaluation and optimization recommendations). Use when the user asks for `/metrics-weekly`, wants a weekly usage summary, asks about hook effectiveness over the past week, or needs configuration optimization suggestions.
---

# Metrics Weekly

Run the weekly metrics pipeline. Two modes depending on user intent.

## Mode Detection

| User intent | Mode | Steps |
|-------------|------|-------|
| "更新周报数据"、"刷新周报"、"看一下这周数据"、no extra request | **data-only** | Step 1 → 2 → 3 |
| "分析一下"、"有什么优化建议"、"哪些 hook 效果不好"、explicit analysis | **full analysis** | Step 1 → 2 → 3 → 4 → 5 |

Default to **data-only** if the user's intent is ambiguous. Only proceed to Steps 4-5 when the user explicitly requests analysis or optimization suggestions.

## Workflow

### Step 1: Aggregate weekly data

```bash
python3 ~/.claude/hooks/metrics/aggregate.py --weekly
```

This produces `~/.claude/metrics/weekly/YYYY-MM-DD.json` covering the last 7 days.

### Step 2: Render the weekly text report

```bash
python3 ~/.claude/hooks/metrics/report.py --weekly
```

This produces:
- `~/.claude/metrics/reports/latest-weekly.txt`
- `~/.claude/metrics/reports/snapshots/weekly-YYYY-MM-DD.txt`

### Step 3: Present results to user

**data-only mode ends here.** Do the following:

1. Print the text report from `~/.claude/metrics/reports/latest-weekly.txt`
2. Remind the user that the dashboard is available at:
   ```
   ~/.claude/metrics/dashboard/weekly.html
   ```
   They can open it in a browser to see interactive charts.
3. Report the JSON data path: `~/.claude/metrics/weekly/YYYY-MM-DD.json`
4. Render and open the visual dashboard:
   ```bash
   python3 ~/.claude/hooks/metrics/render_dashboard.py --weekly --open
   ```
   This opens `~/.claude/metrics/dashboard/weekly-rendered.html` in the browser.

If mode is data-only, **stop here**. Do not proceed to Steps 4-5.

---

### Step 4: Effectiveness analysis (full analysis mode only)

Based on the weekly JSON data (`~/.claude/metrics/weekly/YYYY-MM-DD.json`), analyze and report:

#### 4a. Hook 生效与价值分析

For each hook, evaluate:
- **触发频率**：周总次数、日均次数、活跃天数
- **成功率**：ok / (ok + error) 比率
- **性能开销**：avg_duration_ms 是否合理（阈值：inject 类 < 20ms, gate 类 < 5ms, recall 类 < 50ms）
- **Gate 有效性**：对于 gate 类 hook，阻断率是否合理（过高可能说明规则过严，过低可能说明 gate 形同虚设）

Reference `~/.claude/metrics/asset-catalog.yaml` to map hook_id → tags for classification.

#### 4b. 配置优化建议

Based on the analysis, provide actionable recommendations in these categories:

| Category | Trigger condition | Example recommendation |
|----------|-------------------|------------------------|
| 移除候选 | 活跃天数 = 0，或周触发 < 3 次 | 该 hook 几乎未生效，考虑移除或合并 |
| 性能优化 | avg_duration_ms 超过类别阈值 | 该 hook 耗时过高，排查逻辑或缓存策略 |
| Gate 调优 | 阻断率 > 90% 或 < 5% | 阻断率过高说明规则过严需放宽；过低说明 gate 形同虚设需评估必要性 |
| 错误修复 | error_count > 0 | 该 hook 存在失败，需排查脚本异常 |
| 覆盖补充 | 某类事件无 hook 覆盖 | 建议补充对应阶段的 hook |

#### 4c. 使用趋势判断

Based on `daily_trend`:
- 活跃度是否稳定、上升或下降
- 是否存在某天异常高/低的使用量
- 会话数变化趋势

### Step 5: Output format (full analysis mode only)

Present the full analysis to the user in Chinese, structured as:

1. 周报文本（来自 report.py 输出）
2. 生效分析（每个 hook 的有效性评估）
3. 优化建议（按优先级排列的可操作建议）
4. 趋势观察（基于每日数据的使用模式）

## GitHub Pages 发布

周报 JSON（`metrics/weekly/*.json`）和 dashboard 模板（`metrics/dashboard/weekly.html`）已加入 git 白名单。

当用户提交并 push 后，`.github/workflows/metrics-pages.yml` 会自动：
1. 扫描所有 `metrics/weekly/*.json`，生成 `weeks-index.json`
2. 部署 dashboard + 数据到 GitHub Pages

Dashboard 支持两种模式：
- **本地模式**（`file://`）：使用 `render_dashboard.py` 注入的 `/*__DATA__*/` 数据
- **线上模式**（GitHub Pages）：fetch `weeks-index.json` + 按需加载各周 JSON，顶部下拉选择器切换历史周报

## Expectations

- Treat missing event files as "no data for that day", not as a failure.
- If only 1 day of data exists, still produce the report but note the limited data range.
- Always reference concrete numbers (trigger count, success rate, duration) when making recommendations.
- Recommendations should be specific and actionable, not generic advice.
- Do not modify any hooks or configuration — this skill is read-only analysis.
