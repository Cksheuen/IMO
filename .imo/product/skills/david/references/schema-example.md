# 完整嵌套示例

## 完整嵌套示例

```json
{
  "slug": "shooting-guide",
  "title": "拍摄指南页评审",
  "subtitle": "主问题：本轮改动如何对齐 PRD？",
  "sourcePath": "/abs/path/tech_design.md",
  "pageHtml": "<div class=\"app-phone\"><section data-component-id=\"selling-points\" data-review-target=\"selling\" data-api-field=\"ProductIdeationData.short_selling_points\"><span data-review-node-id=\"selling-1\" data-api-field=\"SellingPoint.title\">...</span></section></div>",
  "overview": {
    "title": "整体 PRD",
    "summary": "source fact：详情接口返回 short_selling_points。proposal：固定展示前三条。",
    "mapping": [
      {
        "id": "f1-top-three",
        "title": "Selling points 固定三条",
        "codePaths": ["src/components/SellingPoints.tsx"],
        "reviewBrief": { "visibleChange": "始终展示三条", "trigger": "页面加载时", "status": "已验证", "changeType": "修复" },
        "requirement": "Selling points 固定展示前三条，打开即完整可见。",
        "change": "解析 short_selling_points 后 slice(0, 3)，移除 Show more。",
        "api": {
          "summary": "详情接口以 JSON 字符串返回短卖点。",
          "fields": [
            { "name": "ProductIdeationData.short_selling_points", "type": "string", "meaning": "SellingPoint[] 的 JSON 字符串", "target": "selling" }
          ]
        },
        "trd": {
          "productDesign": {
            "positioning": "首屏即传达核心卖点，避免折叠遗漏。",
            "sections": [{ "title": "展示要点", "items": [{ "label": "展示", "text": "三条卡片纵列，间距 12px" }] }]
          },
          "technical": {
            "modules": [{ "id": "M1", "name": "SellingPoints", "change": "modify" }],
            "techPoints": [{ "title": "定长渲染", "moduleId": "M1", "bullets": ["slice(0,3) 后渲染"], "pseudoCode": "+ const points = JSON.parse(raw).slice(0, 3);", "codeLabel": "TypeScript" }]
          },
          "apiChange": {
            "head": "GetProductIdeationDetail · 关联 BE-F1-001",
            "items": [{ "beId": "BE-F1-001", "code": "struct ProductIdeationData {\n+ 1: string short_selling_points;\n}", "fields": [{ "name": "ProductIdeationData.short_selling_points", "type": "string", "meaning": "卖点 JSON", "target": "selling" }] }]
          }
        },
        "cross": { "note": "与视频卡共用同一详情响应。", "flow": ["1. 请求详情", "2. 解析卖点", "3. 渲染三条"], "edge": ["解析失败隐藏整块"] }
      }
    ]
  },
  "components": [
    {
      "id": "selling-points",
      "label": "Selling points 卡",
      "kind": "change",
      "kindLabel": "改动点 / F1",
      "interaction": "drilldown",
      "mapping": [
        {
          "id": "f1-top-three",
          "requirement": "Selling points 固定展示前三条，打开即完整可见。",
          "change": "解析 short_selling_points 后 slice(0, 3)，移除 Show more。",
          "api": { "changed": true, "summary": "详情接口以 JSON 字符串返回短卖点。" }
        }
      ],
      "evidence": ["tech_design.md F1", "src/components/SellingPoints.tsx:12"],
      "children": [
        {
          "id": "selling-1",
          "label": "首条卖点",
          "interaction": "highlight",
          "mappingIds": ["f1-top-three"],
          "deepDive": {
            "summary": ["首条卖点承载主标题与配图"],
            "codePaths": ["src/components/SellingPoints.tsx"],
            "logic": ["slice 后取 index 0 渲染"],
            "state": ["无本地状态，纯 props 驱动"],
            "edgeCases": ["字段缺失时该卡隐藏"],
            "tests": ["test:david-model 覆盖定长渲染"]
          }
        }
      ]
    }
  ]
}
```
