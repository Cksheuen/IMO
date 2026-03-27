# Rust + egui 桌面应用测试方案

> 来源：brainstorm 调研 | 吸收时间：2026-03-26

## 核心洞察

**egui 0.30.0+ 内置测试框架**：基于 AccessKit 的 kittest 提供原生的 UI 自动化测试能力，无需外部工具。

## 触发条件

当需要测试 Rust + egui 桌面应用时：
- UI 交互逻辑验证
- 组件行为测试
- 视觉回归测试
- E2E 用户流程测试

## 核心工具链

| 组件 | 作用 | 状态 |
|------|------|------|
| **kittest** | 框架无关的 GUI 测试库 | 活跃 |
| **egui_kittest** | egui 官方集成 | 内置（egui 0.30.0+） |
| **AccessKit** | 跨平台无障碍基础设施 | 稳定 |

## 架构关系

```
测试代码 → egui_kittest (Harness + Queryable)
        → kittest (基于 AccessKit 的元素定位)
        → AccessKit (Windows UI Automation / Unix AT-SPI)
        → egui (UI 框架)
```

## 依赖配置

```toml
[dev-dependencies]
egui_kittest = "0.30"
# 快照测试需要
egui_kittest = { version = "0.30", features = ["snapshot", "wgpu"] }
```

## 测试类型

### UI 交互测试

```rust
use egui_kittest::{Harness, kittest::Queryable};

#[test]
fn test_checkbox() {
    let mut checked = false;
    let mut harness = Harness::new_ui(|ui| ui.checkbox(&mut checked, "Check me!"));

    harness.get_by_label("Check me!").click();
    harness.run();

    assert!(checked);
}
```

### 快照测试

```rust
#[test]
fn test_visual() {
    let harness = Harness::new_ui(|ui| {
        ui.label("Hello World");
    });
    harness.snapshot("hello_world");
}
```

### ViewModel 测试（推荐）

```rust
// 逻辑层 - 无 UI 依赖，可独立单元测试
pub struct Calculator { value: f64 }
impl Calculator {
    pub fn add(&mut self, n: f64) { self.value += n; }
}

// UI 层 - 薄，只渲染 + 事件分发
pub struct CalculatorView<'a> { calc: &'a mut Calculator }
impl<'a> CalculatorView<'a> {
    pub fn show(&mut self, ui: &mut egui::Ui) {
        if ui.button("+1").clicked() { self.calc.add(1.0); }
    }
}
```

## 支持的交互能力

| 能力 | API |
|------|-----|
| 点击 | `element.click()` |
| 元素查询 | `harness.get_by_label("text")` |
| 状态断言 | `element.toggled()` |
| 截图对比 | `harness.snapshot("name")` |

## 架构原则

| 原则 | 实践 |
|------|------|
| **UI 层要薄** | 只做渲染 + 事件分发 |
| **逻辑层无 UI 依赖** | 不引用 egui 类型 |
| **依赖注入** | UI 接收 `&mut Logic` |

## 测试策略

```
测试类型？
    ├─ 纯逻辑 ──→ 标准 #[test]（最快）
    ├─ UI 交互 ──→ egui_kittest（中）
    └─ 视觉回归 ──→ snapshot 测试（较慢）
```

**推荐比例**：80% 逻辑单元测试 + 15% UI 测试 + 5% 快照测试

## 注意事项

1. **版本要求**：需要 egui >= 0.30.0
2. **快照测试需要 wgpu**：`features = ["snapshot", "wgpu"]`
3. **仅支持应用内部测试**：无法操作其他应用窗口

## 相关规范

- [[testable-architecture]] - 跨技术栈可测试架构范式
- [[browser-agent-architecture]] - 浏览器自动化架构（对比参考）

## 参考

- [egui_kittest - docs.rs](https://docs.rs/egui_kittest)
- [kittest GitHub](https://github.com/rerun-io/kittest)
- [AccessKit GitHub](https://github.com/AccessKit/accesskit)
