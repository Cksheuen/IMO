---
name: functional-test-chain
description: 为可测试的项目生成功能测试原子操作、可复用子链和长链主链，并输出可继续落地为自动化脚本的测试步骤骨架。适用于用户要求“整理测试表”“设计测试链”“按操作和期望结果编排长链测试”“为 UI / 逻辑解耦后的项目生成自动化功能测试计划”。
description_en: "Functional test chain skill for testable projects. Generates atomic test actions, reusable subchains, and long-form test flows, then outputs a step skeleton that can be turned into automated scripts."
---

# Functional Test Chain

为“已具备一定 UI / 逻辑解耦”的项目生成可复用的功能测试链资产。

## 何时使用

满足任一条件即可：

- 用户要求把“用户操作 -> 期望结果”整理成测试表
- 用户希望把离散测试用例继续收敛成可复用子链和长链主链
- 用户要求按编号引用步骤，而不是反复展开重复流程
- 用户希望基于当前项目结构生成自动化功能测试脚本骨架
- 项目已经有相对清晰的 domain / page model / command adapter 边界，适合从逻辑层出发设计测试

不要在以下场景使用：

- 用户只要单个 bug 的临时手测步骤
- 项目仍严重耦合，连“用户操作对应到哪层逻辑”都无法稳定定位
- 用户明确要的是 UI 像素、hover、动画、布局层面的测试

## 核心原则

- 先列原子操作，再组合子链，最后生成长链
- 一条链只表达功能意图，不混入 UI 微交互细节
- 重复流程只定义一次，通过编号引用复用
- 长链优先覆盖“配置演进 -> 在线变更 -> 断开回收 -> 重启恢复”这一整条稳定性路径
- 测试链生成属于开发工作流，不属于产品 runtime，不要做成 React hook

## 输入资产

优先使用两类资产来源：

- 项目内测试资产
  - `testing/atoms.yaml`
  - `testing/chains.yaml`
- 全局 skill 自带参考资产
  - `~/.claude/skills/functional-test-chain/references/<project>/atoms.yaml`
  - `~/.claude/skills/functional-test-chain/references/<project>/chains.yaml`

若资产尚未存在，先根据当前项目结构生成它们。

## 概念模型

### 原子操作 `U-*`

最小功能单元，表达一次用户操作及其期望结果。

字段最少包含：

- `id`
- `action`
- `preconditions`
- `expected`

### 子链 `SC-*`

可复用流程片段，用于消除重复描述。

字段最少包含：

- `id`
- `name`
- `refs`

其中 `refs` 只引用 `U-*` 或其他 `SC-*`。

### 主链 `MC-*`

面向稳定性和系统演进的长链，用于串起多个子链。

字段最少包含：

- `id`
- `name`
- `refs`
- `goal`

## 推荐工作流

### Step 1: 读取架构入口

至少识别：

- 页面或路由入口
- page model / domain service / command adapter
- 可直接测试的逻辑层边界

目标不是读完所有代码，而是确认“操作落在哪层逻辑”。

### Step 2: 提取原子操作

把功能动作整理为：

- 用户操作
- 前置条件
- 期望结果

禁止写成：

- hover / tooltip / 样式类名 / 像素位置
- 与功能无关的渲染细节

### Step 3: 归并重复片段

把重复出现的流程收口成 `SC-*`，例如：

- 节点接入链
- 规则配置链
- 首次连接链
- 在线 reload 链
- 断开回收链

### Step 4: 生成长链

优先生成尽量长的 `MC-*`：

- 从冷启动或空态开始
- 经过配置建立
- 进入连接态
- 进行在线变更
- 进行日志与观测检查
- 执行断开与清理
- 最后验证重启恢复

### Step 5: 展开为脚本骨架

优先使用全局 skill 自带脚本：

```bash
node ~/.claude/skills/functional-test-chain/scripts/gen-test-chain.mjs --list
node ~/.claude/skills/functional-test-chain/scripts/gen-test-chain.mjs --chain MC-01
node ~/.claude/skills/functional-test-chain/scripts/gen-test-chain.mjs --chain MC-01 --format json
```

如果明确要消费某个样本，可直接指定：

```bash
node ~/.claude/skills/functional-test-chain/scripts/gen-test-chain.mjs \
  --atoms ~/.claude/skills/functional-test-chain/references/pingu/atoms.yaml \
  --chains ~/.claude/skills/functional-test-chain/references/pingu/chains.yaml \
  --chain MC-01
```

## 输出要求

至少给出：

- 原子操作总数
- 子链总数
- 主链总数
- 推荐优先执行的长链编号
- 是否存在明显缺口，例如删除 active node / active group 的行为未定义

## 与 UI / 逻辑解耦的关系

这是下游能力，不是上游规范本体。

分层关系应是：

`UI / page -> page model -> domain adapter -> pure logic`

测试链生成利用这一层次化结构，产出：

`atoms -> subchains -> main chains -> generated test skeleton`

不要反过来把测试生成逻辑塞进页面组件、前端 hook 或运行时 store。

## 落点约束

- 若该能力被证明可跨项目复用，默认全局真源应放在 `~/.claude/skills/functional-test-chain/`
- 项目目录中的同名版本只允许作为临时草稿或明确的 project-only 变体
- 如果出现项目副本与全局副本并存，应尽快收敛为全局单一真源

## 非目标

- 不直接生成完整 Playwright/Cypress UI 像素测试
- 不替代真实断言实现
- 不自动修复业务逻辑

## 反模式

- 直接把整条长链平铺成几十步，不抽子链
- 同一段流程在多个主链里重复手写
- 把 UI 文案、颜色、hover 作为功能断言主体
- 用 React hook 承担测试计划生成职责
- 没有原子操作层就直接写主链
