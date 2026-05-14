# 表格分屏工作区设计

## 背景

当前表格窗口已经支持多标签、全屏表格、Schema 浮窗、冻结行列、无缝滚动和 Canvas fast grid。用户希望增加类似 Obsidian 的上下分屏、左右分屏能力：既能同时查看两张不同表，也能把同一张表打开成两个独立视图，分别滚动和对照。

这个功能应被设计成“表格工作区布局”，而不是多开两个完整应用窗口。

## 目标

- 在表格窗口内支持无分屏、左右分屏、上下分屏三种布局。
- 第一版最多 2 个 pane。
- 每个 pane 可以绑定一张表视图：
  - 两个 pane 可以是不同表。
  - 两个 pane 也可以是同一张表的两个独立实例。
- 每个 pane 拥有独立浏览状态：滚动位置、冻结状态、列宽、Schema 展开状态、查找焦点、当前页/块缓存视图。
- 当前聚焦 pane 响应顶部工具栏动作，例如搜索、Schema、冻结、导出、编辑入口。
- 窗口模式和全屏模式都可使用；小窗口下保持入口可用，用户拉大窗口后获得完整体验。

## 非目标

- 第一版不支持任意嵌套分屏。
- 第一版不支持超过 2 个 pane。
- 第一版不支持把搜索面板、设置、同步中心、迁移工作区放入分屏。
- 第一版不实现跨 pane 联动滚动。
- 第一版不允许两个 pane 同时编辑。
- 第一版不做 pane 布局持久化到全局配置；关闭窗口后回到普通单 pane 即可。

## 推荐方案

采用“标签页级二分屏”。

现有 `tableTabs` 继续作为表格标签和快照来源。新增表格工作区状态，描述当前是否分屏、分屏方向、两个 pane 分别绑定哪个表视图实例，以及哪个 pane 聚焦。

当用户选择“向右分屏打开”或“向下分屏打开”时：

- 如果目标表尚未打开，创建新的表视图实例。
- 如果目标表已经打开但用户希望同表对照，创建一个新的独立实例，而不是激活已有同名标签。
- 新 pane 从当前 pane 的表名、列宽、页码、查找上下文等状态初始化，但滚动、冻结和后续操作互相独立。

关闭分屏时保留当前聚焦 pane；另一个 pane 的状态可写回对应标签快照，避免用户刚刚调整的页码和列宽立即丢失。

## 用户交互

### 入口

在表格窗口顶部工具区新增分屏入口：

- “右侧分屏”：把当前表视图复制或打开到右侧 pane。
- “下方分屏”：把当前表视图复制或打开到下方 pane。
- “切换方向”：已分屏时在左右和上下之间切换。
- “关闭分屏”：关闭非聚焦 pane，保留聚焦 pane。

在表格标签或表命令面板中增加上下文动作：

- “在右侧打开”
- “在下方打开”
- “在当前 pane 打开”

### Pane 标题栏

每个 pane 顶部显示轻量标题栏：

- 表名。
- 当前行范围，例如 `1-150 / 12420`。
- 当前冻结状态摘要。
- pane 关闭按钮。
- 当前 pane 聚焦态高亮。

全局表格标题仍显示当前聚焦 pane 的表名。顶部搜索、Schema、冻结、导出等按钮操作聚焦 pane。

### 布局

- 左右分屏使用两列布局，中间有可拖动分隔条。
- 上下分屏使用两行布局，中间有可拖动分隔条。
- 默认比例为 50/50。
- 用户拖动分隔条后，仅在当前表格窗口会话内记住比例。
- 普通窗口宽度过小时，左右分屏自动降级为上下显示，以保证可读性。
- 全屏模式保留当前更沉浸的表格体验，分屏后每个 pane 仍填满自己的区域。

## 状态模型

新增 `tableWorkspace` 概念：

```js
{
  splitMode: "none" | "vertical" | "horizontal",
  activePaneId: "primary" | "secondary",
  splitRatio: 0.5,
  panes: [
    { id: "primary", tabId: "...", instanceId: "...", viewState: { ... } },
    { id: "secondary", tabId: "...", instanceId: "...", viewState: { ... } }
  ]
}
```

命名约定：`vertical` 表示左右分屏，也就是中间是一条竖向分隔线；`horizontal` 表示上下分屏，也就是中间是一条横向分隔线。

`viewState` 应覆盖当前 `tableView` 周边状态：

- `tableName`、`tableComment`、`columns`、`rows`、`page`、`pageSize`、`totalRows`。
- `tableDetailView`、`schemaCollapsed`、`dataCollapsed`、`schemaTypeHidden`。
- `columnWidthMap`、`schemaColumnWidthMap`、`collapsedColumnMap`。
- `frozenColumnName`、`frozenRowIndex`、冻结选择预览状态。
- `tableFind` 相关状态。
- `seamlessTable` 相关状态。
- `fastTableGrid` 滚动、聚焦和绘制状态。

为了降低第一版风险，现有单 pane 的字段可以先保留作为 `activePane` 的兼容层。实现时逐步把表格渲染和交互函数改为接收 `pane` 或从 `activePane` 读取，而不是一次性重写整个 `App.vue`。

## 数据流

### 打开表

1. 用户从结果、标签、命令面板或 pane 菜单打开表。
2. 根据动作决定是复用当前 pane、打开到另一 pane，还是创建同表独立实例。
3. 通过现有 `get_table_data` 读取初始页。
4. 初始化 pane 的 `viewState`。
5. 写入对应标签快照，并聚焦目标 pane。

