# Freshness Playbook

本文件保留 `freshness` 的详细检查细则和模板，按需读取。

## 扫描范围

```yaml
扫描目录:
  - ~/.claude/rules/**/*.md
  - ~/.claude/skills/*/SKILL.md

排除:
  - node_modules/
  - .git/
  - 二进制资源
```

## 提取规则

| 类型 | 处理 |
|------|------|
| GitHub 仓库 | 检查 archived / pushedAt |
| 技术文章 | 检查可访问性与发布时间 |
| X / Twitter | 默认跳过 |

## GitHub 检查优先级

1. `gh repo view`
2. GitHub API
3. WebSearch

## 文章检查

- 可访问性：HEAD / GET
- 发布时间：元数据或页面信息
- 经典内容：作者权威、原理型、长期成立

## 报告模板

```markdown
# 参考时效性检查报告

**检查时间**：YYYY-MM-DD HH:MM
**检查范围**：...

## 汇总

| 状态 | 数量 |
|------|------|
| fresh | N |
| needs_attention | N |
| outdated | N |
| timeless | N |

## 高优先级问题

1. ...

## 建议行动

- ...
```

## 文档更新规则

### 自动执行

- 给 `fresh` 增加时效性状态
- 给 `timeless` 增加经典标记
- 给 `needs_attention` 增加提醒

### 必须确认

- 标记 `outdated`
- 删除参考
- 用新参考替换旧参考

## 索引格式

索引文件：`~/.claude/references/index.json`

记录至少包含：

- `url`
- `type`
- `source_files`
- `last_checked`
- `status`
- `metadata`
