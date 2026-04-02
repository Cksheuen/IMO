# macOS GUI 应用的 PATH 解析陷阱

> 主题：macOS GUI 应用无法通过 `which` 找到用户安装的 CLI 工具
> 状态：active
> Last Verified：2026-03-31

## 核心教训

macOS GUI 应用（通过双击 .app 或 Cargo 编译的桌面应用）继承的 PATH 只有系统路径（`/usr/bin:/bin:/usr/sbin:/sbin`），**不包含** shell profile 添加的路径（如 `~/.local/bin`、`/opt/homebrew/bin` 等）。

用 `which <tool>` 或 `Command::new("<tool>")` 查找 CLI 工具时，在 GUI 应用中会静默失败。

## 触发条件

- 在 GUI 桌面应用（egui/eframe/Tauri/wry）中调用外部 CLI 工具
- 使用 `which`/`where` 检测工具是否可用
- 使用 `Command::new("tool_name")` 不带绝对路径启动子进程

## 正确做法

1. `which` 优先（覆盖终端启动场景）
2. 回退检查 `$HOME/.local/bin/`（npm -g / pipx 常见安装位置）
3. 再回退检查 `/usr/local/bin/`、`/opt/homebrew/bin/` 等已知位置
4. 找到后保存绝对路径，后续 `Command::new()` 用绝对路径

## Source Cases

- **2026-03-31 - Textura TRAINING_OPTIMIZATION**：`ClaudeInvoker::is_available()` 用 `which claude` 检测，GUI 启动时 PATH 不含 `~/.local/bin` → `claude_available = Some(false)` → Generate 按钮永远 disabled。修复：`new()` 中自动探测绝对路径。

## 反模式

| 反模式 | 后果 |
|--------|------|
| 只用 `which tool` 检测可用性 | GUI 应用中失败 |
| `Command::new("tool")` 不带路径 | GUI 应用中找不到 |
| 假设 PATH 与终端一致 | 开发时正常，发布后失败 |
