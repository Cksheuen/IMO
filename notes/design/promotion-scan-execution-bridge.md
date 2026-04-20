# Promotion Scan Execution Bridge

- Status: historical-background
- Date: 2026-03-27
- Trigger: 当时需要把自动晋升从“发现候选”推进到“可执行评估链”

## 当前事实源

这份文档只保留桥接层的设计动机；当前协议以这些入口为准：

- [`hooks/promotion-scan.py`](../../hooks/promotion-scan.py)
- [`scripts/promotion-dispatch.py`](../../scripts/promotion-dispatch.py)
- [`rules/pattern/promotion-loop-background-execution.md`](../../rules/pattern/promotion-loop-background-execution.md)
- [`notes/design/promotion-loop-dispatch-runtime.md`](./promotion-loop-dispatch-runtime.md)

## 这份设计稿保留的核心判断

当时真正的问题不是“能不能扫描出候选”，而是“扫描结果如何继续进入执行链，而不是停在提示层”。

后来被保留下来的判断是：

- `promotion-scan.py` 只做轻量发现，不承担完整晋升评估
- 主链路和 `promote-notes` 之间需要稳定桥接层，避免重复扫描
- queue 比临时 prompt 更适合作为跨执行链事实源

## 背景版数据流

```text
promotion-scan
  -> queue
  -> dispatch claim
  -> promote-notes execution
  -> apply / fail
```

这条数据流今天仍然解释得通，但“字段长什么样、命令如何调用、哪个 hook 挂在哪个事件上”已经属于代码和规则层，不应继续由这份设计稿充当规范正文。

## 为什么还保留这份文档

它保存的是 bridge 这层概念最初解决的问题：

- 扫描和晋升评估的成本不同
- 主 agent 不适合顺手吞掉完整晋升流程
- 自动化链路如果没有桥接层，就会一直停在“知道要做”

如果要判断当前行为是否正确，请看脚本与规则；如果要理解 bridge 这层概念为何存在，这份文档仍然有价值。
