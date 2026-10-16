# resource-cards

独立显示服务资源的字段、部署状态与参考链接。保持原研究工作台资源卡和 David Chip 的样式；服务标识、配置中心、数据库、云函数等仅是输入数据，不包含任何业务查询或凭证。

```html
<div data-icarus-resource-cards>
  <script type="application/json" data-icarus-props>
    {
      "resources": [
        {
          "id": "sample",
          "kind": "RDS",
          "title": "应用数据库",
          "fields": [{ "label": "PSM", "value": "example.mysql.app" }],
          "status": { "state": "unknown", "label": "区域待核验" },
          "links": [
            { "label": "参考部署", "href": "https://example.com/resource" }
          ]
        }
      ]
    }
  </script>
</div>
```

`fields` 必须非空；`status.state` 接受 `ready / missing / partial / unknown`。`href`、`links[].href` 仅允许无用户名密码的 HTTP(S) URL。组件不主动请求资源；状态由调研者提供，必须带上适当的证据边界。

每个字段可传 `fields[].href`，将原 value 原样渲染为链接，例如 PSM、区域实例和参考部署。使用已核实的控制台地址或有官方路由依据的资源直达地址；未验证存在的目标不能标成“已有部署”。字段链接与其他链接使用相同的 URL 校验，支持键盘焦点并在新页打开。

```bash
npm run build -- resource-cards research-workbench
icarus mod pack /absolute/mods/resource-cards --out /absolute/resource-cards.zip
icarus mod install /absolute/resource-cards.zip
icarus mod enable /absolute/source.html --mods resource-cards
icarus mod disable /absolute/source.html --mods resource-cards
```

公开入口 `src/public.ts` 导出组件、类型和校验器。研究工作台通过声明 `composes` 复用，并在数据中用 `resources[].afterCodeId` 指定代码旁的位置。独立插槽可热装卸；工作台内部是源码组合，升级后须重建消费者，不能把它当作工作台内部热替换。
