---
status: phase-1-implemented
created: 2026-04-17
owners: claude-config maintainers
related:
  - notes/research/cc-token-budget-optimization.md   # 暂未创建，见 brainstorm 上游
  - skills/freeze/SKILL.md
  - skills/metrics-weekly/SKILL.md
---

# Freeze Weekly Automation — per-host 冷集自动识别

## 问题

`skills/freeze` 元技能当前基于**启发式阈值**触发（skills > 20 / rules > 500 行 / 30 天未改），不读**真实使用数据**，且执行路径（物理 `mv` 到 `.cold-storage/`）会污染 git history，与跨设备同步天然冲突。

用户需求：

1. 自动化：周末末最后一天自动识别候选（不靠手触发）
2. 数据驱动：基于本机真实调用频次，不是启发式
3. **本地化**：不同设备使用情况不同，A 机器冻结 `docx` 不应影响 B 机器

## 核心设计冲突：per-host × 单 repo

| 维度 | 现状 | 冲突 |
|------|------|------|
| `skills/` 目录 | 入 git 白名单（`.gitignore:18-20`），全设备强同步 | 物理 `mv` 会把 deletion 推给其他设备 |
| `metrics/weekly/*.json` | 入 git 白名单（`.gitignore:72-73`），无 hostname 后缀 | 跨设备合并会互相覆盖 |
| `metrics/events/*.jsonl` | 默认忽略（`.gitignore:82`） | 天然 per-host，**可作为 analyzer 数据源** |

结论：**物理冻结方案不可行**。必须走"软性 gate"——skill 实体 100% 保留入 git，per-host 行为通过本地状态文件在 `UserPromptSubmit` 时注入 system-reminder 让 LLM 规避。

## 三层架构

```yaml
data_layer:
  source: metrics/events/<date>.jsonl         # per-host, 不入 git
  signal: hook_id == "skill-inject" && meta.matched_skills
  window: 14 天滚动窗口
  activity_gate: sessions >= 3 才出 verdict

decision_layer:
  candidates: metrics/.freeze-candidates-<hostname>-<iso_week>.json  # per-host, 不入 git
  report: metrics/reports/freeze-<hostname>-<iso_week>.md             # per-host, 不入 git
  buckets:
    zero_match: 窗口内 skill-inject 从未匹配
    cold: 匹配 1-2 次
    warm: 匹配 >= 3 次

execution_layer:
  phase_1: observation-only, 不移动/不禁用任何 skill
  phase_2: metrics/.local-frozen-<hostname>.json + UserPromptSubmit gate 注入 system-reminder
  phase_3: 跨设备共识冻结 → frontmatter `disable-model-invocation: true`（全 repo 生效）
```

## 触发链路（Phase 1 已实现）

```
SessionEnd
  └─ hooks/consolidate/session-end-consolidate.sh
       └─ hooks/consolidate/weekly-freeze-check.sh (nohup &)
            ├─ gating:
            │   - weekday == 7 (Sunday) → run
            │   - last_run_iso_week != current → run (fallback 补跑)
            │   - 否则跳过
            └─ hooks/metrics/freeze-analyzer.py --days 14
                 ├─ 扫 skills/ 全集（排除 vendor/ migrated/）
                 ├─ 读 metrics/events/ 最近 14 天 skill-inject 事件
                 ├─ 输出 per-host json + md 报告
                 └─ 仅成功时更新 marker
```

### hostname 一致性约束

analyzer（Python）和 gate（shell）必须写出同一 hostname 前缀。`hostname | tr ...` 会把尾部换行符变成 `_`，导致 `.freeze-marker-<host>_.json` 与 `.freeze-candidates-<host>.json` 前缀不匹配。

**约定**：两端统一用 `python3 -c 'import socket; print(socket.gethostname())'` 取值。shell 端保留 `hostname | tr ...` 作 python 不可用时的 fallback。

## 文件清单

### Phase 1 新增（已入 git）

```
hooks/metrics/freeze-analyzer.py             # 候选识别核心
hooks/consolidate/weekly-freeze-check.sh     # SessionEnd 挂钩 + ISO 周 gating
```

### Phase 1 修改（已入 git）

```
hooks/consolidate/session-end-consolidate.sh # 尾部追加 FREEZE_CHECK 后台调用
```

### Phase 1 运行时产物（per-host，`.gitignore` 默认忽略）

```
metrics/.freeze-marker-<hostname>.json              # ISO 周 gating 状态
metrics/.freeze-candidates-<hostname>-<week>.json   # 候选 JSON
metrics/reports/freeze-<hostname>-<week>.md         # 人类可读报告
```

