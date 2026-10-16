const question = (id, title) => ({
  id,
  title,
  answer: "研究结论与可验证的实现行为。",
  findings: ["展示条件与 Mock 位于同一个问题。"],
  graph: {
    nodes: [
      {
        id: id + ":input",
        label: "输入",
        description: ["读取明确的请求数据。"],
        column: 0,
        row: 0,
      },
      {
        id: id + ":output",
        label: "输出",
        description: ["根据校验结果显示内容。"],
        column: 0,
        row: 1,
      },
    ],
    edges: [{ from: id + ":input", to: id + ":output" }],
  },
  dependencyGraph: {
    nodes: [
      {
        id: id + ":file",
        label: "source.ts",
        column: 0,
        row: 0,
        description: ["实现条件判断的源码文件。"],
      },
    ],
    edges: [],
  },
  nodeCode: { [id + ":input"]: id + "-code", [id + ":file"]: id + "-code" },
  codes: [
    {
      id: id + "-code",
      title: "条件判断",
      language: "JavaScript",
      code: "const visible = Boolean(prompt);\nreturn visible;",
      annotations: [
        {
          startLine: 1,
          endLine: 1,
          title: "显示条件",
          bullets: ["根据对象存在与否显示。"],
        },
      ],
    },
  ],
  evidence: [],
});
export const research = {
  schema: "icarus-research/v1",
  slug: "research-portable-fixture",
  title: "研究工作台回归",
  pages: [
    {
      id: "pmp",
      label: "入口与 Mock",
      questions: [
        question("entry", "问题卡片如何展示，怎样 Mock 验证？"),
        question("routing", "点击后进入哪里？"),
      ],
    },
    {
      id: "chat",
      label: "对话框架",
      questions: [
        question("chat", "怎样管理会话？"),
        question("runner", "怎样执行？"),
        question("blocks", "怎样渲染？"),
      ],
    },
    {
      id: "rds",
      label: "关系数据库",
      questions: [
        question("rds", "数据库是什么？"),
        question("storage", "保存什么？"),
      ],
    },
    {
      id: "faas",
      label: "函数执行",
      questions: [
        question("faas", "如何运行？"),
        question("infra", "如何触发？"),
      ],
    },
  ],
};
research.pages[0].questions[0].cases = [
  {
    id: "v2",
    label: "首屏",
    note: "最小有效请求",
    payload: { prompt: { text: "What are some trending products?" } },
    previewHtml: "<p>What are some trending products?</p>",
  },
  {
    id: "feeds",
    label: "翻页",
    note: "分页请求",
    payload: { prompt: { text: "What are some trending products?" } },
    previewHtml: "<p>What are some trending products?</p>",
  },
  {
    id: "missing",
    label: "无 prompt",
    note: "不显示卡片",
    payload: {},
    previewHtml: "<p>不显示卡片</p>",
  },
  {
    id: "empty",
    label: "空文案",
    note: "仍显示 CTA",
    payload: { prompt: { text: "" } },
    previewHtml: "<p>Ask</p>",
  },
];

// A compact but tall import graph catches pointer focus scrolling that can
// move a node between pointerdown and pointerup when the code pane grows.
const routing = research.pages[0].questions[1];
routing.dependencyGraph = {
  nodes: Array.from({ length: 20 }, (_, i) => ({
    id: i === 0 ? "routing:file" : "routing:dependency-" + i,
    label: i === 0 ? "entry.ts" : "dependency-module-" + i,
    description: [i === 0 ? "入口源码。" : "直接导入的上下文模块 " + i],
    column: i % 3,
    row: Math.floor(i / 3),
  })),
  edges: Array.from({ length: 19 }, (_, i) => ({
    from: "routing:file",
    to: "routing:dependency-" + (i + 1),
  })),
};

// Explicit node ownership coexists with older nodeCode-only questions.
const display = research.pages[0].questions[0];
display.explanations = {
  "entry:input": {
    title: "读取请求",
    layer: "frontend",
    inputs: ["prompt"],
    outputs: ["visible"],
    summary: "计算对象存在性。",
    codeIds: ["entry-code"],
    cases: display.cases,
  },
  "entry:output": {
    title: "渲染结果",
    layer: "frontend",
    inputs: ["visible"],
    outputs: ["UI"],
    summary: "消费显示状态。",
    codeIds: [],
  },
  "entry:file": {
    title: "模块引用",
    layer: "contract",
    inputs: ["模块入口"],
    outputs: ["导出函数"],
    summary: "记录模块职责。",
    codeIds: [],
  },
};
delete display.cases;
delete display.nodeCode;

display.explanations["entry:input"].contracts = {
  inputs: {
    language: "TypeScript",
    code: "type Input = { prompt?: { text?: string } };",
    annotations: [
      {
        startLine: 1,
        endLine: 1,
        title: "prompt 的可选类型",
        bullets: ["接口可以不返回推荐对象。"],
      },
    ],
  },
  outputs: {
    language: "TypeScript",
    code: "type Output = { visible: boolean };",
    annotations: [
      {
        startLine: 1,
        endLine: 1,
        title: "visible 的布尔类型",
        bullets: ["是否显示卡片。"],
      },
    ],
  },
};

// Resource and type definitions use the same code renderer and stable anchors.
display.highlights = [
  {
    kind: "business-rule",
    label: "Business rule",
    tone: "blue",
    tokens: ["Boolean(prompt)"],
  },
];
display.explanations["entry:input"].contracts.inputs.code =
  "type Input = { prompt?: Prompt };\n\n// 定义来源：/workspace/types/prompt.ts:12\ntype Prompt = { text?: string };";
display.targetAliases = {
  "code:entry-definition": "contract:entry:input:inputs",
};
display.explanations["entry:output"].resource = {
  kind: "config",
  title: "Configuration",
  description: "A separately configured data dependency.",
  fields: [{ label: "Key", value: "entry.enabled" }],
  notice: "Local test fixture.",
  href: "https://example.com/config/entry-enabled",
  linkLabel: "打开配置页面",
};

// Function drilldown shares the original canvas and renders source line numbers.
display.codes[0].lineNumbers = [120, 121];
display.codes.push({
  id: "entry-helper",
  title: "normalizePrompt",
  language: "JavaScript",
  source: "/workspace/helpers.ts:500",
  code: "function normalizePrompt(value) {\n  return value.trim();\n}",
  lineNumbers: [500, 501, 502],
  annotations: [
    {
      startLine: 2,
      endLine: 2,
      title: "Trim input",
      bullets: ["Remove surrounding whitespace."],
    },
  ],
});
display.explanations["entry:input"].codeIds.push("entry-helper");
display.explanations["entry:input"].functionGraph = {
  nodes: [
    {
      id: "entry-code",
      label: "isVisible",
      description: ["Resolve visibility."],
      column: 0,
      row: 0,
    },
    {
      id: "entry-helper",
      label: "normalizePrompt",
      description: ["Normalize the prompt."],
      column: 1,
      row: 0,
    },
  ],
  edges: [
    { from: "entry-code", to: "entry-helper", kind: "control", label: "call" },
  ],
  groups: [
    { id: "entry-file", label: "entry.ts", nodeIds: ["entry-code"] },
    { id: "helper-file", label: "helpers.ts", nodeIds: ["entry-helper"] },
  ],
};
display.explanations["entry:input"].resource = {
  ...display.explanations["entry:output"].resource,
  afterCodeId: "entry-code",
};
delete display.explanations["entry:output"].resource;
