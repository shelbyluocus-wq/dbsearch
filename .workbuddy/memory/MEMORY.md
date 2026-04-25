# MEMORY.md - 项目长期记忆

## 项目概况
- 鹰捷（dbsearch）：Tauri 桌面应用，Vue 3 前端 + Rust 后端
- 同步中心（sync_workspace 窗口）包含两个模式：database（数据库迁移/转表）和 file（文件同步）
- 无 Vue Router，通过 Tauri 多窗口 + windowLabel 条件渲染

## 同步中心结构
- 左侧 sidebar 两个 section：上方是 database 模式（图标 ⇄，名称"数据库同步"），下方是 file 模式（图标 ⌘，名称"转表"）
- database 模式右侧嵌入 `DbMigrationWorkspace` 组件（带 hide-sidebar prop）
- file 模式右侧是行内编辑表单（syncContentEditing）
- 两者共享日志抽屉（sync-center-log-drawer）和设置面板（sw-settings-sheet）
- CSS 类名：database 模式 section 用 `is-database-sync`，file 模式 section 用 `is-transfer`

## 重要修改记录
- 2026-04-25：互换同步中心左侧"转表"和"数据库同步"的名称与图标
- 2026-04-25：删除"转表"添加模板弹窗（sc-add-modal），改为直接创建模板并在右侧编辑
