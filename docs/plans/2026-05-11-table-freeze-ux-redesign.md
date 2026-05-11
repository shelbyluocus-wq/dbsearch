# 表格冻结体验重设计

## 目标

移除表格内常驻的列/行冻结按钮，降低视觉噪音，并通过“冻结模式 → 选择边界 → 二次确认”的流程减少误操作和重叠问题。

## 交互设计

### 工具栏入口

在表数据区域的工具栏中增加一个主按钮：`冻结`。

按钮状态：

- 未冻结、未选择：显示 `冻结`。
- 选择模式中、尚未选择边界：显示 `选择冻结位置…`。
- 选择模式中、已有预览边界：显示 `确认冻结`。
- 已冻结：显示当前状态，例如 `已冻结：第 3 行 / name 列`，旁边提供 `取消冻结`。

### 选择模式

点击 `冻结` 后进入选择模式。进入后：

- 表格区域显示轻微蓝色聚焦外框或提示条。
- 不显示每行/每列的冻结按钮。
- 鼠标悬停在可选目标上时显示轻量预览。

用户可选择三类目标：

1. **单元格**：冻结到该单元格所在列和所在行。
2. **字段表头**：只冻结到该字段列。
3. **行柄/行号**：只冻结到该行。

点击目标只更新预览，不立即冻结。

### 二次确认

选择目标后，工具栏按钮变为 `确认冻结`。再次点击工具栏按钮后，才应用冻结。

如果用户在选择模式中再次点击其他目标，则更新预览边界。

### 取消和清空

- 选择模式中点击 `Esc` 或 `取消` 退出选择模式并清空预览。
- 已冻结时点击 `取消冻结` 清空行/列冻结。
- 切换表、重新打开表、刷新数据时清空冻结和预览。
- 分页导致当前页行数据替换时清空行冻结和行预览；列冻结可保留，除非切换表。

## 视觉设计

- 去掉表头和行柄里的常驻冻结按钮。
- 冻结模式下仅使用轻量提示：表格外框、hover 高亮、预览边界线。
- 预览态用虚线或半透明蓝线。
- 生效态用细实线蓝色边界。
- 冻结区域背景只做非常轻的 tint，避免遮挡命中高亮、查找高亮和编辑态。
- sticky 层级必须保证表头、左侧行柄、checkbox 列、冻结列和冻结行交叉处不互相遮挡。

## 技术设计

### 状态

保留已生效边界：

- `frozenColumnName`
- `frozenRowIndex`

新增选择模式和预览状态：

- `freezePickMode`: 是否正在选择冻结位置。
- `freezePreview`: `{ columnName: string | null, rowIndex: number | null, source: 'cell' | 'column' | 'row' | null }`。

### 行为

- `toggleFreezePickMode()`：根据当前状态进入选择、确认冻结或退出选择。
- `selectFreezeCell(rowIndex, columnName)`：设置行列预览。
- `selectFreezeColumn(columnName)`：设置列预览。
- `selectFreezeRow(rowIndex)`：设置行预览。
- `applyFreezePreview()`：将预览写入 `frozenColumnName` / `frozenRowIndex`。
- `clearFreeze()`：清空生效边界和预览。
- `cancelFreezePickMode()`：退出选择模式并清空预览。

### 模板

- 表数据 toolbar 增加冻结按钮、取消冻结按钮和简短状态文本。
- 表头点击在选择模式下选择列，否则保持原行为。
- 行柄点击在选择模式下选择行，否则保留编辑模式行选择行为。
- 单元格点击在选择模式下选择单元格，否则保留现有单元格点击/编辑/选区行为。
- 表格内不再渲染 `column-freeze-btn` 和 `row-freeze-btn`。

### 样式

- 移除或废弃表格内冻结按钮样式。
- 新增 `freeze-pick-mode`、`freeze-preview-column`、`freeze-preview-row`、`frozen-column-edge`、`frozen-row-edge` 等状态样式。
- 保持 `box-sizing: border-box`，避免 sticky offset 与实际列宽不一致。

## 测试设计

### 自动测试

保留并扩展 `tableFreeze.test.js`：

- helper 对 null 行冻结不冻结第 0 行。
- App.vue 不再包含 `column-freeze-btn` / `row-freeze-btn`。
- App.vue 包含 toolbar 冻结入口和确认冻结文案。
- App.vue 在选择模式下通过单元格/表头/行柄选择预览。
- App.vue 保留 column collapse badge。
- styles.css 保留 sticky 单元格 `box-sizing: border-box`。

### 手动验证

- 未进入冻结模式时表格内无冻结按钮。
- 点击工具栏冻结按钮后进入选择模式。
- 点击单元格只预览，不立即冻结。
- 再点工具栏确认后冻结到该行和列。
- 点击表头只冻结列；点击行柄只冻结行。
- 已冻结后点击取消冻结清空。
- 编辑模式下非选择模式的行选择、checkbox、单元格编辑仍可用。
- 横向/纵向滚动时无重叠、表头和左侧列层级正确。
