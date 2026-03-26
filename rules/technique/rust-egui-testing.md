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
┌─────────────────────────────────────────────────┐
│                   测试代码                       │
├─────────────────────────────────────────────────┤
│              egui_kittest (集成层)               │
│     ├─ Harness (测试运行器)                      │
│     └─ Queryable (元素查询 trait)               │
├─────────────────────────────────────────────────┤
│              kittest (核心测试库)                │
│     └─ 基于 AccessKit 的元素定位与交互           │
├─────────────────────────────────────────────────┤
│              AccessKit (无障碍层)                │
│     ├─ Windows UI Automation                    │
│     └─ Unix AT-SPI D-Bus                        │
├─────────────────────────────────────────────────┤
│              egui (UI 框架)                      │
└─────────────────────────────────────────────────┘
```

## 依赖配置

```toml
# Cargo.toml
[dependencies]
egui = "0.30"

[dev-dependencies]
egui_kittest = "0.30"

# 快照测试需要
egui_kittest = { version = "0.30", features = ["snapshot", "wgpu"] }
```

## 测试类型

### 1. UI 交互测试

```rust
use egui::accesskit::Toggled;
use egui_kittest::{Harness, kittest::Queryable};

#[test]
fn test_checkbox_toggle() {
    let mut checked = false;
    let app = |ui: &mut egui::Ui| {
        ui.checkbox(&mut checked, "Check me!");
    };

    let mut harness = Harness::new_ui(app);

    // 查找 UI 元素
    let checkbox = harness.get_by_label("Check me!");
    assert_eq!(checkbox.toggled(), Some(Toggled::False));

    // 模拟点击
    checkbox.click();
    harness.run();

    // 验证状态变化
    let checkbox = harness.get_by_label("Check me!");
    assert_eq!(checkbox.toggled(), Some(Toggled::True));
}
```

### 2. 快照测试

```rust
#[test]
fn test_visual_regression() {
    let mut harness = Harness::new_ui(|ui| {
        ui.label("Hello World");
        ui.button("Click me");
    });

    // 保存截图到 tests/snapshots/
    harness.snapshot("hello_world");
}
```

### 3. ViewModel 测试（推荐）

```rust
// === 业务逻辑层（无 UI 依赖）===
pub struct Calculator {
    value: f64,
}

impl Calculator {
    pub fn add(&mut self, n: f64) {
        self.value += n;
    }

    pub fn result(&self) -> f64 {
        self.value
    }
}

// === UI 层（薄）===
pub struct CalculatorView<'a> {
    calculator: &'a mut Calculator,
}

impl<'a> CalculatorView<'a> {
    pub fn show(&mut self, ui: &mut egui::Ui) {
        ui.label(format!("Result: {}", self.calculator.result()));
        if ui.button("+1").clicked() {
            self.calculator.add(1.0);
        }
    }
}

// === 逻辑单元测试（简单直接）===
#[test]
fn test_calculator_logic() {
    let mut calc = Calculator { value: 0.0 };
    calc.add(5.0);
    assert_eq!(calc.result(), 5.0);
}

// === UI 测试（只测交互）===
#[test]
fn test_calculator_ui() {
    let mut calc = Calculator { value: 0.0 };
    let app = |ui: &mut egui::Ui| {
        CalculatorView { calculator: &mut calc }.show(ui);
    };

    let mut harness = Harness::new_ui(app);
    let button = harness.get_by_label("+1");
    button.click();
    harness.run();

    assert_eq!(calc.result(), 1.0);
}
```

## 支持的交互能力

| 能力 | API | 示例 |
|------|-----|------|
| 点击 | `element.click()` | `button.click()` |
| 键盘输入 | 支持 | 文本输入模拟 |
| 元素查询 | `get_by_label()` | `harness.get_by_label("Submit")` |
| 状态断言 | `element.toggled()` 等 | `assert_eq!(checkbox.toggled(), ...)` |
| 截图对比 | `harness.snapshot()` | 快照回归测试 |

## 架构原则

| 原则 | 实践 |
|------|------|
| **UI 层要薄** | 只做渲染 + 事件分发，不写业务逻辑 |
| **逻辑层无 UI 依赖** | 不引用 egui 类型，可独立编译测试 |
| **状态集中管理** | 使用 struct 持有状态，而非分散在 UI 组件中 |
| **依赖注入** | UI 组件接收 `&mut Logic`，而非自己创建 |

## 测试策略

```
测试类型？
    │
    ├─ 纯逻辑 ──→ 标准 #[test]（最快）
    │
    ├─ UI 交互 ──→ egui_kittest（中）
    │
    └─ 视觉回归 ──→ snapshot 测试（较慢）
```

**推荐比例**：80% 逻辑单元测试 + 15% UI 测试 + 5% 快照测试

## 注意事项

1. **版本要求**：需要 egui >= 0.30.0
2. **快照测试需要 wgpu**：`features = ["snapshot", "wgpu"]`
3. **跨应用测试受限**：仅支持应用内部测试，无法操作其他应用窗口
4. **即时模式优势**：egui 的即时模式天然适合 UI/逻辑分离

## 相关规范

- [[testable-architecture]] - 跨技术栈可测试架构范式
- [[browser-agent-architecture]] - 浏览器自动化架构（对比参考）

## 参考

- [egui_kittest - docs.rs](https://docs.rs/egui_kittest)
- [kittest - docs.rs](https://docs.rs/kittest/latest/kittest/)
- [kittest GitHub](https://github.com/rerun-io/kittest)
- [AccessKit GitHub](https://github.com/AccessKit/accesskit)
- [egui 0.30.0 Released](https://www.reddit.com/r/rust/comments/1hfotbf/egui_0300_released_includes_new_testing_framework/)
