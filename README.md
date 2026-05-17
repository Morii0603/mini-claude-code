# Mini Claude Code

一个轻量级的终端 AI 编程助手，基于 Anthropic Claude API 构建。灵感来源于官方的 [claude-code](https://github.com/anthropics/claude-code) CLI 和 相关教程[claude-code-from-scratch](https://github.com/Windy3f3f3f3f/claude-code-from-scratch)。

## 功能特性

- **AI 驱动的 Agent 循环** — 通过流式对话与 Claude 交互，自动执行代码编辑、文件操作、命令运行等任务
- **丰富的内置工具** — 读/写/编辑文件、搜索代码、执行 Shell 命令、Web 抓取、待办事项管理等
- **MCP 支持** — 集成 [Model Context Protocol](https://modelcontextprotocol.io/)，可接入外部工具服务器
- **子 Agent 系统** — 可派生子 Agent 并行处理子任务
- **技能系统** — 可发现、可复用的技能扩展 agent 能力
- **权限控制** — 细粒度的工具权限管理，支持 allow/deny 设置
- **持久化记忆** — Agent 可跨会话保存和回忆上下文信息
- **Plan 模式** — 在写代码前先规划方案，获得用户确认后再实施
- **多模型支持** — 可切换其他支持 Anthropic SDK 的模型

## 快速开始

### 前置要求

- Node.js >= 18
- API 密钥

### 安装

```bash
git clone https://github.com/your-username/mini-claude-code.git
cd mini-claude-code
npm install
```

### 配置

首次运行会自动启动配置向导，或者手动设置 API 密钥：


### 运行


```bash
npm install
npm run build
npm start
```

## 技术栈

- **语言:** TypeScript (ESNext, Strict Mode)
- **运行时:** Node.js (ESM)
- **AI SDK:** `@anthropic-ai/sdk` ^0.96.0
- **MCP SDK:** `@modelcontextprotocol/sdk` ^1.29.0
- **终端渲染:** `chalk` ^5.6.2

## 项目结构

```
src/
├── index.ts          # 入口文件
├── cli.ts            # CLI 主循环、参数解析、命令处理
├── agent.ts          # Agent 核心 — 对话循环、流式响应、工具调用
├── session.ts        # 会话状态管理（历史消息、配置）
├── prompt.ts         # 系统提示词构建
├── config.ts         # 配置管理（模型选择、设置）
├── ui.ts             # 终端输出渲染
├── memory.ts         # 持久化记忆系统
├── skills.ts         # 技能注册和发现
├── subagent.ts       # 子 Agent 系统
├── frontmatter.ts    # Frontmatter 解析
├── mcp/              # MCP 客户端管理
│   ├── index.ts
│   ├── client-manager.ts
│   ├── client.ts
│   ├── tool-adapter.ts
│   └── types.ts
└── tools/            # 工具系统
    ├── types.ts      # 工具类型定义
    ├── permission.ts # 权限控制
    ├── index.ts
    └── builtin/      # 内置工具（18个）
        ├── read_file.ts       # 读文件
        ├── write_file.ts      # 写文件
        ├── edit_file.ts       # 编辑文件
        ├── grep_search.ts     # 代码搜索
        ├── list_files.ts      # 列出文件
        ├── run_shell.ts       # 执行 Shell 命令
        ├── web_fetch.ts       # 抓取网页
        ├── agent_tool.ts      # 启动子 Agent
        ├── plan_mode.ts       # Plan 模式
        ├── skill.ts           # 技能调用
        ├── tool_search.ts     # 工具搜索
        ├── save_memory.ts     # 保存记忆
        ├── todo_read.ts       # 读取待办
        ├── todo_write.ts      # 写入待办
        ├── todo_store.ts      # 待办存储
        ├── edit-utils.ts      # 编辑工具函数
        ├── get_weather.ts     # 天气查询（示例工具）
        └── index.ts
```

## 主要命令

CLI 中支持以下内置命令：

| 命令 | 描述 |
|------|------|
| `/model [name]` | 查看或切换模型 |
| `/config` | 打开配置向导 |
| `/mcp add/list/remove` | 管理 MCP 服务器 |
| `/skill` | 列出可用技能 |
| `/plan` | 进入 Plan 模式 |
| `/clear` | 清除对话历史 |
| `/help` | 显示帮助 |

## License

MIT
