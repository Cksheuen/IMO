#!/usr/bin/env node
import { createSsrTestServer } from "./ssr-test-server.mjs";
/**
 * Track markers standalone test (pure node, no build artifact).
 * - parseLine recognizes "~ "-prefixed lines as track lines (isTrack) and
 *   strips the prefix while keeping the existing "//" comment split
 * - CodeBlock renders track lines with the is-track class, collapses every
 *   consecutive track segment by default, and exposes a keyboard-focusable
 *   toggle button with aria-expanded semantics
 * - src/styles/track-mark.css exists and carries the data-track-event rules
 * Component loading goes through vite ssrLoadModule with explicit extensions.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

const server = await createSsrTestServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const { parseLine } = await server.ssrLoadModule(
    "/src/components/CodeBlock.tsx",
  );
  const { renderContractCodeBlock } = await server.ssrLoadModule(
    "/src/lib/richContent/code.tsx",
  );

  // ① "~ " lines parse as track lines with the prefix removed.
  const tracked = parseLine('~ tea("click") // 上报点击');
  assert.equal(tracked.isTrack, true, "~ 行必须识别为埋点行");
  assert.equal(tracked.isHl, false, "埋点行不能同时是高亮改动行");
  assert.equal(tracked.codePart, 'tea("click") ', "埋点行前缀 ~ 必须去除");
  assert.equal(
    tracked.commentPart,
    "// 上报点击",
    "埋点行注释解析与普通行一致",
  );
  const normal = parseLine("  return a;");
  assert.equal(normal.isTrack, false);
  assert.equal(normal.codePart, "  return a;");
  const highlighted = parseLine("+ const x = 1;");
  assert.equal(highlighted.isHl, true);
  assert.equal(highlighted.isTrack, false, "+ 行语义不被 ~ 改动");

  const code = [
    "function f() {",
    "  const a = 1;",
    '~ tea("click")',
    '~ tea("expose")',
    "  return a;",
    "}",
  ].join("\n");

  // ② Default-collapsed track segment with accessible toggle.
  const collapsedDefault = renderToStaticMarkup(
    renderContractCodeBlock(code, "TSX"),
  );
  // isTrack maps to the is-track row class (verified against the component
  // source because expanded rows are never present in collapsed SSR markup).
  const componentSrc = fs.readFileSync(
    fileURLToPath(new URL("../src/components/CodeBlock.tsx", import.meta.url)),
    "utf8",
  );
  assert.ok(
    componentSrc.includes('isTrack ? "is-track"'),
    "埋点行渲染时必须映射为 is-track class",
  );
  assert.ok(
    componentSrc.includes("trd-ln-track-badge"),
    "埋点行行尾必须渲染徽标",
  );
  assert.ok(
    componentSrc.includes("aria-expanded={isOpen}"),
    "占位条展开后 aria-expanded 必须翻转为 true",
  );

  const toggleMatch = collapsedDefault.match(
    /<button[^>]*class="trd-track-toggle"[^>]*>/,
  );
  assert.ok(toggleMatch, "折叠态必须渲染占位条 button");
  assert.ok(
    toggleMatch[0].includes('aria-expanded="false"'),
    "占位条默认 aria-expanded=false",
  );
  assert.ok(
    toggleMatch[0].includes('type="button"'),
    "占位条必须是 button 语义（可键盘聚焦）",
  );
  assert.match(
    collapsedDefault,
    /⌁ 埋点代码 2 行 · 展开/,
    "占位条文案显示段内行数与展开动作",
  );
  // Collapsed: no track line rows are emitted inside the code body.
  const bodyStart = collapsedDefault.indexOf('class="trd-cb-body"');
  const toggleIdx = collapsedDefault.indexOf("trd-track-toggle", bodyStart);
  const beforeToggle = collapsedDefault.slice(bodyStart, toggleIdx);
  assert.ok(
    !beforeToggle.includes("is-track"),
    "默认折叠时埋点行不出现在占位条之前",
  );
  assert.ok(
    !collapsedDefault.includes('data-line="3"'),
    "默认折叠时埋点行 DOM 不渲染（第 3 行）",
  );
  assert.ok(
    collapsedDefault.includes('data-line="5"'),
    "埋点段之后的普通行仍正常渲染",
  );
  assert.ok(
    collapsedDefault.includes("~ 行") && collapsedDefault.includes("默认折叠"),
    "语言条 legend 增加 ~ 行说明",
  );

  // Code without track lines keeps the highlight-only behavior.
  const plain = renderToStaticMarkup(
    renderContractCodeBlock("+ const x = 1;\n  return x;", "TSX"),
  );
  assert.ok(plain.includes("is-highlight"), "+ 行高亮行为保持不变");
  assert.ok(!plain.includes("trd-track-toggle"), "无埋点行不出现占位条");
  assert.ok(!plain.includes("默认折叠"), "无埋点行不显示 ~ 行 legend");

  // ③ track-mark.css exists and targets data-track-event.
  const cssPath = fileURLToPath(
    new URL("../src/styles/track-mark.css", import.meta.url),
  );
  assert.ok(fs.existsSync(cssPath), "src/styles/track-mark.css 必须存在");
  const css = fs.readFileSync(cssPath, "utf8");
  assert.ok(
    css.includes("[data-track-event]"),
    "track-mark.css 必须包含 [data-track-event] 规则",
  );
  assert.ok(
    /\[data-track-event\][^{]*::after/.test(css),
    "角标必须由 ::after + attr(data-track-event) 实现",
  );
  assert.ok(
    css.includes("attr(data-track-event)"),
    "角标内容必须来自 attr(data-track-event)",
  );
  assert.ok(
    css.includes("pointer-events: none"),
    "角标必须 pointer-events:none",
  );
  assert.ok(
    css.includes("prefers-reduced-motion"),
    "reduced motion 下必须去掉过渡",
  );

  console.log(
    "track markers: ~ line parsing, default collapse toggle, track-mark.css passed",
  );
} finally {
  await server.close();
}
