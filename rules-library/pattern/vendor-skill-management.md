# 第三方 Skill 管理规范

> 来源：第三方 skill 与本地 skill 解耦设计 | 吸收时间：2026-04-16

## 核心原则

**第三方 skill 当依赖，不当 fork。**

vendor/ 存只读原件，本地只做薄包装器。升级时替换 vendor，wrapper 通常不动。

## 触发条件

当出现以下任一情况时，必须应用本规范：

- 安装或更新第三方 skill
- 修改来源为第三方的 skill 内容
- 晋升链路（promote/freeze/thaw）扫描 skills/ 目录
- 新增 marketplace skill 到本地

## 目录结构

```yaml
skills/:
  vendor/:                    # 只读区：第三方原件
    .vendor-manifest.json:    # 来源、版本、同步时间
    pdf/:                     # 原样保留，禁止手动修改
    docx/:
    pptx/:
  pdf/:                       # 本地 wrapper
    SKILL.md:                 # frontmatter 含 vendor_ref 指向 vendor/pdf
  docx/:
  pptx/:
```

## wrapper 设计

wrapper SKILL.md 的 frontmatter 必须包含 `vendor_ref` 字段：

```yaml
---
name: pdf
vendor_ref: vendor/pdf
description: ...
description_zh: ...
license: Proprietary. LICENSE.txt has complete terms
---
```

wrapper 内容包含：

- 本地增强（中文描述、本地约束、环境适配）
- 对 vendor 原件核心内容的引用或内联

wrapper 不包含：

- 与 upstream 重复的通用方法论
- 可通过读取 vendor 原件获取的内容

## 治理链路排除

以下链路必须排除 `skills/vendor/` 路径：

| 链路 | 排除方式 |
|------|----------|
| promotion-dispatch.py | 扫描相似度时跳过 vendor/ |
| promotion-apply-result.py | 禁止向 vendor/ 写入 |
| freeze | 扫描候选时跳过 vendor/ |
| thaw | 恢复时不放入 vendor/ |
| consolidate.py | 若扫描 skills/，跳过 vendor/ |

## 更新流程

```
marketplace 发布新版本
    │
    ├─ 运行 hooks/vendor-sync.sh
    │    ├─ diff marketplace 缓存 vs vendor/
    │    ├─ 有差异 → 更新 vendor/ 原件
    │    └─ 更新 .vendor-manifest.json 的 synced_at
    │
    └─ 检查 wrapper 是否需要适配
         ├─ 通常不需要
         └─ 若 upstream 接口变更 → 小修 wrapper
```

## 判断标准

| 情况 | 处理方式 |
|------|----------|
| 新安装 marketplace skill | 复制到 vendor/，创建本地 wrapper |
| 需要加中文描述 | 只改 wrapper，不改 vendor 原件 |
| 需要临时热修复 | 改 vendor 原件，但必须在 manifest 标注 `hotfix: true` |
| 明确决定永久 fork | 从 vendor 移到 skills/ 顶层，manifest 标注 `forked: true` |

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 直接修改 vendor/ 下的 SKILL.md | 只改 wrapper，vendor 保持只读 |
| 把本地增强写进 vendor 原件 | 增强内容放 wrapper |
| promote/freeze 链路处理 vendor skill | 排除 vendor/ 路径 |
| 不记录来源和同步时间 | 维护 .vendor-manifest.json |
| 升级时手动 diff + 合并 | 用 vendor-sync.sh 一键更新 |
