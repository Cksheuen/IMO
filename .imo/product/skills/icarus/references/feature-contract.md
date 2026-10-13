# Feature contract v1

```js
const feature = {
  id: "code-notes",
  apiVersion: 1,
  requires: [],
  async mount({ root, signal, onCleanup, getDocument, subscribe }, options) {
    // Register cleanup immediately after acquiring each resource.
    const node = document.createElement("aside");
    root.append(node);
    onCleanup(() => node.remove());
    node.addEventListener("click", handler, { signal });
    onCleanup(subscribe(onComments));
    // An optional returned disposer also runs on unmount.
  },
};
await icarus.use(feature, options);
await icarus.remove(feature.id);
```

- 生命周期调用串行执行。挂载成功才发布 active 状态；缺少依赖、重复 id 和未知 API 版本在副作用前拒绝。
- mount 抛错或返回非法 disposer：先 abort，再逆序清理已登记资源；失败不会遗留 active 条目。
- 有依赖者时拒绝卸载。destroy 按逆序卸载全部 feature，单个 disposer 抛错也继续清理其他资源。
- `signal` 只帮助清理用它注册的监听/请求；定时器、Observer、订阅、样式、DOM、React root 必须显式登记 disposer。此契约不是任意第三方 JS 沙箱。
- 卸载只清理模块创建的 DOM/样式，不能清空原 HTML、评论或其他模块状态。React 的 hooks 不能越过 root 所有权边界。
- 核心评论对象属于核心，feature 只得到克隆快照和订阅；不直接写内部数组。
- 编译时未选择的模块不进入 standalone 产物；运行时卸载只释放副作用，不从 JS 模块缓存清除代码。下次挂载执行新的 mount。
- mod 清单负责版本依赖解析和计划热切换，feature host 负责挂载顺序与资源释放。异步永久挂起、强制隔离任意第三方代码和 iframe 跨源通信尚未实现；这些能力不能仅凭 mount/dispose 宣称完成。
- 本机持久化与 Agent 通道是核心必需服务，随生成页默认携带且自动启动/连接，不进入 feature 装卸列表。实现可以保持独立接口，但不允许关闭后把内存评论当成功。默认实现提供固定 loopback 存储、版本 CAS、并发重试、失败保留草稿、Agent 幂等回复与回读；人审状态保持 open。

- `documentId` 是核心提供的稳定文档 id；`storage.read()` 返回 `{version,value}`，`storage.write(value,expectedVersion)` 使用每文档/每 mod 的本机 CAS，`storage.update(fn)` 对冲突最多重试三次。请求绑定 mod 的 AbortSignal；模块自己校验业务数据。Agent 用 `icarus mod data <document> <mod-id>` 回读。写入的 value 上限 32MB。
- 热切换比较模块代码、选项和依赖变化；保留未变化的 root，仅卸载改变/移除的模块与依赖者。新模块失败会撤销新挂载，恢复被替换模块；不保证恢复被卸载模块的未持久化内部 UI 状态。

源码归属与组合规则见 [Mod 实现规范](mod-implementation.md)。`icarusBuild.composes` 是构建期公开入口依赖，不等同于 `mod.json.requires` 的运行时依赖；构建记录保留组合版本与来源指纹。
