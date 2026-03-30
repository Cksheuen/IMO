---
name: pkg-dive
description: 探索 npm 包源码实现的技能。当用户需要了解依赖包的实现细节、查看包的源码、理解 API 实现原理、排查依赖问题时自动触发。触发场景包括："这个包是怎么实现的"、"看看 xxx 包的源码"、"这个 API 内部是怎么工作的"、"帮我理解这个依赖的实现"。支持探索 node_modules 中任意 npm 包。
user-invocable: true
---

# Pkg-Dive - 依赖包源码探索

**快速定位 → 检索关键文件 → 分析实现 → 缓存路径**

## 核心理念

**不要猜测，去读源码**

当遇到以下情况时，应该主动探索依赖包的源码：
- 不确定某个 API 的具体行为
- 需要理解某个功能的实现原理
- 排查依赖相关问题
- 学习优秀库的实现方式

## 执行流程

```
用户请求探索 xxx 包
    │
    ▼
┌─────────────────┐
│ Step 1: 定位包  │ ← node_modules/{package} 或 package.json
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Step 2: 检索文件│ ← 入口、类型定义、核心模块
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Step 3: 分析实现│ ← Read 源码，理解 API
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Step 4: 缓存路径│ ← 调用 locate 缓存（可选）
└─────────────────┘
```

---

## Step 1: 定位包路径

### 1.1 确认包是否存在

```bash
# 检查 package.json 中是否有该依赖
Grep pattern='"package-name"' path="package.json"

# 检查 node_modules 中是否存在
Glob pattern="node_modules/{package-name}/package.json"
```

### 1.2 获取包信息

```bash
# 读取包的 package.json
Read file_path="node_modules/{package-name}/package.json"
```

**关键字段**：
- `main` / `module` / `exports` - 入口文件
- `types` / `typings` - 类型定义
- `dependencies` - 依赖关系

---

## Step 2: 检索关键文件

### 2.1 发现文件结构

```bash
# 列出包的顶层结构
Glob pattern="node_modules/{package-name}/*"

# 列出 src 目录结构（如果存在）
Glob pattern="node_modules/{package-name}/src/**/*"
```

### 2.2 定位关键文件

**优先级排序**：

| 优先级 | 文件类型 | 查找方式 |
|--------|---------|---------|
| 1 | 入口文件 | `main`/`module`/`exports` 字段 |
| 2 | 类型定义 | `types`/`typings` 字段或 `*.d.ts` |
| 3 | 核心模块 | `src/core/`、`src/lib/`、`lib/` |
| 4 | 组件/函数 | 根据功能名称搜索 |

### 2.3 搜索特定功能

```bash
# 按功能名称搜索
Grep pattern="functionName|ClassName" path="node_modules/{package-name}"

# 按关键词搜索
Grep pattern="keyword" path="node_modules/{package-name}" type="ts"
```

---

## Step 3: 分析实现

### 3.1 读取源码

```bash
# 读取具体文件
Read file_path="node_modules/{package-name}/src/feature.ts"
```

### 3.2 分析策略

| 分析目标 | 关注点 |
|---------|--------|
| **API 实现** | 函数签名、参数处理、返回值 |
| **类型定义** | 接口、类型别名、泛型约束 |
| **内部逻辑** | 状态管理、副作用、异步处理 |
| **依赖关系** | 内部 import、外部依赖 |

### 3.3 追踪调用链

```
入口函数
    │
    ├─→ 内部函数 A
    │       └─→ 工具函数 X
    │
    └─→ 内部函数 B
            └─→ 第三方依赖
```

---

## Step 4: 缓存路径（可选）

对于经常需要探索的包，使用 `locate` skill 缓存路径：

```markdown
### 调用 locate

使用 /locate 将包的关键路径索引到内存中：
- 包入口路径
- 常用 API 文件路径
- 类型定义路径
```

---

## 常见探索场景

### 场景 1: 理解 API 实现

**用户请求**："react-query 的 useQuery 是怎么实现的？"

**执行步骤**：
1. 定位 `@tanstack/react-query` 包
2. 找到 `useQuery` 函数定义
3. 读取实现代码
4. 分析内部逻辑

### 场景 2: 查找类型定义

**用户请求**："看看 Button 组件有哪些 props？"

**执行步骤**：
1. 定位 UI 库包
2. 找到 `Button` 类型定义文件
3. 读取 interface/ type 定义

### 场景 3: 排查依赖问题

**用户请求**："为什么这个包的行为和文档不一致？"

**执行步骤**：
1. 定位问题包
2. 搜索相关代码
3. 对比文档与实现

---

## 输出格式

### 探索报告

```markdown
## 包探索报告：{package-name}

### 基本信息
- 版本：{version}
- 入口：{main entry}
- 类型定义：{types path}

### 关键文件
- {file1}: {description}
- {file2}: {description}

### 实现分析
#### {feature-name}
- 源文件：{file}:{line}
- 核心逻辑：{summary}
- 关键函数：
  - `func1`: {description}
  - `func2`: {description}

### 相关路径（已缓存）
- [[{package-name}-entry]]
- [[{package-name}-types]]
```

---

## 与其他 Skill 协作

| Skill | 协作方式 |
|-------|---------|
| **locate** | 缓存常用包的路径索引 |
| **eat** | 吸收发现的设计模式 |
| **brainstorm** | 调研时探索参考实现 |

---

## 注意事项

### 不要修改 node_modules

**禁止**：
- ❌ 编辑 node_modules 中的文件
- ❌ 删除 node_modules 中的文件

**正确做法**：
- 只读访问，理解实现
- 如需修改，fork 包或创建本地副本

### 版本敏感

不同版本的包可能有不同的实现：
- 检查 `package.json` 中的版本号
- 如需查看特定版本，使用 npm 或查看 git tag

### Monorepo 场景

对于 monorepo 项目：
- 包可能在 `packages/{package-name}/node_modules/`
- 或者在 workspace 根目录的 `node_modules/`

---

## 触发词

- "这个包是怎么实现的"
- "看看 xxx 包的源码"
- "这个 API 内部是怎么工作的"
- "帮我理解这个依赖"
- "探索 xxx 包的实现"
- "xxx 包的源码在哪里"
