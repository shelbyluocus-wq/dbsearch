# Prompt Harness 多 Agent 长时间工作框架

这是一套用于长时间、可追踪、多轮闭环工作的 Prompt Harness。它采用主从 Agent 调度模式：

- 主 Agent / Orchestrator：项目经理、调度中心、上下文管理员。
- 计划 Agent / Planner：方案设计、任务拆解、验收标准定义。
- 执行 Agent / Executor：按计划执行、创建或修改产物、修复指定 Bug。
- 测试 Agent / Tester：验收、找 Bug、风险评估，不负责修复。

核心循环：

```text
用户任务
-> 主 Agent 整理目标
-> 计划 Agent 制定方案
-> 主 Agent 审核计划
-> 执行 Agent 实施
-> 测试 Agent 验收
-> 发现 Bug 则回到执行 Agent 修复
-> 复测通过后由主 Agent 交付总结
```

## 文件结构

```text
docs/prompt-harness/
  README.md
  00-global-rules.md
  01-orchestrator.md
  02-planner.md
  03-executor.md
  04-tester.md
  05-communication-protocol.md
  06-state-and-context.md
  07-bug-management.md
  08-long-running-control.md
  09-software-dev-extension.md
  10-quickstart-prompts.md
  templates/
    project-status-record.md
    resume-context-package.md
    dispatch-to-planner.md
    dispatch-to-executor.md
    dispatch-to-tester.md
    dispatch-bugfix-to-executor.md
```

## 推荐使用方式

### 单文件引用法

可以只引用本文件，让 AI 自己按任务选择需要读取的文件。

建议这样对 AI 说：

```md
请先读取 docs/prompt-harness/README.md。

把它当作 Prompt Harness 的入口索引，根据当前任务自动选择需要加载的角色规则、通信协议和模板文件。

如果我是普通单对话环境，请模拟主 Agent、计划 Agent、执行 Agent、测试 Agent 的协作流程。
如果当前环境支持真实多 Agent，请按 README 中的角色文件分配给对应 Agent。

现在开始处理我的任务：
{你的任务}
```

自动选择规则：

- 只想快速开始：读取 `10-quickstart-prompts.md`。
- 需要主控调度：读取 `00-global-rules.md`、`01-orchestrator.md`。
- 需要制定方案：读取 `02-planner.md`。
- 需要执行任务：读取 `03-executor.md`。
- 需要验收测试：读取 `04-tester.md`。
- 需要 Agent 间通信：读取 `05-communication-protocol.md` 和 `templates/` 里的对应派发模板。
- 任务会持续很多轮：读取 `06-state-and-context.md`、`08-long-running-control.md`。
- 任务涉及 Bug 修复：读取 `07-bug-management.md`。
- 任务涉及代码、项目、UI、插件：额外读取 `09-software-dev-extension.md`。

### 完整版

把下面这些内容组装为系统提示词或项目规则：

1. `00-global-rules.md`
2. `01-orchestrator.md`
3. `05-communication-protocol.md`
4. `06-state-and-context.md`
5. `07-bug-management.md`
6. `08-long-running-control.md`
7. 如任务涉及代码，再追加 `09-software-dev-extension.md`

然后分别把以下角色文件交给对应子 Agent：

- `02-planner.md`
- `03-executor.md`
- `04-tester.md`

### 快速版

如果只想快速启动，直接使用：

- `10-quickstart-prompts.md` 中的“一体化启动 Prompt”

如果上下文长度有限，使用：

- `10-quickstart-prompts.md` 中的“最简可用版”

## 运行建议

1. 每个任务分配一个 `TASK-{编号}`。
2. 每轮工作开始前读取项目状态记录。
3. 每轮工作结束后更新项目状态记录。
4. Bug 必须统一编号，如 `BUG-001`。
5. 测试未通过时，主 Agent 不得宣布完成。
6. 上下文过长时，生成 `续跑上下文包`，用于后续接力。

## 最推荐组合

最稳定的组合是：

```text
全局规则
+ 主 Agent Prompt
+ 计划 Agent Prompt
+ 执行 Agent Prompt
+ 测试 Agent Prompt
+ 通信协议
+ 项目状态记录模板
+ Bug 管理规范
+ 上下文压缩规则
```

这套组合最重要的三个锚点是：

- 状态记录：防止长任务丢上下文。
- Bug 编号：防止修复循环混乱。
- 完成标准：防止“看起来差不多”就提前收尾。
