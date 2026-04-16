# Lesson: 跨层功能反复修补反模式

- Status: promoted
- Promoted To: rules-library/pattern/cross-layer-preflight.md
- Promoted At: 2026-03-30
- First Seen: 2026-03-22
- Last Verified: 2026-03-30
- Trigger: checkpoint resume 修了 4 轮，DDP 训练一次修 5 个问题，性能优化剥了 5 层洋葱

## 现象

跨层功能（Master→Worker→Python、Rust↔Python、Proxy↔Upstream）频繁出现"修一个发现下一个"的循环，单个功能需要 3-5 个 commit 才收敛。

## 根因

1. **缺乏全链路预审**：只看当前层的问题，忽略跨层副作用
2. **假设层间传递无损**：字符串编码、状态码、配置值在跨语言/跨进程传递时被默认为正确
3. **缺乏分层测试**：没有 preflight check，问题在部署后才逐个暴露
4. **逐层诊断而非全局定位**：性能问题一次只看一层，导致诊断循环过长

## Source Cases

| 时间 | 案例 | 修补轮数 |
|------|------|---------|
| 2026-03 | checkpoint resume（配置校验→进度恢复→模型加载→进度条） | 4 轮 |
| 2026-03 | DDP 训练（梯度同步、MPS、采样器、AMP、OOM） | 1 commit 5 fix |
| 2026-03 | Windows CUDA 性能（诊断→同步→DataLoader→连接池→批量API） | 5 轮 |
| 2026-03 | data_dir 路径编码 ådata→data | 1 轮但本可预防 |
| 2026-03 | proxy forward_post 丢失 upstream 状态码 | 1 轮但本可预防 |
| 2026-03-28 | Textura worker 跨主机连接（本地正常，远程 502→防火墙→端口检测） | 3 轮 |
| 2026-03-29 | Textura 模型加载 state_dict 不匹配（加载失败→修复→bug仍然存在） | 2+ 轮 |
| 2026-03-29 | Textura claude 进程调用（报错退出→应先评测再优化的流程未实现） | 1 轮但暴露流程缺失 |

## 正确做法

### 跨层功能开发前

1. **画数据流图**：标注每一层的输入/输出/转换，特别是类型和编码
2. **标注边界契约**：Rust↔Python 字符串编码、Proxy 透传要求、配置值类型
3. **写 preflight check**：按 L1（静态）→ L2（数值）→ L3（单批次）→ L4（端到端）分层验证

### 性能问题诊断

1. **先做完整 profiling**（全链路计时），生成瓶颈热力图
2. **按占比排序**所有瓶颈，一次性制定修复计划
3. **避免**"修一个跑一次看下一个"的循环

### 边界校验清单

- [ ] Rust→Python：字符串编码、数值精度、None/null 映射
- [ ] Proxy：status code + headers + body 全透传
- [ ] Master→Worker：配置值序列化/反序列化一致性
- [ ] Python 子进程：logger 配置、环境变量继承
