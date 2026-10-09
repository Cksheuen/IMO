# David 引擎与 Skill 维护

仅修改 canonical 的脚本、React、schema 或规范时读取；普通方案 JSON 增量不需要加载此维护链。

## 定位与租约

先从 `~/.imo/install/managed-hashes.json` 的 source_root/source_mode 定位 canonical：`<source_root>/.imo/product/skills/david`。保留既有 dirty 工作与常驻服务；package 副本默认输出 patch。

改 canonical 前执行 `python3 ~/.claude/scripts/david-lease.py acquire --intent <摘要> --session <稳定标识>`，长任务 refresh，收尾 release，异常 fail；活跃租约不抢占。test/check/build 在同一租约内串行调度。完整约束见 [HARD-GATE 27](contracts-maintenance.md#hard-gate-27)。

## 只读受影响契约

| 改动 | 规则 |
|---|---|
| 编写、schema、数据表达 | [作者与数据契约](contracts-authoring.md)；按需查 schema 路由中的类型 |
| 布局、画板、交互、基础组件 | [渲染与交互契约](contracts-ui.md)、[ui-foundation.md](ui-foundation.md) |
| 评论、框选、资料、网络 | [评论与网络契约](contracts-feedback.md) |
| 协作、上下文、测试选择 | [维护与上下文契约](contracts-maintenance.md) |

原 HARD-GATE 1–44 的编号和索引见 [contracts-index.md](contracts-index.md)，无需每次通读所有契约和验证项。

## 验证

所有 npm 命令在 `<canonical>/project` 执行。引擎代码日常修改用 `npm run test:affected`，行为变化选择对应 browser 回归；可先 `node scripts/run-tests.mjs --files <path> --list` 看范围。仅改规范核对链接、示例和条款一致性，不 build、不重渲染业务页、不跑浏览器。改上下文 CLI 验证实际提取、引用和预算边界。

引擎交付/发版运行 `npm run test:david` 与 `npm run check`；运行时代码变化先构建最新模板再跑依赖模板的回归。browser 测试隔离端口与数据，串行执行；不要停止用户常驻服务。两份 renderer 镜像保持一致。普通业务 JSON 修改只验证候选 spec 与受影响实际产物，不把每次局部改动当引擎发版。Computer Use 默认不用，启用与停止条件统一见[最小改动与验证](authoring-incremental.md#最小改动与验证)；定向回归已证明的结论不再手动重复验收。
