# vim 退出命令速查

> 来源：`notes/lessons/vim-exit-commands.md` | 晋升时间：2026-04-03

## 触发条件

当在 vim 中编辑 commit message 或其他内容后需要退出时。

## 命令决策

| 命令 | 用途 | 场景 |
|------|------|------|
| `:q` | 退出 | 未做任何修改 |
| `:q!` | 强制退出 | **放弃修改** |
| `:wq` | 保存并退出 | **merge commit 时使用** |

## 决策框架

```
vim 编辑后退出？
    │
    ├─ 有修改且要保留 → :wq
    │
    ├─ 有修改但要放弃 → :q!
    │
    └─ 无修改 → :q
```

## 参考

- Source Cases：`notes/lessons/vim-exit-commands.md`
