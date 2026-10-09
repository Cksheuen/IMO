import { createSsrTestServer } from "./ssr-test-server.mjs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * openQuestions（待澄清问题）独立测试（不依赖构建产物）。
 * ① parseReviewSpec 接受合法 openQuestions fixture
 * ② 非法 fixture（未知字段 / 超长 topic / 重复 id）被拒绝
 * ③ 面板有数据时 SSR 出 topic 与 PRD/设计稿两栏；无数据时整体为空。
 *    面板内容经 OpenQuestionsPanelContent 单独验证：ui/Modal 的
 *    createPortal 不支持 server renderer，壳层行为由浏览器侧覆盖。
 * 旧 spec（无 openQuestions）解析不受影响也一并回归。
 */

const server = await createSsrTestServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true },
  appType: "custom",
});

const failures = [];
const check = (name, condition) => {
  if (condition) {
    console.log(`  ok - ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL - ${name}`);
  }
};

try {
  const { parseReviewSpec } = await server.ssrLoadModule(
    "/src/lib/reviewSpec.ts",
  );
  const { OpenQuestionsPanel, OpenQuestionsPanelContent } =
    await server.ssrLoadModule("/src/components/open-questions/index.ts");

  const baseSpec = () => ({
    slug: "open-questions-test",
    title: "Open questions",
    subtitle: "待澄清校验",
    pageHtml: '<div data-component-id="c1" data-review-node-id="n1">node</div>',
    components: [
      {
        id: "c1",
        label: "C1",
        mapping: [
          {
            id: "m1",
            requirement: "r",
            change: "c",
            api: { summary: "a" },
          },
        ],
        children: [{ id: "n1", label: "N1" }],
      },
    ],
  });

  const validQuestions = () => [
    {
      id: "oq-1",
      topic: "拍摄入口放在首页还是发布页？",
      prd: "PRD 3.2：首页一级入口直达拍摄。",
      prdRef: "PRD §3.2 入口",
      design: "Figma 首页无拍摄按钮，入口出现在发布流程。",
      designRef: "Figma: Publish flow / Entry",
      conflict: "PRD 与设计稿对入口位置描述不一致。",
      options: ["保持 PRD：首页入口", "跟随设计稿：发布页入口"],
      recommendation: "建议先按首页入口实现，与增长目标一致。",
    },
    {
      id: "oq-2",
      topic: "已在数据源标记 resolved 的问题",
      status: "resolved",
      conflict: "结论已在评审会上拍板。",
    },
  ];

  console.log("== parseReviewSpec 接受/拒绝 ==");

  let parsedValid = false;
  try {
    const parsed = parseReviewSpec({
      ...baseSpec(),
      openQuestions: validQuestions(),
    });
    parsedValid =
      Array.isArray(parsed.data.openQuestions) &&
      parsed.data.openQuestions.length === 2;
  } catch (error) {
    console.error(String(error));
  }
  check("合法 openQuestions fixture 通过 parseReviewSpec", parsedValid);

  const expectRejected = (name, mutate) => {
    const spec = baseSpec();
    spec.openQuestions = [
      {
        id: "oq-bad",
        topic: "问题",
        prd: "x",
      },
    ];
    mutate(spec.openQuestions[0]);
    let rejected = false;
    try {
      parseReviewSpec(spec);
    } catch (error) {
      rejected = error instanceof Error;
    }
    check(name, rejected);
  };

  expectRejected("未知字段被拒绝", (question) => {
    question.unexpectedField = "typo";
  });
  expectRejected("超长 topic（>120）被拒绝", (question) => {
    question.topic = "字".repeat(121);
  });

  let duplicateRejected = false;
  try {
    parseReviewSpec({
      ...baseSpec(),
      openQuestions: [
        { id: "oq-dup", topic: "A" },
        { id: "oq-dup", topic: "B" },
      ],
    });
  } catch (error) {
    duplicateRejected =
      error instanceof Error && error.message.includes("重复");
  }
  check("重复 id 被拒绝", duplicateRejected);

  let legacyParsed = false;
  try {
    parseReviewSpec(baseSpec());
    legacyParsed = true;
  } catch (error) {
    console.error(String(error));
  }
  check("无 openQuestions 的旧 spec 解析不受影响", legacyParsed);

  console.log("== 面板 SSR 渲染 ==");

  const [first, second] = validQuestions();

  const html = renderToStaticMarkup(
    OpenQuestionsPanelContent({
      questions: validQuestions(),
      resolvedIds: [],
      onToggleResolved: () => {},
      onClose: () => {},
    }),
  );

  check("面板渲染出 topic", html.includes(first.topic));
  check("面板渲染 PRD 栏标签", html.includes("PRD"));
  check("面板渲染设计稿栏标签", html.includes("设计稿"));
  check(
    "面板渲染两栏对照（两个 dv-oq-source）",
    (html.match(/dv-oq-source(?!-)/g) ?? []).length >= 2,
  );
  check("面板渲染 prdRef 引用位置", html.includes(first.prdRef));
  check("面板渲染 designRef 引用位置", html.includes(first.designRef));
  check("面板渲染 conflict 区块", html.includes(first.conflict));
  check("面板渲染候选方案", html.includes(first.options[0]));
  check("面板渲染建议区块", html.includes(first.recommendation));
  check(
    "面板渲染计数标题（1 open / 1 已澄清）",
    html.includes("1 open") && html.includes("1 已澄清"),
  );
  check(
    "spec resolved 问题显示已澄清徽标",
    html.includes("已澄清") && html.includes(second.topic),
  );
  check(
    "spec resolved 问题不显示本地切换按钮",
    !html.includes(`dv-oq-toggle-${second.id}`),
  );
  check(
    "open 问题显示标记为已澄清按钮",
    html.includes(`dv-oq-toggle-${first.id}`),
  );

  // 本地 resolved 覆盖：oq-1 出现在 resolvedIds 中时显示为已澄清（2 已澄清）。
  const resolvedHtml = renderToStaticMarkup(
    OpenQuestionsPanelContent({
      questions: validQuestions(),
      resolvedIds: ["oq-1"],
      onToggleResolved: () => {},
      onClose: () => {},
    }),
  );
  check(
    "本地 resolved 覆盖计入已澄清计数（0 open / 2 已澄清）",
    resolvedHtml.includes("0 open") && resolvedHtml.includes("2 已澄清"),
  );

  // 无数据时整体为空：OpenQuestionsPanel 在 questions 缺省/空数组时直接返回 null。
  for (const empty of [undefined, []]) {
    const emptyHtml = renderToStaticMarkup(
      OpenQuestionsPanel({
        open: true,
        onClose: () => {},
        questions: empty,
        resolvedIds: [],
        onToggleResolved: () => {},
      }),
    );
    check(
      `questions=${JSON.stringify(empty)} 时面板渲染为空`,
      emptyHtml === "",
    );
  }

  // open=false 且有数据时 Modal 壳不输出内容（portal 不创建）。
  const closedHtml = renderToStaticMarkup(
    OpenQuestionsPanel({
      open: false,
      onClose: () => {},
      questions: validQuestions(),
      resolvedIds: [],
      onToggleResolved: () => {},
    }),
  );
  check("open=false 时面板不输出内容", closedHtml === "");
} finally {
  await server.close();
}

console.log("");
if (failures.length > 0) {
  console.error(`open questions 测试失败 ${failures.length} 项：`);
  for (const name of failures) console.error(`  - ${name}`);
  process.exit(1);
}
console.log("全部通过");
