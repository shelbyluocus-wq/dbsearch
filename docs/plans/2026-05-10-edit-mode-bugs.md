---
title: 编辑模式 Bug 扫描报告
date: 2026-05-10
tags:
  - 鹰捷
  - Bug 扫描
  - 编辑模式
aliases:
  - 编辑模式 Bug 修复结论
---

# 编辑模式 Bug 扫描报告

本报告对应 `实现计划 — Navicat 风格编辑模式升级.md` Task 9 的 5 项候选 Bug 实测结果。

---

## 1. 编辑 `<input>` 的 `@blur` 在 Tab 切换时可能丢失新值

**实测结论**：**未复现** — 但加固了一层防御。

**分析**：Tab 的 `keydown` 处理器会先 `preventDefault()` 再调用
`confirmCellEdit`，后者从 `editingCell.currentValue` 读取值。v-model 在每个
`input` 事件上同步更新该字段，正常键盘输入下不会丢值。

**加固**：`confirmCellEdit` / `confirmNewRowCellEdit` 新增从
`document.getElementById("edit-cell-input").value` 直接读取 DOM 值的兜底
逻辑，防止 IME composition 尾字符 / compositionend 时序差导致的漏更新。

---

## 2. 分页切换后 `editSelectionAnchorIndex` 不重置导致 Shift 选择锚点漂移

**实测结论**：**已复现并修复**。

**根因**：`syncEditSelectionToCurrentPage` 仅在锚点 >= `tableView.rows.length`
或当前页无选中时才重置 anchor。如果旧页 anchor=15、新页有 20 行，anchor
仍然是 15，但指向一个完全不同的行；后续 Shift-click 会选到错误的连续
区间。

**修复**：`syncEditSelectionToCurrentPage` 每次页面数据变更时无条件重置
`editSelectionAnchorIndex.value = -1`。锚点在页内切换时由
`toggleRowSelection` 自动重新设定，没有功能损失。

---

## 3. 切换 `cellViewer.manualLanguage` 后焦点飘回按钮

**实测结论**：**未复现**。

**分析**：`cellViewer` 的语言下拉为原生 `<select>`，浏览器自身会管理
焦点。在 dev 构建中反复切换语言，焦点保持在 `<select>` 上，未观察到
焦点飘回工具栏按钮的情况。如后续确实出现偶发复现，应单独立 issue
并补一个针对 `manualLanguage` 的回归用例。

---

## 4. ESC 关闭 `cellViewer` 时若 `editDirty` 会吞键

**实测结论**：**不复现 — 现有优先级正确**。

**分析**：`onWindowKeydown` 中的 ESC 链路：

```
cellViewerDiscardDialogOpen → cellViewerOpen → tableOpen
```

- `closeCellViewer()` 自身会检测 `cellViewerDirty` 并弹 discard 对话框；
- `closeTableDialog()` 检测 `editDirty` 并弹 `editUnsavedDialogOpen`；

两层各自负责本域的 dirty，无重叠。连按 ESC 的行为是先关预览、再关
对话框，与用户直觉一致。

---

## 5. 粘贴 TSV 到编辑态单元格无法正确拆分多行

**实测结论**：**按设计处理**。

**分析**：

- 单元格内联编辑器为 `<input type="text">`，原生就会剥掉换行；这是
  浏览器行为，不是本工程的 Bug。
- Navicat 风格的 TSV 平铺粘贴由网格焦点层提供（Task 6）：在焦点态
  按 Ctrl+V 会走 `pasteTsvIntoGridRange` → `applyTsvToRange`，按选区
  尺寸自动铺开 / 平铺。
- 若用户确实要在单个单元格里编辑多行文本，请通过 F4 打开「文本
  选项」面板，面板里是 `<textarea>`，可以原样粘贴 / 保留换行。

---

## 总结

| 编号 | 问题 | 结论 | 提交 |
|------|------|------|------|
| 1 | blur 吞值 | 未复现 + 加固兜底 | `confirmCellEdit` DOM 值兜底 |
| 2 | 分页锚点漂移 | 已修复 | `syncEditSelectionToCurrentPage` 总是重置 anchor |
| 3 | 语言切换焦点 | 未复现 | 无 |
| 4 | ESC 优先级 | 不复现 | 无 |
| 5 | 多行 TSV 粘贴 | 按设计 — 用 F4 文本面板 | 无 |
