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

## 构建说明

当前仓库已可通过 `npm run build` 和 `cargo test` 完成基本验证。
如果后续在新机器上遇到 Windows Rust 构建问题，再补装以下组件即可：

- Visual Studio Build Tools 2022
- 工作负载：`Desktop development with C++`
- 组件：`MSVC v143`、`Windows 10/11 SDK`

### 本地正式打包

如果你想在本机直接打出带 updater 签名的安装包，用这个命令：

```bash
npm run build:signed
```

它会自动读取本机私钥：

- `C:\Users\Administrator\.tauri\dbsearch.key`

然后注入 `TAURI_SIGNING_PRIVATE_KEY`，再执行 `tauri build`。

如果你的私钥设置了密码，脚本会按这个顺序找密码：

1. 当前终端里的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
2. 私钥同目录下的 `dbsearch.key.password`

如果你使用的是无密码私钥，`npm run build:signed` 会直接打包，不会再额外询问密码。

如果你使用的是带密码的私钥，可以在本机放一个：

- `C:\Users\Administrator\.tauri\dbsearch.key.password`

文件内容就是那串私钥密码，建议只放在你自己的电脑上，不要提交到仓库。

日常开发仍然用：

```bash
npm run tauri dev
```

如果你是走 GitHub tag 发正式版本，也不用先本地跑 `build:signed`；推送 tag 后，GitHub Actions 会在云端自动构建并发布 Release。

## 自动更新

项目已接入 Tauri updater，客户端会在启动后后台检查 GitHub Releases：

- 连不上 GitHub 时静默跳过
- 每次打开应用都会检查一次，便于当前阶段测试更新链路
- 发现新版本时提示用户手动确认下载和安装

更新源配置在 [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json)，当前使用：

- GitHub Releases：`https://github.com/shelbyluocus-wq/dbsearch/releases/latest/download/latest.json`
- Windows 安装模式：`passive`

### 首次配置

GitHub Actions 发版前，需要在仓库 Secrets 中添加：

- `TAURI_SIGNING_PRIVATE_KEY`
  值为本机生成的私钥内容（当前私钥位于 `C:\Users\Administrator\.tauri\dbsearch.key`，不要提交到仓库）
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  如果这把私钥有密码保护，就把同一串密码也加到这个 Secret；如果你的 key 没密码，这项可以留空

### 日常发版

1. 在项目根目录运行发版脚本，同步版本号：

```bash
npm run release:prepare -- 4.4.1
```

也支持直接带 `v` 前缀：

```bash
npm run release:prepare -- v4.4.1
```

如果你是在某些会把工作目录变成 `\\?\...` 的终端里执行，这两个 npm 命令也可以正常工作；仓库里已经用一个 Node 包装器固定了解析路径。

脚本会自动同步：

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`（如果当前锁文件里存在应用版本条目）

2. 检查这些文件的改动无误后，正常提交并推送代码。
3. 在 GitHub Desktop 里创建并推送同名 tag：

- 打开仓库后进入 `History`
- 找到这次发版对应的 commit，右键
- 选择 `Create Tag...`
- 输入 `v4.4.1`
- 正常 Push，tag 会一起推送到远程

4. GitHub Actions 会自动构建 Windows 安装包、生成 updater 产物和 `latest.json`，并发布到 GitHub Release

### 发版规则

- 代码里的版本号和 tag 必须一致，例如代码是 `4.4.1`，tag 就应是 `v4.4.1`
- 新版本必须大于旧版本，否则已安装客户端通常不会把它识别成更新
- 版本号可以跳跃，例如 `4.4.0 -> 4.4.7` 或 `4.5.0`
- 不建议只打 tag 不改代码版本号，这会让 Release 版本和应用内部版本不一致

### 一句话流程

先运行脚本改版本，再提交推送，最后在 GitHub Desktop 里打同名 tag。