### 切换 pane

1. 点击 pane 任意区域或标题栏。
2. 保存旧 active pane 的快照。
3. 设置 `activePaneId`。
4. 顶部工具栏、查找栏、Schema 浮窗、编辑入口切到新 active pane。

### 滚动与缓存

每个 pane 拥有独立 `seamlessTable` 状态，避免两个视图抢同一个 scrollTop 和 activeBlock。

底层 `tableDataCache` 可以继续共享，因为缓存 key 已由表名、页码、pageSize 决定。两个 pane 查看同一张表的不同区域时，可以共享已加载块的数据，但 viewport 和 prune 策略必须独立。

### Fast Grid

Canvas fast grid 需要从全局单实例改成 pane 级实例：

- 每个 pane 有自己的 canvas ref、viewport ref、scroll state、RAF id。
- `drawFastTableGrid(pane)` 根据 pane 状态绘制。
- `hitTestFastGrid`、`buildFastGridDrawModel` 等纯函数继续复用。

这部分是分屏实现的核心风险点，应作为第一批重构对象。

## 编辑模式边界

第一版只允许一个 pane 进入编辑模式。

- 聚焦 pane 可进入编辑。
- 另一 pane 自动保持只读。
- 当某 pane 已有未保存编辑时：
  - 禁止关闭该 pane。
  - 禁止把另一个 pane 切入编辑。
  - 切换当前 pane 前沿用现有未保存变更确认逻辑。
- 底部文本面板、选区、撤销/重做、批量导入、保存弹窗只归属当前编辑 pane。

这避免两个 pane 同时持有独立变更集后产生保存顺序、撤销栈和行定位冲突。

## Schema 与查找

- Schema 展开/收起属于 pane 状态。
- 全屏 Schema 浮窗第一版只显示在聚焦 pane 内，不跨越两个 pane。
- 查找栏操作聚焦 pane。
- 同表双实例的查找结果互相独立；用户可以在两个 pane 用不同关键词对照。
- 顶部 `搜索` 按钮和快捷键打开聚焦 pane 的查找栏。

## 标签页关系

现有 `tableTabs` 是打开过的表视图快照。分屏后需要区分“表名”和“视图实例”：

- 同一表名可以存在多个 `instanceId`。
- 标签显示可以使用 `orders`、`orders #2` 的形式区分同表实例。
- `openOrActivateTableTab` 保留现有行为：普通打开同名表时激活已有 tab。
- 新增分屏打开路径：允许为同名表创建独立实例。

这样既保留日常打开表的直觉，又满足同表对照。

## 视觉设计

- 分屏区域使用低干扰分隔线，不使用厚重卡片嵌套。
- 聚焦 pane 用细 accent 边线或标题栏底色区分。
- pane 标题栏保持紧凑，避免挤占表格可视空间。
- 小窗口下工具按钮可压缩为短文案或图标，但分屏入口必须可见。
- 分隔条 hover 时显示 resize 光标。

## 测试设计

新增纯逻辑测试：

- `createSplitWorkspace` 初始化无分屏状态。
- `splitPaneRight` / `splitPaneDown` 创建 secondary pane。
- 同表分屏时生成不同 `instanceId`。
- 关闭分屏时保留聚焦 pane。
- 切换方向时保留 pane 状态和比例。
- 小窗口下布局建议从 vertical 降级为 horizontal。

扩展现有表格测试：

- 普通打开同名表仍激活已有 tab。
- 分屏打开同名表会创建独立实例。
- 切换 active pane 会保存旧 pane 快照。
- 编辑模式只能在一个 pane 中开启。

手动验证：

- 左右分屏查看两张不同表。
- 上下分屏查看同一张表两个位置。
- 同表双实例分别横向滚动、冻结不同字段。
- 聚焦不同 pane 后，搜索、Schema、导出作用到正确 pane。
- 关闭分屏后保留聚焦 pane。
- 普通窗口拉大后分屏可用；窄窗口下不出现文字重叠或不可读表格。

## 风险与缓解

- 风险：当前表格状态大量集中在 `App.vue` 的单实例变量中。
  - 缓解：先引入 pane 状态模型和纯逻辑模块，再分批把 fast grid、seamless table、freeze、find 挪到 pane 级。
- 风险：Canvas fast grid 目前只有一个 ref 和 RAF。
  - 缓解：优先完成 pane 级 fast grid 封装，保持纯绘制 helper 不变。
- 风险：编辑模式状态复杂。
  - 缓解：第一版强制单 pane 编辑，另一个 pane 只读。
- 风险：小窗口分屏挤压可读性。
  - 缓解：窗口太窄时左右自动转上下；pane 标题栏保持短文本。
- 风险：同表实例和原有同名表激活逻辑冲突。
  - 缓解：保留普通打开路径的去重行为，只在显式分屏打开时创建重复实例。

## 实施顺序建议

1. 建立分屏状态纯逻辑模块和测试。
2. 增加工作区状态与 pane 聚焦，不改变视觉布局。
3. 把表格渲染外层改成单 pane/双 pane 容器。
4. 将 seamless table 和 fast grid 调整为 pane 级状态。
5. 接入分屏按钮、pane 标题栏和分隔条。
6. 接入同表独立实例打开路径。
7. 加入编辑模式限制与未保存变更保护。
8. 做窗口/全屏的响应式视觉验证。
