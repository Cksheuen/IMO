---
paths:
  - "src/**/*.{ts,tsx,rs,py}"
  - "server/**/*"
  - "api/**/*"
---

# 跨层功能预检规范

> 来源：notes/lessons/cross-layer-iterative-fix-antipattern.md | 晋升时间：2026-03-30

## 触发条件

当开发涉及跨层功能时：
- Master→Worker→Python 调用链
- Rust↔Python 跨语言交互
- Proxy↔Upstream 代理转发
- 任何跨进程/跨语言的数据传递

## 核心原则

**一次做对，避免"修一个发现下一个"的循环**

| 现象 | 根因 | 解决方案 |
|------|------|---------|
| 单个功能需要 3-5 个 commit 才收敛 | 只看当前层，忽略跨层副作用 | 全链路预审 |
| 问题部署后才逐个暴露 | 缺乏分层测试 | preflight check |
| 性能诊断循环过长 | 一次只看一层 | 完整 profiling |

## 执行规范

### 开发前：画数据流图

```
Layer A → Layer B → Layer C
   │         │         │
   ↓         ↓         ↓
 输入?    转换?     输出?
 类型?    编码?     格式?
```

标注每一层的：
- 输入/输出类型
- 数据转换逻辑
- 边界契约（编码、精度、null 映射）

### 开发时：分层验证

| 层级 | 检查内容 | 方法 |
|------|---------|------|
| L1 静态 | 类型匹配、参数结构 | 单元测试 |
| L2 数值 | 精度、编码、None/null | 单样本测试 |
| L3 单批次 | 跨层传递完整性 | 集成测试 |
| L4 端到端 | 全链路正确性 | E2E 测试 |

### 性能问题诊断

**禁止**："修一个跑一次看下一个"

**必须**：
1. 先做完整 profiling（全链路计时）
2. 生成瓶颈热力图
3. 按占比排序所有瓶颈
4. 一次性制定修复计划

## 边界校验清单

- [ ] Rust→Python：字符串编码（UTF-8）、数值精度、None/null 映射
- [ ] Proxy 透传：status code + headers + body 全保留
- [ ] Master→Worker：配置值序列化/反序列化一致性
- [ ] Python 子进程：logger 配置、环境变量继承

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 修一层跑一次看下一层问题 | 开发前画数据流图，标注所有边界 |
| 假设层间传递无损 | 每个边界都显式校验类型和编码 |
| 性能问题逐层诊断 | 完整 profiling 后一次性修复 |

## 参考

- Source Cases 见原 note：`notes/lessons/cross-layer-iterative-fix-antipattern.md`
