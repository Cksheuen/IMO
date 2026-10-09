# 调研校准：为什么旧版 HTML 方案不够

本文件记录本次对旧调研的校准，只保留会影响实现决策的事实。

## 已确认的本地证据

- `html-note` 是单文件知识笔记 / Artifact 发布流程，擅长来源区、主视觉、折叠证据和 Mermaid；它不是“技术方案逐组件评审器”，也没有页面元素评论的数据契约。
- `prd-to-trd/templates/plan-html-template.html` 是更直接的技术方案人审先例：它有计划来源完整性校验、交互式契约卡、打印展开和 Mermaid 降级，但内容结构仍然绑定 `plan.md`，没有页面组件与 PRD/API 三联动。
- `design-walkthrough` 解决的是 Figma/截图叠框和 `spec.json` 的功能点 1:1；它的 `tech` 面板强调完整工程信息，但“任意 HTML 元素评论”不在其职责内。

因此，新 skill 应复用三者的强项，但新增独立契约：`pageHtml + data-component-id + data-review-target + components[].mapping[]`。

## 旧调研中需要降级的结论

- “html-note 可以直接提供页面内评论”是不准确的。它只能作为视觉与发布语言参考；评论需要本地 adapter 或外部服务。
- “飞书评论 API 可以直接挂在纯静态 HTML”是不准确的。飞书评论依赖身份、文档 token 和后端代理，不能把凭证或未经验证的 API 调用嵌入 HTML。
- giscus / Hypothesis / utterances 的优缺点来自上一轮 history 中的外部调研摘要；该摘要明确记录部分 WebSearch 为空，因此它们只能作为候选方案背景，不能替代当前页面的本地评论实现。

## 采用的实现决策

1. 初始视图优先展示真实 HTML 页面，限制在 `page-frame` 中；不使用截图伪装页面。
2. 改动框通过真实 DOM 锚点计算，不把截图坐标或组件名称猜测写进模板。
3. 组件详情固定为逐行三列：PRD 需求、改动方案、接口/字段意义；接口缺口显式标记为暂缓。
4. 评论先按稳定 `data-review-target` 存在浏览器 localStorage；未来接飞书/GitHub 只替换 adapter，不改变页面锚点。

## 本次视频转化提升的事实校准

- `tech_docs/latam-video-conversion-ui/tech_design.md` 的范围包含两个页面：`product-ideation-detail`（F1/F2）和 `inspiration-detail`（F3/F4）。因此不能只生成一个“视频拆解页”预览；评审产物按页面拆成两个 HTML。
- 当前真实 Ferry 类型 `VideoTechnique` 位于 `apps/lynx/content-video-workbench-latam/src/common/api/affiliate/data/center.d.ts`，其中 `show_video_technique` 与 `all_video_technique` 声明为 `Array<TechniqueData>`；页面 `VideoSheet` 取出的是数组，而 `VideoTechniquesProps` 当前声明为单个 `TechniqueData`。这必须作为契约风险展示，不能在评审页中抹平。
- 当前 `PerformancePanel` 实际从 `VideoInspirationItem.video_counters` 读取 views/comments/likes/shares/saves；GMV 不在该 DTO 中。本轮评审将 GMV 标为契约缺口，不从其他 API 或旧 mock 猜测。
- 组件 mapping 采用唯一行 ID；渲染器拒绝缺少或重复 ID 的三联动行。模板会为未显式标注的页面元素补充稳定 DOM 路径 target，使“任意元素可评论”可验证，而不是只对少数手工标注元素开放。
