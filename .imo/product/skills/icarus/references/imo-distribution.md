# IMO 分发与维护

此目录接管全局 Icarus skill 的可分发运行版本，并随附 19 个已安装 mod 的完整运行包。核心修复以导入时全局安装内容为准；未从较旧开发目录覆盖。导入前文件摘要保存在 `import-manifest.json`，不保存个人目录、评论、令牌、服务状态、业务页面或安装日志。

内部 npm scope 已替换为 `@imo/`，包源改用公开 npm registry。这里的包名只用于本地元数据，不表示已经发布到 npm；核心包设为 private。目录 id 安装优先读取本目录的 mod，并校验脱敏后重新计算的完整性摘要，不依赖同名远程包。用户另装的 mod 优先于内置版本；导入不会改写已有安装或评论。

首次使用，在本目录运行 `npm ci --ignore-scripts --registry https://registry.npmjs.org`，随后执行 `npm run check` 和 `npm test`。`node scripts/cli.mjs mod list` 应能在空的 `ICARUS_MODS_DIR` 下列出全部内置 mod。使用 `ICARUS_RUNTIME_DIR` 和 `ICARUS_MODS_DIR` 隔离测试数据。

`mods/` 保留已验证的运行包，React/TSX、CSS、共享适配层和离线 David 组件快照已收录在 [project/](../project/README.md)。该 workspace 直接复用本 skill 的编译器与评论内核，没有第二份 core 实现。在 `project/` 安装依赖后可以类型检查、构建 15 个编译型 mod、检查模块边界并执行源码测试；另外两个 mod 直接使用 ESM 源码。保留所有第三方许可证注释。

源码导入于 2026-10-16，版本对应关系和原始文件摘要在 `source-import-manifest.json`。研究工作台和富文本源码比已导入的运行包更新，构建仅写 `project/mods/*/dist/`，不会把这些源码版本自动发布为运行包。`parameter-lab` 与 `terrain-view` 的可读 ESM 源码已随原运行包收录。原 marketplace 的 catalog/contribute 布局与此嵌入式源码 workspace 不同；IMO 更新运行包时按下一段流程操作。

维护 core 时修改本目录的源码，维护 React/mod 时进入 `project/` 的对应模块。更新内置 mod 时，先在源码 workspace 重新 build，再用本 skill 的 `mod pack` 导出完整运行包、验证并执行脱敏，最后显式导入上层 `mods/`、运行 `node scripts/check.mjs --write-catalog` 和测试。注册信息位于 IMO modules registry；仓库根 `skills/icarus` 是兼容链接。

导入时发现全局说明领先于全局运行代码：`feedback context/maintain/restore` 出现在帮助和文档，但对应 CLI/API 尚未实现；拆分 archive、transactions 的维护逻辑也没有包含在全局安装包中。当前使用 `feedback get/list` 读取完整评论和选区，支持现有回复与 task 队列；不要按较新说明手工迁移存储。本次保留全局实际实现，未混入另一个开发目录的存储迁移代码。这些未实现命令不计入通过的验证范围。

新设备按 IMO 更新流程拉取仓库并安装全局投影。已有独立全局 Icarus 目录时，先备份并核对，再显式迁移到 IMO 投影；普通 global install 会报告未托管目录冲突，不强行覆盖。本次导入不替换当前机器的独立全局目录，不重启正在运行的服务。
