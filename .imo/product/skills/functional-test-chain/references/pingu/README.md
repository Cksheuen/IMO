# Testing Assets

这里存放功能测试链资产。

## 文件

- `atoms.yaml`
  - 原子操作定义，编号为 `U-*`
- `chains.yaml`
  - 可复用子链 `SC-*`
  - 主链 `MC-*`

## 设计约束

- 文件扩展名使用 `.yaml`
- 当前内容使用 JSON-compatible YAML，便于无额外依赖地由 Node 直接解析
- 不写 UI hover、颜色、布局等细节
- 重点表达：用户操作、前置条件、期望结果、链引用关系

## 生成

列出链：

```bash
node scripts/gen-test-chain.mjs --list
```

展开链：

```bash
node scripts/gen-test-chain.mjs --chain MC-01
```

输出 JSON：

```bash
node scripts/gen-test-chain.mjs --chain MC-01 --format json
```
