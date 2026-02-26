# DB Scout 桌面挂件（Tauri + Vue）

已按设计文档实现一个可运行的 Tauri 工程骨架，包含：

- 像素宠物「鹰劫」悬浮挂件与展开面板
- 元信息搜索（表名/字段名/备注）
- 数据值搜索（手动触发、进度事件、取消）
- 表详情查看（Schema + 分页）
- 设置页（数据库配置、模式配置、搜索配置）
- 配置本地持久化（`config.json`）

## 目录

- `src/App.vue`：前端主界面和交互
- `src/styles.css`：视觉与像素角色样式
- `src-tauri/src/lib.rs`：Rust commands（连接/搜索/配置/表数据）
- `src-tauri/tauri.conf.json`：窗口与打包配置

## 运行

1. 安装 Node 依赖

```bash
npm install
```

2. 运行前端构建检查

```bash
npm run build
```

3. 启动 Tauri（需要 Rust + MSVC C++ 构建工具）

```bash
npm run tauri dev
```

## 当前环境已知问题

当前机器缺少 `link.exe`（MSVC linker），`cargo check` 会失败。需要安装：

- Visual Studio Build Tools 2022
- 工作负载：`Desktop development with C++`
- 组件：`MSVC v143`、`Windows 10/11 SDK`

安装完成后重新打开终端再执行 `npm run tauri dev`。
