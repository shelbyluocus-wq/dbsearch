# CLAUDE.md

本文件为 Claude Code 提供关于此项目的说明与指导。

## 项目概述

**鹰捷（DB Scout）** 是一款基于 Tauri 2 + Vue 3 开发的 MySQL 数据库搜索桌面小工具，附带一个可展开搜索面板的像素风宠物浮窗。

## 常用命令

```bash
# 启动完整开发环境（Vite 前端 + Cargo 构建）
npm run tauri dev

# 仅构建前端
npm run build

# 构建生产版本（NSIS 安装包）
npm run tauri build

# 仅启动 Vite 开发服务器（前端）
npm run dev
```

`npm run tauri dev` 会自动触发 `npm run dev`（Vite 监听端口 1430）。`predev` 脚本会在启动前自动终止占用 1430 端口的进程。

## 环境要求（Windows MSVC）

Cargo 配置文件 `src-tauri/.cargo/config.toml` 中设置了 MSVC 链接器所需的 `LIB` 和 `INCLUDE` 环境变量。如果遇到 `LNK1181: 无法打开输入文件"kernel32.lib"` 错误，说明链接器找不到 Windows SDK 库。请在 shell 中设置以下环境变量：

```bash
export LIB="E:\\Program Files (x86)\\ms\\VC\\Tools\\MSVC\\14.44.35207\\lib\\x64;C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\10.0.22621.0\\um\\x64;C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\10.0.22621.0\\ucrt\\x64"
export INCLUDE="E:\\Program Files (x86)\\ms\\VC\\Tools\\MSVC\\14.44.35207\\include;C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0\\ucrt;C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0\\shared;C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0\\um"
```

## 架构说明

### 多窗口结构

三个 Tauri 窗口均由同一份 `App.vue` 渲染，通过 URL hash 或窗口标签（label）区分：

| 窗口标签 | 尺寸 | 用途 |
|---|---|---|
| `main` | 104×122 | 浮动宠物小部件（置顶、无边框、透明背景） |
| `panel` | 620×760 | 主搜索界面面板 |
| `pet_menu` | 186×208 | 宠物右键上下文菜单 |

`App.vue` 通过 `getCurrentWindow().label` 判断当前窗口，并用 `isPetWindow`、`isPanelWindow`、`isMenuWindow` 标志分别渲染对应 UI。

### 前端→后端通信

所有数据库和系统操作均通过 Tauri IPC 从 `src/App.vue` 调用 `src-tauri/src/lib.rs` 中的 Rust 命令。前端使用 `@tauri-apps/api/core` 的 `invoke()`，搜索进度通过 Tauri 事件（`listen()`）回传。

`lib.rs` 中的主要 Tauri 命令：
- 数据库：`connect_db`、`disconnect_db`
- 搜索：`search_metadata`、`search_data`（可取消，触发进度事件）
- 配置：`load_config`、`save_config`
- 窗口：`open_panel`、`close_panel`
- Schema：`get_table_schema`、`get_table_data`

### Rust 状态管理

`AppState` 是存储在 Tauri 托管状态中的 `Mutex<RuntimeState>`，`RuntimeState` 包含：
- `pool`：`Option<MySqlPool>`（sqlx 连接池）
- `schema_cache`：缓存的表结构信息
- `config`：`AppConfig`（持久化到应用数据目录的 `config.json`）
- `registered_hotkeys`：当前注册的全局快捷键
- `search_sequence`：进行中搜索的取消令牌

### 前端状态

`App.vue` 使用 Vue 3 Composition API（`script setup`）和响应式 ref。无外部状态管理库，所有状态存在于组件级 `ref`/`reactive` 中。

### 配置持久化

应用配置（数据库凭据、搜索设置）以 JSON 格式存储于 Tauri 应用数据目录（`config.json`），启动时通过 `load_config` 命令加载。

## 关键文件

- `src/App.vue` — 完整前端 UI（约 80KB，单组件架构）
- `src/styles.css` — 全部样式，使用 CSS 自定义属性设计系统
- `src-tauri/src/lib.rs` — 全部 Rust 逻辑（约 44KB）：Tauri 命令、数据库操作、搜索
- `src-tauri/tauri.conf.json` — 窗口定义、打包目标（NSIS）
- `src-tauri/capabilities/default.json` — 窗口权限声明

## 设计系统

`styles.css` 中定义的 CSS 自定义属性：
- `--accent: #0284c7`（主色调蓝色）
- `--bg-panel: rgba(255,255,255,0.98)` 配合 `backdrop-filter: blur(20px)` 实现毛玻璃效果
- 字体：`"Noto Sans SC"`、`"Microsoft YaHei"`（中文 UI）
- `--px: 5px` 基础间距单位

## 添加新 Tauri 命令

1. 在 `src-tauri/src/lib.rs` 中使用 `#[tauri::command]` 定义异步 Rust 函数
2. 在 `lib.rs` 的 `.invoke_handler(tauri::generate_handler![...])` 中注册该函数
3. 前端使用 `invoke('command_name', { arg1, arg2 })` 调用
4. 如果命令需要新的窗口权限，在 `capabilities/default.json` 中添加
