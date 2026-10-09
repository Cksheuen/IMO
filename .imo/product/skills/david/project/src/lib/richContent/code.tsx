import { CodeBlock } from "../../components/CodeBlock";
import type { CodeAnnotation } from "../../types/review";

/**
 * 契约代码块渲染：委托给唯一的 CodeBlock 组件（带行号、变更行高亮、注释弱化
 * 与可选 codeAnnotations 语义范围注释）。代码内容作为纯文本输出，不产生 HTML 注入。
 */
export function renderContractCodeBlock(
  codeRaw?: string,
  codeLabel?: string,
  annotations?: CodeAnnotation[],
) {
  return (
    <CodeBlock code={codeRaw} codeLabel={codeLabel} annotations={annotations} />
  );
}
