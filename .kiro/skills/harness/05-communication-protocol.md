# Agent 间通信协议

为了让系统长时间运行不乱，所有 Agent 之间都使用固定格式。

## 主 Agent → 计划 Agent

使用模板：

- `templates/dispatch-to-planner.md`

核心字段：

- Task ID
- User Request
- Goal
- Known Context
- Constraints
- Expected Deliverables
- Open Questions
- Required Output

## 主 Agent → 执行 Agent

使用模板：

- `templates/dispatch-to-executor.md`

核心字段：

- Task ID
- Round
- Goal
- Approved Plan
- Current Scope
- Context State
- Constraints
- Forbidden Actions
- Required Output

## 主 Agent → 测试 Agent

使用模板：

- `templates/dispatch-to-tester.md`

核心字段：

- Task ID
- Round
- Goal
- Approved Plan
- Acceptance Criteria
- Executor Output
- Artifact List
- Test Focus
- Required Output

## 主 Agent → 执行 Agent：Bug 修复

使用模板：

- `templates/dispatch-bugfix-to-executor.md`

核心字段：

- Task ID
- Round
- Goal
- Failed Test Result
- Bugs to Fix
- Fix Scope
- Required Output

## 通信规则

1. 每个任务必须有 `TASK-{编号}`。
2. 每轮必须标注 `Round`。
3. 每个 Bug 必须使用全局唯一编号。
4. 执行 Agent 的产出文件必须进入项目状态记录。
5. 测试 Agent 的失败项必须转成 Bug 或风险。
6. 主 Agent 不得丢弃子 Agent 的关键结论。
7. 当上下文过长时，主 Agent 必须输出续跑上下文包。