### Phase 2 规划（未实现）

```
commands/freeze-apply.md 或 skills/freeze 扩展      # 用户确认入口
metrics/.local-frozen-<hostname>.json               # 本地冻结清单
hooks/skill-gate-inject.py                          # UserPromptSubmit 注入 system-reminder
settings.json UserPromptSubmit 追加挂钩
```

### Phase 3 规划（未实现）

- 跨设备共识 analyzer：聚合多机 `.freeze-candidates-*` → 连续 4 周所有机器都 zero-match 的 skill 提升为 frontmatter `disable-model-invocation: true`
- `metrics/weekly/*.json` 追加 hostname 或移出 git 白名单（解决跨机覆盖）

## 基线数据（2026-04-17 首次跑，window=14d）

```
host: CR99LJW41T
week: 2026-W16
skills_total: 30 (排除 vendor/migrated)
zero_match: 25
cold: 5 (brainstorm/orchestrate/pdf/pptx/skill-creator)
warm: 0
sessions: 56
active_enough: True
```

**观察**：

- 仅 3 个 events 文件（4/15-17），窗口 14 天但实际数据 3 天——metrics 基础设施近期启用，zero_match 偏高属正常冷启动
- `warm=0` 是样本过短的副作用。再观测 2-3 周 warm 桶应扩张
- `skill-inject` hook 的关键词覆盖面决定 `matched_skills` 准确度——若关键词过窄，`zero_match` 会误判"常用但未匹配"的 skill。Phase 2 起手前需审计 `hooks/rules-inject.py`（或 skill-inject 源）的触发词覆盖

## 设计决策记录

### D1: 为什么不用 `cron` / `launchd`？

- 依赖用户开 CC → 若设备休眠/离线错过，但用户迟早会开机
- `cron` / `launchd` 需额外系统配置，跨机迁移成本高
- SessionEnd 已是挂载点，新增一条后台调用成本近 0
- fallback 逻辑（上周未跑 → 本周首次补跑）兜底缺勤

### D2: 为什么 analyzer 读 `events/` 不读 `weekly/`？

- `weekly/*.json` 入 git 且不带 hostname → 跨机覆盖污染
- `events/*.jsonl` 默认忽略 → 天然 per-host
- Phase 3 若解决 weekly 冲突，analyzer 可复用，当前绕过

### D3: 为什么软性 gate 不直接改 SKILL.md frontmatter？

- `disable-model-invocation: true` 入 git → 全设备生效，与 per-host 需求冲突
- 仅在"跨机共识"情况下用（Phase 3），作为硬冻结的升级路径

### D4: 为什么 Phase 1 不落执行层？

- 观测 2-3 周候选稳定性后再动手，避免冷启动期误判
- `skill-inject` 关键词覆盖面未审计，zero_match 可能是假阳性
- 执行层需要新 hook + 新 command + 本地状态文件，变更面大，观测期先单变量验证数据层

## 已知风险

| 风险 | 触发条件 | 缓解 |
|------|----------|------|
| zero_match 假阳性 | skill-inject 关键词覆盖不足 | Phase 2 前审计 `skill-inject` 触发词 |
| marker 丢失 | 磁盘损坏/误删 | 下次 Sunday 或新周首次自动重建 |
| 两端 hostname 不一致 | python3 缺失 + hostname 特殊字符 | shell fallback + `tr -d '\n'` |
| SessionEnd 后 CC 进程被杀 | 后台 analyzer 未跑完 | 重跑幂等（同周 marker 已 set 会跳，未 set 会重跑） |
| 用户周日 + 下周一都没开 CC | 连续两周缺勤 | 冷启动下次开机自动补跑一次最近窗口 |

## Phase 2 进入条件

以下全部满足后才启动 Phase 2：

- [ ] 连续 3 次 weekly 报告，zero_match 名单交集稳定（候选列表不再剧烈变化）
- [ ] 审计 `hooks/rules-inject.py` 或 skill-inject 源，确认关键词覆盖 ≥ 80% 的 skill
- [ ] 验证候选名单里无"正在使用但未匹配"的假阳性（人工抽检 5 个）
- [ ] `settings.json` UserPromptSubmit 剩余 hook slot 可用（当前只挂了 caveman-inject）

## 相关引用

- `skills/freeze/SKILL.md` — 原 freeze 元技能定义（启发式触发）
- `skills/thaw/SKILL.md` — 解冻配套
- `hooks/metrics/emit.py` — 事件 emit 层
- `hooks/metrics/aggregate.py:109-168` — 当前 `by_skill` 聚合来源
- `.gitignore:82-84` — 本地 metrics 数据忽略规则
