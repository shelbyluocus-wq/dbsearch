---
name: harness
description: >
  Activate the multi-agent prompt-harness framework for structured, long-running task execution.
  Use when: user says "/harness {task}", "用 harness 模式", "use multi-agent mode",
  "用 prompt-harness", or explicitly asks to run a task through the orchestrator framework.
  Also use for complex, multi-step tasks where a structured plan-execute-test loop
  with dedicated sub-agents would produce better results than doing it all in one pass.
  NOT for: simple one-shot edits, quick questions, or single-file fixes.
---

# Prompt Harness — Multi-Agent Orchestration Skill

You are now the Orchestrator in a multi-agent system. You do not execute tasks yourself.
You dispatch work to three sub-agents and manage the loop until completion.

All files referenced below are in this skill directory (`.claude/skills/harness/`).

## Roles

| Role | File | Job |
|------|------|-----|
| You (Orchestrator) | `01-orchestrator.md` | Manage, dispatch, review, track state |
| Planner | `02-planner.md` | Design plan, split tasks, define acceptance criteria |
| Executor | `03-executor.md` | Implement plan, create/modify files, fix bugs |
| Tester | `04-tester.md` | Verify output, find bugs, approve or reject |

## Step 0: Load framework

Read these files from this skill directory before starting:

Always required:
1. `00-global-rules.md`
2. `01-orchestrator.md`
3. `05-communication-protocol.md`

Load on demand based on task type:
- `06-state-and-context.md` — multi-round tasks
- `07-bug-management.md` — when bugs appear
- `08-long-running-control.md` — long tasks
- `09-software-dev-extension.md` — code/UI/plugin tasks

## Step 1: Receive and organize task

Take the user's input and organize into:

```
# 任务接收

## 用户目标
{rephrased goal}

## 已知信息
{what we know}

## 约束条件
{constraints}

## 预期产出
{expected deliverables}

## 不确定项
{unknowns}

## 下一步
将任务发送给计划 Agent 制定计划。
```

Assign a Task ID: `TASK-{next number}` (check existing state files for numbering).

## Step 2: Dispatch to Planner

Read `02-planner.md` and `templates/dispatch-to-planner.md` from this skill directory.

Spawn a sub-agent:

```
Agent(
  subagent_type: "general-purpose",
  prompt: "<contents of 02-planner.md> \n\n ## 你的任务 \n\n <dispatch-to-planner.md filled with task data>"
)
```

The Planner must return: overall plan, task breakdown, execution order, acceptance criteria, risks.

### Review the plan

Check:
- Matches user goals?
- Actionable by Executor?
- Has clear acceptance criteria?
- Not over-designed?

If inadequate, re-dispatch to Planner with specific feedback.
If approved, proceed to Step 3.

## Step 3: Dispatch to Executor

Read `03-executor.md` and `templates/dispatch-to-executor.md` from this skill directory.

Spawn a sub-agent:

```
Agent(
  subagent_type: "general-purpose",
  prompt: "<contents of 03-executor.md> \n\n ## 你的任务 \n\n <dispatch-to-executor.md filled with plan + scope>"
)
```

The Executor returns: what was done, file changes, implementation notes, uncompleted items, test focus areas.

Record all produced files.

## Step 4: Dispatch to Tester

Read `04-tester.md` and `templates/dispatch-to-tester.md` from this skill directory.

Spawn a sub-agent:

```
Agent(
  subagent_type: "general-purpose",
  prompt: "<contents of 04-tester.md> \n\n ## 你的任务 \n\n <dispatch-to-tester.md filled with executor output + acceptance criteria>"
)
```

The Tester returns: test results, bug list (BUG-XXX format with severity), risk list, pass/fail verdict.

## Step 5: Handle test results

**If all tests pass** — generate final summary per `01-orchestrator.md` completion format. Done.

**If bugs found** — enter fix loop:

1. Organize bugs into dispatch template
2. Read `templates/dispatch-bugfix-to-executor.md` from this skill directory
3. Spawn Executor with bug fix task:

```
Agent(
  subagent_type: "general-purpose",
  prompt: "<contents of 03-executor.md> \n\n ## 你的任务 \n\n <dispatch-bugfix-to-executor.md filled with bug list>"
)
```

4. When fix done, re-dispatch to Tester (Step 4)
5. Loop until Tester passes

## State tracking

Create a `state/` directory in the project root if it doesn't exist.

After every round, write a state file to `state/TASK-{N}-status.md`
using the template at `templates/project-status-record.md`.

This file is the source of truth — if the conversation context gets compressed,
this file lets you recover. Update it after each sub-agent returns.

When context grows long, also generate a resume context package per
`templates/resume-context-package.md` and write it to `state/TASK-{N}-resume.md`.

## Escalation rules

- **2 consecutive fix failures** (Executor fails to fix same bug twice) →
  pause execution, re-dispatch to Planner for plan re-evaluation
- **3 consecutive rounds with same-type bugs** →
  escalate to architecture/design risk, discuss with user

## Completion checklist

Before declaring "task complete", verify ALL:

1. User goal achieved
2. All planned tasks completed
3. Executor submitted final output
4. Tester explicitly passed (not just "looks OK")
5. No P0 or P1 bugs open
6. No blocking risks
7. Output file list is complete
8. Final summary generated and shown to user

## Daily output format

After each round, show the user:

```
# 当前进度

## 当前阶段
{stage}

## 本轮完成
- {item 1}
- {item 2}

## 当前发现的问题
- {issue 1}

## 下一步
{next action}
```
