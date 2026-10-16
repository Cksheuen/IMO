import type { ResearchSpec } from "./schema";

/** Authoring audit across every page, including nodes outside the feedback anchor. */
export function auditFunctionFlows(spec: ResearchSpec) {
  return spec.pages.flatMap((page) =>
    page.questions.flatMap((q) =>
      [...q.graph.nodes, ...(q.dependencyGraph?.nodes ?? [])].map((node) => {
        const e = q.explanations?.[node.id];
        const gaps: string[] = [];
        const executable = !!(e?.codeIds.length || e?.transformations?.length);
        if (!e) gaps.push("缺少节点说明");
        else if (!executable) {
          if (!e.flowExclusion?.trim()) gaps.push("缺少不适用函数图的理由");
        } else {
          const graph = e.functionGraph;
          if (!graph?.nodes.length) gaps.push("缺少函数图");
          if (!e.entryFunction) gaps.push("未标识主函数");
          if (!e.transformations?.length) gaps.push("缺少输入到输出的转换");
          for (const id of e.codeIds) {
            if (!graph?.nodes.some((n) => n.id === id))
              gaps.push(`源码未纳入函数/声明图: ${id}`);
            const code = q.codes.find((c) => c.id === id);
            if (!code?.source?.trim()) gaps.push(`源码缺少来源: ${id}`);
          }
          for (const fn of graph?.nodes ?? []) {
            if (!graph?.groups?.some((g) => g.nodeIds.includes(fn.id)))
              gaps.push(`函数/声明缺少文件分组: ${fn.id}`);
          }
          for (const [i, step] of (e.transformations ?? []).entries())
            if (!step.functionIds?.length)
              gaps.push(`转换 ${i + 1} 未绑定具体函数`);
        }
        return {
          page: page.id,
          question: q.id,
          node: node.id,
          status: gaps.length ? "gap" : executable ? "covered" : "excluded",
          reason: executable ? undefined : e?.flowExclusion,
          functions: e?.functionGraph?.nodes.length ?? 0,
          gaps,
        };
      }),
    ),
  );
}
