---
name: architecture-health
description: |
  评估项目架构健康度，判断是否需要重构，并给出阶段与治理建议。触发：架构健康度、架构评估、该不该重构。
  Assess project architecture health, decide whether refactoring is needed, and provide stage and recommendations. Triggers: architecture health, architecture assessment, should I refactor.
---

# Architecture Health

只读分析，不修改项目文件。生成目录、vendor、node_modules 等会被跳过。
隐藏目录中的产品真源（例如 `.imo/product`）会被扫描；指向同一真源的兼容
symlink 按 resolved path 去重，避免重复放大指标。

## 运行方式

```bash
python3 <skill-dir>/scripts/scan.py --path <project> --domain <general|frontend|backend> --format json
```

## domain 说明

- general：通用项目
- frontend：前端项目
- backend：后端项目

## 输出结构

- schema_version：输出 schema 版本
- project_path：被扫描的项目路径
- domain：扫描使用的领域
- current_stage：bootstrap | needs_growth | needs_structured
- metrics：扁平指标对象
  - max_file_lines
  - max_file_lines_path
  - max_functions_per_file
  - max_functions_per_file_path
  - duplicate_function_name_count
  - max_imports_per_file
  - max_imports_per_file_path
  - scanned_files
- thresholds：各 domain 的 growth/structured 阈值
- triggered_upgrades：已触发的升级项列表
- recommendations：重构与治理建议列表

## 阶段含义

- bootstrap：健康起步期，当前指标未超过 growth 阈值，无需架构升级
- needs_growth：进入增长期，需要控制复杂度与重复
- needs_structured：结构问题明显，建议系统性重构

`duplicate_function_name_count` 只统计同一文件内的重名定义；不同模块各自拥有
`main`、`run` 等常见函数名不视为架构重复。
