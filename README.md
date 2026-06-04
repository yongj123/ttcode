# ttcode

> AI coding assistant for your terminal — 终端中的 AI 编程助手

ttcode 是一个基于 ReAct Agent 架构的终端编程助手，提供交互式 TUI 和非交互式 CLI 两种模式，支持文件读写、代码搜索、Shell 命令执行和任务管理。

## ✨ 特性

- **🖥️ 交互式 TUI** — 基于 [Ink](https://github.com/vadimdemedes/ink) 的终端 UI，支持实时流式输出、会话管理和权限审批
- **⚡ 非交互式 CLI** — 通过 `-p` 参数直接执行任务，适合脚本和 CI/CD 场景
- **🔧 工具系统** — 文件读写、精确编辑、Shell 命令、代码搜索、Todo 任务管理
- **🔐 权限控制** — 三级权限模型（allow / ask / deny），支持按工具名批量授权
- **🧠 上下文压缩** — 自动压缩长对话，保留关键信息，突破上下文窗口限制
- **💾 会话持久化** — 自动保存对话历史，支持跨会话恢复
- **📋 任务管理** — 内置 Todo 系统，复杂任务自动拆分并跟踪进度

## 📦 安装

```bash
# 需要 Bun 运行时
bun install
bun run build
```

## 🚀 使用

### 配置

```bash
export DEEPSEEK_API_KEY=your-key

# 可选：自定义 API 地址和模型
export DEEPSEEK_BASE_URL=https://api.deepseek.com  # 默认值
export DEEPSEEK_MODEL=deepseek-v4-pro               # 默认值
```

### 交互式模式

```bash
ttcode
```

在 TUI 中：

| 快捷键 | 功能 |
|--------|------|
| `Enter` | 发送消息 |
| `Esc` | 取消当前任务 |
| `/clear` | 清空对话 |
| `/new` | 新建会话 |
| `/sessions` | 查看并恢复历史会话 |
| `/exit` | 退出 |

### 非交互式模式

```bash
# 只读任务（默认只允许 read_file 和 search_code）
ttcode -p "分析这个项目的架构"

# 授权指定工具
ttcode -p "修复 login 函数的 bug" --allow-tools edit,write,bash

# 危险模式：自动批准所有工具（慎用！）
ttcode -p "重构整个 auth 模块" --dangerously-auto-approve
```

工具别名：`edit` → `edit_file`，`write` → `write_to_file`，`read` → `read_file`，`bash` / `shell` / `cmd` → `execute_command`，`grep` / `search` → `search_code`

## 🏗️ 架构

```
src/
├── cli.tsx              # CLI 入口，分发交互/非交互模式
├── Agent.ts             # ReAct Agent 核心循环
├── client.ts            # LLM 客户端（OpenAI 兼容 API）
├── Tool.ts              # 工具基类（Zod schema → function calling）
├── permission.ts        # 权限系统（交互式/非交互式解析器）
├── session.ts           # 会话管理（持久化到 ~/.ttcode/sessions/）
├── tools/
│   ├── FileTools.ts     # read_file / write_to_file / edit_file
│   ├── BashAndGrep.ts   # execute_command / search_code
│   └── TodoTools.ts     # todo_write / todo_read
├── memory/
│   └── MemoryManager.ts # 上下文压缩与摘要管理
└── ui/
    ├── App.tsx          # Ink 应用根组件
    ├── ChatView.tsx     # 聊天视图
    ├── InputBox.tsx     # 输入框
    ├── MessageLine.tsx  # 消息渲染
    ├── SessionList.tsx  # 会话列表
    ├── PermissionPrompt.tsx  # 权限审批弹窗
    └── TodoListView.tsx # 任务列表
```

### 核心设计

- **ReAct 循环** — Think → Act → Observe → 循环，直到任务完成或达到最大轮次
- **流式输出** — LLM 响应逐 token 流式渲染，工具调用实时展示
- **权限分级** — 安全操作（`ls`、`find`）自动放行，危险操作（`rm`、`write`）需用户确认
- **上下文压缩** — 超过 50 条消息或 24K tokens 时自动触发 LLM 摘要压缩

## 🛠️ 开发

```bash
# 类型检查
bun run typecheck

# 开发模式（热重载）
bun run dev

# 构建
bun run build
```

## 📄 License

MIT
