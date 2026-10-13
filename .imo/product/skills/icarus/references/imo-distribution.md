# IMO 分发与维护

此目录接管全局 Icarus skill 的可分发运行版本，并随附 19 个已安装 mod 的完整运行包。核心修复以导入时全局安装内容为准；未从较旧开发目录覆盖。导入前文件摘要保存在 `import-manifest.json`，不保存个人目录、评论、令牌、服务状态、业务页面或安装日志。

内部 npm scope 已替换为 `@imo/`，包源改用公开 npm registry。这里的包名只用于本地元数据，不表示已经发布到 npm；核心包设为 private。目录 id 安装优先读取本目录的 mod，并校验脱敏后重新计算的完整性摘要，不依赖同名远程包。用户另装的 mod 优先于内置版本；导入不会改写已有安装或评论。

首次使用，在本目录运行 `npm ci --ignore-scripts --registry https://registry.npmjs.org`，随后执行 `npm run check` 和 `npm test`。`node scripts/cli.mjs mod list` 应能在空的 `ICARUS_MODS_DIR` 下列出全部内置 mod。使用 `ICARUS_RUNTIME_DIR` 和 `ICARUS_MODS_DIR` 隔离测试数据。

`mods/` 是经过校验的运行包快照，不包含原开发 workspace 的 TSX 源码，也不宣称可以重建这些预编译模块。保留包内第三方许可证注释。通用 `mod init/build/pack` 功能继续可用；涉及 `@david` 源码组合、原 workspace 的 catalog/contribute 操作，需要单独提供文档中约定的完整 Icarus 开发 workspace。不要直接修改预编译模块来修功能。

维护 core 时修改本目录的源码。更新内置 mod 时，从可信开发 workspace 重新 build/pack 后导入完整运行包、执行脱敏，再运行 `node scripts/check.mjs --write-catalog` 和测试。注册信息位于 IMO modules registry；仓库根 `skills/icarus` 是兼容链接。

导入时发现全局说明领先于全局运行代码：`feedback context/maintain/restore` 出现在帮助和文档，但对应 CLI/API 尚未实现；拆分 archive、transactions 的维护逻辑也没有包含在全局安装包中。当前使用 `feedback get/list` 读取完整评论和选区，支持现有回复与 task 队列；不要按较新说明手工迁移存储。本次保留全局实际实现，未混入另一个开发目录的存储迁移代码。这些未实现命令不计入通过的验证范围。

新设备按 IMO 更新流程拉取仓库并安装全局投影。已有独立全局 Icarus 目录时，先备份并核对，再显式迁移到 IMO 投影；普通 global install 会报告未托管目录冲突，不强行覆盖。本次导入不替换当前机器的独立全局目录，不重启正在运行的服务。
