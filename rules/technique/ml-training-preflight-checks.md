# ML 训练代码预评估规范

> 来源：brainstorm 调研 | 吸收时间：2026-03-26
> 参考：Karpathy's Recipe, preflight CLI, TFDV, Neptune.ai

## 核心洞察

**分层验证 = 低成本发现高成本问题**

在投入长时间训练前，通过分层验证金字塔（毫秒级→秒级→分钟级）发现训练代码问题，避免"训练完成才发现问题"的资源浪费。

## 触发条件

| 条件 | 说明 |
|------|------|
| 训练时间 > 1 小时 | GPU 资源昂贵 |
| 首次运行新模型 | 架构/数据未验证 |
| 修改训练代码 | 可能引入 bug |
| CI/CD 流程中 | 自动化质量门禁 |

## 分层验证金字塔

```
┌─────────────────────────────────────────────────────────────────┐
│                    L4: 端到端试运行 (分钟级)                      │
│    小数据集完整训练 1-2 epoch，验证 pipeline 完整性               │
├─────────────────────────────────────────────────────────────────┤
│                    L3: 模型能力验证 (秒级)                        │
│    Overfit Single Batch - 验证模型能否学习                       │
├─────────────────────────────────────────────────────────────────┤
│                    L2: 数值稳定性检查 (秒级)                      │
│    NaN/Inf 检测、梯度爆炸/消失、Loss 初始值合理                   │
├─────────────────────────────────────────────────────────────────┤
│                    L1: 静态代码检查 (毫秒级)                      │
│    Shape 匹配、数据泄露、类型错误、配置校验                       │
└─────────────────────────────────────────────────────────────────┘
```

## 执行规范

### L1: 静态代码检查

| 检查项 | 工具/方法 | 致命等级 |
|--------|----------|---------|
| Shape 匹配 | `assert model(x).shape == y.shape` | Fatal |
| 数据泄露 | 检查 train/val 重叠样本 | Fatal |
| 通道顺序 | 检查 CHW vs HWC | Fatal |

```bash
pip install preflight
preflight run train.py --exit-on-fatal
```

### L2: 数值稳定性检查

```python
def check_numerics(tensor, name):
    if torch.isnan(tensor).any():
        raise ValueError(f"NaN detected in {name}")
    if torch.isinf(tensor).any():
        raise ValueError(f"Inf detected in {name}")

# Loss 初始值：分类任务期望 -ln(1/num_classes)
```

### L3: Overfit Single Batch

**核心思想**：如果模型连一个 batch 都学不会，就不可能在全量数据上工作。

| 现象 | 诊断 |
|------|------|
| Loss 不降 | 学习率过低 / 模型容量不足 / 数据问题 |
| Loss 震荡 | 学习率过高 / batch size 过小 |
| Loss 为 NaN | 梯度爆炸 / 数值溢出 |

### L4: 端到端试运行

在 1-2 epoch 内验证整个 pipeline，检查 VRAM 估算和梯度流动。

## 决策框架

```
需要预评估？
    │
    ├─ 训练时间 < 30 min → 可跳过 L4
    ├─ 首次运行新模型 → 必须执行 L1-L3
    ├─ 小修改（超参数微调）→ 执行 L1-L2
    └─ CI/CD 流程 → 执行 L1-L3，L4 可选
```

## 检查清单

### 训练前必检

- [ ] Shape 匹配（输入→模型→输出）
- [ ] 无数据泄露（train/val 无重叠）
- [ ] Loss 初始值合理
- [ ] 无 NaN/Inf

### 首次运行必检

- [ ] Overfit Single Batch 通过
- [ ] 梯度流动正常
- [ ] VRAM 估算合理

## 相关规范

- [[testable-architecture]] - 跨技术栈可测试架构范式
- [[long-running-agent-techniques]] - 长时运行任务处理

## 参考

- [A Recipe for Training Neural Networks - Andrej Karpathy](http://karpathy.github.io/2019/04/25/recipe/)
- [preflight - PyTorch Pre-training Validator](https://github.com/SebChw/Actually-Robust-Training)
- [TensorFlow Data Validation (TFDV)](https://www.tensorflow.org/tfx/data_validation/get_started)
