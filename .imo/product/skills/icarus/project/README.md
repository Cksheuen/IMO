# Icarus React source workspace

这里提供 Icarus 的可编辑 React/TSX、样式、数据契约、共享适配层及 David 组件快照。源码于 2026-10-16 从本地开发 workspace 导入，并将组织包名和私有 npm registry 改为公共配置。

| 需要了解的能力 | 源码入口 |
| --- | --- |
| 研究工作台、页面导航、图文联动 | [ResearchWorkbench.tsx](mods/research-workbench/src/ResearchWorkbench.tsx) |
| 逻辑画板、图节点、折叠及布局 | [logic-canvas](mods/logic-canvas/src/public.ts) |
| 代码高亮、批注、符号解释 | [rich-code](mods/rich-code/src/public.ts) |
| Mock 案例、资源卡、结构化正文 | [mock-cases](mods/mock-cases/src/public.tsx)、[resource-cards](mods/resource-cards/src/public.ts)、[rich-content](mods/rich-content/src/public.tsx) |
| 原评审工作台 | [review-workbench](mods/review-workbench/src/frame.tsx)、[David App](packages/david-source/src/app/App.tsx) |
| 评论、选区、弹层、数据模型、样式 | [David components](packages/david-source/src/components)、[hooks](packages/david-source/src/hooks)、[lib](packages/david-source/src/lib)、[styles](packages/david-source/src/styles) |
| React 宿主、Portal 和本机通道适配 | [david-shared](packages/david-shared/src) |
| 默认评论内核、服务和编译器 | 上层 skill 的 `assets/runtime/` 和 `scripts/`，本 workspace 直接复用 |

在上层 skill 目录先安装运行依赖，再进入本目录验证。所有 npm 依赖由公开 registry 和锁文件提供：

```bash
# 在 Icarus skill 目录
npm ci --ignore-scripts --registry https://registry.npmjs.org
cd project
npm ci --ignore-scripts --registry https://registry.npmjs.org
npm run typecheck
npm run build
npm run check
npm test
```

`npm run build` 编译 15 个 React/TSX mod，另外两个 mod 是直接可用的 ESM 源码。可用 `npm run build -- research-workbench` 只构建指定模块。构建强制读取此仓库的 `packages/david-source` 快照，不要求本机 David 路径或私有包源。输出和构建指纹位于 `project/mods/*/dist/`，不入 Git，也不覆盖上层 `mods/` 运行包或当前机器的安装目录。

源码版本与 2026-10-13 导入的运行包分别记录在 [source-import-manifest.json](../references/source-import-manifest.json)。其中 `research-workbench` 源码为 0.2.32，既有运行包为 0.2.27；`rich-content` 源码为 0.2.16，既有运行包为 0.2.15。其余 15 个模块版本号相同；版本号相同不代表重新构建的字节必然一致。`parameter-lab` 和 `terrain-view` 本身就是已上传的可读 ESM 源码，分别位于上层 `mods/` 的同名目录。

开发时按 [模块归属规范](../references/mod-implementation.md) 的模块归属与公开入口修改。默认评论内核只有上层 skill 一份；David 快照用于离线读取与构建，不是新的独立组件实现。更新快照需从其来源同步并重算来源清单。测试夹具是通用合成数据，不包含真实业务页面、评论、令牌或用户资料。
