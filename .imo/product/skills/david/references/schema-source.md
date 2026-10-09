# 来源与渲染证据

## 事实 vs 提案

- **source fact**：来自代码/设计稿/IDL/PRD/运行证据，需可追溯（`evidence[]`、`codePaths`、契约编号 `BE-Fx-xxx`）。
- **proposal**：agent 建议；概念模式默认全部是提案，保真模式仅缺口处允许且必须显式标注。
- 契约缺口在 pageHtml 中显式展示 `契约待补` / `—`，禁止伪造字段或数据。

## 组件来源契约（HARD-GATE 28）

`components[].source`（可选）声明高保真复刻的由来，消费者据此判断「真渲染 / CSS 还原 / 概念示意」：

```json
"source": {
  "kind": "component",
  "codePaths": ["src/components/SellingPoints.tsx"],
  "probe": "grep 'SellingPoints' src/components",
  "fidelity": "pixel-vs-real"
}
```

| 字段 | 规则 |
|---|---|
| `kind` | `component \| css-art \| mockup`；必须存在 |
| `codePaths` | 字符串数组；`kind=component` 必填且非空（真实组件证据），否则校验拒绝 |
| `probe` | 复用探测方式记录（命令 / 命中断言），可省略 |
| `fidelity` | `pixel-vs-real \| structure \| approx`；`pixel-vs-real` 只允许 `kind=component`——CSS art / mockup 声称 1:1 一律校验拒绝 |

复用优先级：能探测到真实组件（path B 真渲染）绝不先写 CSS art；`css-art` 标注 `structure / approx`，禁止声称像素级 1:1。契约缺口按输入核查表向用户确认，不静默猜测。

## 真实组件来源与证据

真实组件声明必须先经过：

```bash
npm run probe:components -- review.json --out probe.json
```

`kind=component` 的 `codePaths` 必须实际存在；声明 `fidelity=pixel-vs-real` 还必须提供：

```json
"renderEvidence": {
  "recipe": "component-snapshot:product-card",
  "viewport": "393x852",
  "screenshot": "evidence/product-card.png",
  "capturedAt": "2026-09-09T06:00:00Z"
}
```

截图可由通用采集器生成：

```bash
npm run capture:evidence -- http://127.0.0.1:3000/product \
  --selector '[data-component-id="product-card"]' \
  --viewport 393x852 \
  --out evidence/product-card.png \
  --report evidence/product-card.json
```

该采集器只负责真实页面的 viewport 截图；目标项目的启动、数据注入和路由由业务项目 recipe 负责。

如果需要由 david 自动管理业务预览进程，可在 `source` 中声明 `renderRecipe`：

```json
"renderRecipe": {
  "projectRoot": "../../web-app",
  "startCommand": "pnpm dev --host 127.0.0.1 --port 4317",
  "url": "http://127.0.0.1:4317/publish",
  "selector": "[data-component-id=\"publish-form\"]",
  "viewport": "393x852",
  "readyTimeoutMs": 60000
}
```

运行：

```bash
npm run capture:component -- review.json publish-form --out evidence/
```

命令会启动 `startCommand`，等待 `url` 可访问，按 selector 截图，并在进程结束时清理启动的预览进程。`startCommand` 只应来自当前项目作者维护的 review spec，不接受远端或隐式命令注入。
