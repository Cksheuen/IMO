# 独立 mod 开发与分发

每个 mod 独占一个目录。源码与可安装包分层：纯 ESM 目录可以直接分发；TSX 开发目录保留源码，经内置 build/pack 生成纯运行包。核心不 import mod 源码。

```text
my-mod/
  mod.json
  package.json
  index.mjs
  style.css          可选，必须在 files 白名单
```

在 `<skill>` 执行 `node scripts/mod.mjs init my-mod --out /absolute/my-mod`，得到可运行模板。修改入口默认导出的 `{id,apiVersion:1,requires:[],mount}`；id 必须与目录和清单相符。初始化工具生成的演示增强须替换成真实功能。

`mod.json` 字段：schema 固定 `icarus-mod/v1`，version 为语义版本，apiVersion 为 1；entry 是 .mjs；files 声明所有运行文件（mod.json/package.json 隐式必带）；requires 是其他 mod 的版本范围，如 `{"code-notes":"^0.1.0"}`；detect 是 `{tag,attributes:["data-..."]}` 数组，任一规则匹配即可建议启用。每条规则所有属性必须存在；不在脚本、样式或 template 内匹配。

**发布包**的 `package.json` 版本必须一致，type 为 module，files 精确包含 mod.json 和清单运行文件；不得有安装脚本、bin 或运行 npm dependencies。预打包第三方包后发布。入口内部可 import 相对 .mjs、CSS 文本、JSON、图片/字体数据 URL；循环 ESM、裸包 import、import.meta 与计算式动态 import 必须先由作者构建成自包含模块。无代码执行的检测、校验和打包不能保证 mod 代码善意；仅使用可信来源。

```bash
icarus mod validate /absolute/my-mod
icarus mod pack /absolute/my-mod --out /absolute/my-mod.zip
icarus mod install /absolute/my-mod.zip
icarus mod enable /absolute/source.html --mods my-mod
icarus mod disable /absolute/source.html --mods my-mod
```

安装位置默认 `~/.icarus/mods/my-mod`，改变内容须先升版本，再 `install --replace`。同版本同内容重复安装无副作用；失败时旧目录保留。支持一个外层文件夹或无外层文件夹的 ZIP，以及 npm .tgz；拒绝路径穿越、超限、tar 链接、未声明 import、错误版本、重复成员和多份清单。

安装时从本地 workspace 或固定 catalog 补齐缺失依赖，离线 ZIP 可先安装依赖 ZIP。依赖按版本范围校验后拓扑装载，循环或不兼容在页面副作用前报错；清单 requires 的 id 顺序须与入口 feature.requires 一致。不能卸载仍被其他 mod 依赖的模块。修改文件不会偷偷替换正在运行的代码；再次 enable 生成新版本计划后才热更新。

自动使用仅匹配已安装及仓库自带模块。recommend 同时提示 catalog 中匹配但未安装的模块，Agent 可安装可信目录 id 后 enable --auto。未知显式 id 报安装提示。对于新包，先 `install /path/mod.zip` 或 `install @scope/name@1.2.3 --registry <URL>`，即可加入后续推荐与加载，不需修改核心白名单。

在仓库贡献新 mod：

```bash
icarus mod contribute /absolute/my-mod --repo /absolute/icarus-workspace --stage
```

命令验证源码、复制到 `plugins/icarus/mods/my-mod`、重建两份目录索引、离线刷新 Icarus workspace 锁文件，并只暂存这些路径。更新已存在的 mod 用 --replace 与新版本。先评审暂存差异，再走仓库已有 commit/push/MR 流程；工具不自动上传。仓库外不能运行 contribute，不能改其他 Skill。

npm 发布和安装：

```bash
icarus mod publish /absolute/my-mod
# 获得发布授权后才执行：
icarus mod publish /absolute/my-mod --execute
# 仅在你自己的公开包已发布后，以实际包名安装：
icarus mod install @your-scope/icarus-mod-my-mod@0.1.0
```

registry 默认为 `https://registry.npmjs.org`，可以显式覆盖。账号与凭据由 npm 用户配置持有，不写进 mod/HTML。目录 id 安装会验证随 Skill 发布的完整性摘要；作者更新 mod 后必须更新 catalog 并发布新 Skill 目录版本，不能复用旧版本号。

React island 的宿主适配在原 HTML 自有脚本中注册：`window.icarusAdapters = {'react-island': {React, createRoot, component: RealComponent, props: {...}, selector:'[data-icarus-component]'}}`。核心不下载 React，mod 卸载销毁 React root 并恢复宿主容器；宿主未提供适配时明确失败，评论继续工作。

## TSX 开发与构建

```text
my-mod/
  mod.json
  package.json
  src/index.tsx
  src/theme.css
  src/NOTICE.txt       可选第三方许可证，会保留在发布代码
  dist/index.mjs      构建生成，唯一运行文件
  dist/build.json     源码/产物指纹，仅开发目录保存
```

开发 package 可有 scripts/devDependencies，并增加 `"icarusBuild":{"entry":"src/index.tsx","sharedReact":true}`；mod.json 声明 `"entry":"dist/index.mjs","files":["dist/index.mjs"],"requires":{"react-runtime":"^0.1.0"}`。入口仍导出 feature，React root 在 mount 创建、在 onCleanup 销毁；作者的脚本不会由内置构建器或安装器执行。构建器将 React imports 变为共享模块引用，CSS 按 `[data-icarus-david-root="my-mod"]` 限定范围，作者需为自己的挂载容器设置此属性，并在 style 元素中注入构建常量 `ICARUS_CSS`。

```bash
icarus mod build /absolute/my-mod
icarus mod validate /absolute/my-mod
icarus mod pack /absolute/my-mod --out /absolute/my-mod.zip
icarus mod contribute /absolute/my-mod --repo /absolute/marketplace --stage
```

pack/publish/release 都剔除开发元数据、源码和构建记录，只保留 mod.json、规范化 package.json、dist/index.mjs。不要直接对开发目录运行 npm publish 或用文件管理器压缩后作为运行包安装。源码/产物指纹不一致时必须重新 build；不能把旧 dist 当最新版本。

contribute 对 TSX 目录保留 src、清单、开发 package、可选 README/LICENSE/tsconfig，并在目标 workspace 重新构建与比较运行包指纹。可复现构建失败会恢复该 mod 原目录；不执行 npm 安装脚本。自定义 source 依赖需由目标 workspace 提供。仓库内 David mod 共享 `packages/david-shared` 与少量兄弟模块组件源码；其发布包已把这些实现编译进去，ZIP 安装无需该源码树。

高级：`icarusBuild.sharedModules` 可以把某个相对源码路径映射到提供者 mod id，例如工作台将字段通道映射为 `api-contracts`，避免出现两份有状态的事件处理器。提供者入口需导出对应符号，并在 requires 声明版本；运行时只解析已声明的 `icarus:<id>` 引用。一般第三方 mod 只需 sharedReact。
