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
- 2026-04-26：完善自动更新功能——Gitee 优先 + GitHub 备用双更新源、tauri-plugin-process 重启、下载失败手动下载入口、发布指南文档

## 自动更新架构
- Tauri v2 + tauri-plugin-updater + tauri-plugin-process
- 更新源：Gitee（`shelbylouis/dbsearch-release`）优先，GitHub（`shelbyluocus-wq/dbsearch`）备用
- Gitee raw 链接放 latest.json：`https://gitee.com/shelbylouis/dbsearch-release/raw/master/latest.json`
- 安装包放 Gitee Release 附件，签名校验已开启
- 前端：`checkForAppUpdate` 检查 → `downloadAndInstall` 下载 → `relaunch()` 重启
- 更新失败时提供「手动下载」按钮跳转 Gitee Release 页
- 发布指南：`update/发布指南.md`，示例文件：`update/latest.json`

## 离线演示数据（Demo 模式）
- 连接设置中 host 填 `demo` 即进入离线演示模式
- 5 张演示表，每张 500 行、11-12 个字段
- 表名：`demo_feature_test`、`demo_customer_profiles`、`demo_orders`、`demo_support_tickets`、`demo_audit_logs`
- 数据通过 Rust 后端 `src-tauri/src/lib.rs` 中的确定性生成函数产生（基于索引哈希，无需 rand 依赖）
- 演示数据支持：搜索、分页、单击编辑、插入、删除（仅当前会话内存保存）
- 前端 `DEMO_TABLE_OPTIONS` 与后端 `mock_schema_cache` 需保持同步
