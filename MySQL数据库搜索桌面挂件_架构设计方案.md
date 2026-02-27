# MySQL 数据库搜索桌面挂件 — 架构设计方案

## 一、项目概览

| 项目 | 说明 |
|------|------|
| 定位 | 桌面小工具，快速搜索 MySQL 数据库的表名、字段名、字段备注、表内数据 |
| 技术栈 | **Tauri 2.x**（Rust 后端 + WebView 前端） |
| 前端框架 | Vue 3 + Vite（轻量、策划组内易维护） |
| UI 库 | 推荐 Naive UI 或 Element Plus（中文生态好） |
| 目标平台 | Windows（主要），可扩展 macOS |
| 使用者 | 组内多名策划，需要**可分发安装包 + 共享配置** |
| 数据库连接 | 单库直连（本地/内网），无需 SSH 隧道 |

---

## 二、应用形态设计

### 2.1 双模式切换

应用支持两种存在形态，用户可在设置中切换，也可通过交互动态切换：

#### 模式 A：托盘常驻 + 快捷键呼出（类 uTools）

- 启动后最小化到系统托盘（System Tray），无任务栏图标
- 全局快捷键（默认 `Alt+Space` 或 `Ctrl+Shift+F`，可自定义）呼出搜索窗口
- 搜索窗口居中弹出，类似 Spotlight / uTools 的搜索条样式
- 失去焦点时自动隐藏（可配置为保持显示）
- 适合：快速查一个字段名、查一条数据，查完就走

#### 模式 B：桌面悬浮小窗（Widget）

- 始终显示在桌面上的小窗口（always on top 可选）
- 默认为紧凑态（只显示搜索框 + 最近搜索），点击展开为完整结果面板
- 可拖拽定位，位置记忆
- 适合：频繁查表、需要持续对照数据的工作场景

#### 模式切换实现

```
┌─────────────────────────────────────┐
│           Tauri 主窗口               │
│                                     │
│  模式 A：创建无边框窗口              │
│    - decorations: false             │
│    - visible: false（初始隐藏）      │
│    - 快捷键触发 show/hide            │
│                                     │
│  模式 B：创建小窗口                  │
│    - always_on_top: true（可选）     │
│    - resizable: true                │
│    - 记住 position + size           │
└─────────────────────────────────────┘
```

Tauri 2.x 的 `WebviewWindow` API 可以动态控制窗口属性（大小、位置、可见性、always_on_top），切换模式时销毁旧窗口、创建新窗口即可。

---

## 三、整体架构

```
┌──────────────────────────────────────────────────────┐
│                    前端 (WebView)                      │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ 搜索栏    │  │ 结果列表  │  │ 表详情查看器      │  │
│  │ SearchBar │  │ ResultList│  │ TableViewer       │  │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘  │
│       │              │                 │              │
│       └──────────────┼─────────────────┘              │
│                      │ Tauri invoke (IPC)             │
├──────────────────────┼───────────────────────────────┤
│                      │                                │
│               Rust 后端 (Tauri Core)                   │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │              Command Layer                    │    │
│  │  search_all / search_table / get_table_data  │    │
│  │  get_schema_cache / connect_db / get_config  │    │
│  └──────────────────┬───────────────────────────┘    │
│                     │                                 │
│  ┌─────────────┐  ┌─┴────────────┐  ┌────────────┐  │
│  │ Schema缓存   │  │ 查询引擎     │  │ 配置管理    │  │
│  │ SchemaCache  │  │ QueryEngine  │  │ ConfigMgr   │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬─────┘  │
│         │                │                  │         │
│         └────────────────┼──────────────────┘         │
│                          │                            │
│                    ┌─────┴─────┐                      │
│                    │ MySQL连接池 │                     │
│                    │ sqlx / r2d2│                      │
│                    └─────┬─────┘                      │
│                          │                            │
└──────────────────────────┼────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │  MySQL 数据库 │
                    └─────────────┘
```

---

## 四、Rust 后端详细设计

### 4.1 MySQL 连接管理

**推荐库：`sqlx`**（异步、编译期检查友好）或 `mysql_async`

```rust
// 连接配置结构
struct DbConfig {
    host: String,       // 如 "192.168.1.100"
    port: u16,          // 默认 3306
    username: String,
    password: String,   // 加密存储
    database: String,   // 要连接的库名
}
```

关键设计：
- 使用**连接池**（pool_size = 5 即可，策划工具不需要高并发）
- 连接信息加密存储在本地配置文件中（用 Tauri 的 `app_data_dir`）
- 启动时不自动连接，首次搜索或手动点「连接」时才建立连接
- 连接失败时前端显示明确的错误提示（网络不通 / 密码错 / 库不存在）

### 4.2 Schema 缓存层（核心性能关键）

**为什么需要缓存？** 搜索字段名、表名、备注这三类信息都来自 `information_schema`，每次都去查会很慢。而这些元信息变更频率低，适合缓存。

```rust
struct SchemaCache {
    tables: Vec<TableMeta>,          // 所有表的元信息
    last_refresh: DateTime<Utc>,     // 上次刷新时间
}

struct TableMeta {
    table_name: String,              // 表名
    table_comment: String,           // 表备注
    columns: Vec<ColumnMeta>,        // 字段列表
}

struct ColumnMeta {
    column_name: String,             // 字段名
    column_type: String,             // 类型，如 int(11), varchar(255)
    column_comment: String,          // 字段备注
    is_primary_key: bool,            // 是否主键
    is_nullable: bool,               // 是否可空
}
```

缓存策略：
- **首次连接时**：自动拉取整个库的 schema 信息并缓存
- **手动刷新**：提供「刷新 Schema」按钮，策划改表结构后手动刷新
- **定时刷新**（可选）：每 30 分钟自动刷新一次
- 缓存存储在内存中即可（一个库的 schema 通常就几 MB）

拉取 Schema 的 SQL：

```sql
-- 获取所有表名和表备注
SELECT TABLE_NAME, TABLE_COMMENT
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = '目标库名';

-- 获取所有字段信息
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT,
       COLUMN_KEY, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = '目标库名'
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

### 4.3 搜索引擎设计

搜索分为两大类，处理逻辑完全不同：

#### 类型一：元信息搜索（走缓存，极快）

搜索范围：表名、字段名、备注（表备注 + 字段备注）

```
输入关键词 → 在 SchemaCache 中做字符串匹配 → 立即返回结果
```

匹配策略：
- **模糊匹配**：关键词包含即命中（`contains`），不区分大小写
- **结果排序优先级**：完全匹配 > 前缀匹配 > 包含匹配
- 支持同时搜多个关键词（空格分隔，AND 逻辑）

返回结构：

```rust
struct MetaSearchResult {
    match_type: MatchType,    // TableName / ColumnName / TableComment / ColumnComment
    table_name: String,
    column_name: Option<String>,  // 如果匹配的是字段相关
    matched_text: String,         // 命中的原文
    highlight_range: (usize, usize), // 高亮区间，前端用
}

enum MatchType {
    TableName,
    ColumnName,
    TableComment,
    ColumnComment,
}
```

#### 类型二：数据值搜索（走实时查询，可能慢）

搜索范围：表中实际存储的数据值

这是性能敏感操作，设计如下：

**情况 A：指定了目标表**

```sql
-- 对目标表的每个文本类字段执行 LIKE 查询
SELECT * FROM `指定表`
WHERE `字段1` LIKE '%关键词%'
   OR `字段2` LIKE '%关键词%'
   OR CAST(`字段3` AS CHAR) LIKE '%关键词%'   -- 数值字段转文本再搜
LIMIT 100;
```

**情况 B：未指定表（全库搜索）**

```
遍历 SchemaCache 中所有表 → 对每张表构造上述查询 → 并发执行 → 合并结果
```

关键约束和优化：
- **每张表限制返回行数**：`LIMIT 50`（防止单表结果爆炸）
- **并发控制**：最多同时查 5 张表（用 semaphore 限制，避免打爆数据库）
- **超时机制**：单表查询超时 10 秒自动跳过，整体搜索超时 60 秒
- **进度回调**：通过 Tauri Event 实时推送进度给前端
  ```
  "正在搜索... (15/120 张表)" → "正在搜索... (38/120 张表)" → "搜索完成"
  ```
- **可取消**：用户输入新关键词时，取消上一次未完成的搜索
- **智能跳过**：跳过明显不需要搜的表（如日志表、超大表可在设置中排除）

返回结构：

```rust
struct DataSearchResult {
    table_name: String,
    matched_rows: Vec<HashMap<String, String>>,  // 命中的行数据
    matched_columns: Vec<String>,                 // 哪些字段命中了
    total_matches: u64,                           // 该表总命中数
    truncated: bool,                              // 是否因 LIMIT 被截断
}
```

### 4.4 Tauri Command 接口定义

前端通过 `invoke` 调用这些 Rust 函数：

```rust
// 1. 连接数据库
#[tauri::command]
async fn connect_db(config: DbConfig) -> Result<String, String>

// 2. 断开连接
#[tauri::command]
async fn disconnect_db() -> Result<(), String>

// 3. 获取连接状态
#[tauri::command]
async fn get_connection_status() -> ConnectionStatus

// 4. 刷新 Schema 缓存
#[tauri::command]
async fn refresh_schema() -> Result<SchemaInfo, String>

// 5. 搜索（核心接口）
#[tauri::command]
async fn search(params: SearchParams) -> Result<SearchResponse, String>

// SearchParams 结构：
struct SearchParams {
    keyword: String,
    scope: SearchScope,           // All / MetaOnly / DataOnly
    target_table: Option<String>, // 指定表，None 表示全库
}

// 6. 获取某张表的完整数据（点击进入查看）
#[tauri::command]
async fn get_table_data(table_name: String, page: u32, page_size: u32)
    -> Result<TableData, String>

// 7. 获取/保存配置
#[tauri::command]
async fn get_config() -> AppConfig

#[tauri::command]
async fn save_config(config: AppConfig) -> Result<(), String>
```

### 4.5 搜索进度的实时推送

全库数据搜索可能耗时较长，需要用 **Tauri Event** 推送进度：

```rust
// Rust 端发送进度事件
app_handle.emit("search-progress", SearchProgress {
    current: 38,
    total: 120,
    current_table: "t_hero_config".to_string(),
    status: "searching",  // "searching" | "completed" | "cancelled" | "error"
})?;
```

```javascript
// 前端监听
import { listen } from '@tauri-apps/api/event';

listen('search-progress', (event) => {
    // event.payload = { current: 38, total: 120, current_table: "...", status: "..." }
    updateProgressBar(event.payload);
});
```

---

## 五、前端详细设计

> 🎨 **视觉设计稿**见配套文件 `DB_Scout_UI设计稿.html`，包含所有页面的高保真原型和设计规范（色彩、字体、圆角、毛玻璃参数）。以下为结构说明。

### 5.1 视觉风格

- **基调**：深色毛玻璃（Dark Glassmorphism），类似 macOS 控制中心
- **主色**：`#38bdf8`（冷青蓝），语义色用紫/绿/橙/红区分不同匹配类型
- **字体**：界面用 Noto Sans SC，代码/表名/字段名用 JetBrains Mono
- **面板**：`rgba(18,18,28,0.72)` + `blur(40px) saturate(1.5)`
- **边框**：`rgba(255,255,255,0.08)`，顶部 1px 高光线

### 5.2 页面结构

```
┌────────────────────────────────────────────────┐
│  🔌 连接状态指示灯    ⚙️ 设置    📌 模式切换    │  ← 顶栏
├────────────────────────────────────────────────┤
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  🔍  输入关键词搜索...    [表名筛选 ▼]    │  │  ← 搜索栏
│  └──────────────────────────────────────────┘  │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  搜索范围：☑字段名 ☑表名 ☑备注 ☑数据值   │  │  ← 搜索选项
│  └──────────────────────────────────────────┘  │
│                                                │
│  ── 正在搜索数据值... (38/120) ─── ████░░ ──  │  ← 进度条（仅数据搜索时显示）
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  📋 元信息匹配（23 条）                    │  │  ← 结果区：元信息
│  │  ┌────────────────────────────────────┐  │  │
│  │  │ 📊 表名命中                         │  │  │
│  │  │  t_hero_config    英雄配置表         │  │  │
│  │  │  t_hero_skill     英雄技能表    →    │  │  │  ← 点击 → 进入表查看
│  │  ├────────────────────────────────────┤  │  │
│  │  │ 📝 字段名命中                       │  │  │
│  │  │  t_equip.hero_id   关联英雄ID       │  │  │
│  │  │  t_buff.hero_lv    英雄等级要求 →   │  │  │
│  │  ├────────────────────────────────────┤  │  │
│  │  │ 💬 备注命中                         │  │  │
│  │  │  t_item.use_effect 使用后触发英雄... │  │  │
│  │  └────────────────────────────────────┘  │  │
│  │                                          │  │
│  │  📋 数据值匹配（5 条）                    │  │  ← 结果区：数据值
│  │  ┌────────────────────────────────────┐  │  │
│  │  │ t_hero_config 第 3 行               │  │  │
│  │  │  name="火焰英雄" atk=350 ...    →   │  │  │
│  │  └────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

### 5.2 表详情查看器（Table Viewer）

用户点击搜索结果中的某张表时，进入表详情视图：

```
┌────────────────────────────────────────────────┐
│  ← 返回搜索结果    t_hero_config（英雄配置表）  │
├────────────────────────────────────────────────┤
│  Schema 信息                                   │
│  ┌─────────┬──────────┬───────────────────┐   │
│  │ 字段名   │ 类型      │ 备注              │   │
│  ├─────────┼──────────┼───────────────────┤   │
│  │ id      │ int(11)  │ 主键ID            │   │
│  │ name    │ varchar  │ 英雄名称          │   │
│  │ atk     │ int(11)  │ 基础攻击力        │   │
│  └─────────┴──────────┴───────────────────┘   │
│                                                │
│  表数据（共 238 行）           分页：< 1 2 3 > │
│  ┌────┬──────────┬──────┬────────────────┐   │
│  │ id │ name     │ atk  │ ...            │   │
│  ├────┼──────────┼──────┼────────────────┤   │
│  │ 1  │ 火焰英雄  │ 350  │ ...            │   │
│  │ 2  │ 冰霜法师  │ 280  │ ...            │   │
│  └────┴──────────┴──────┴────────────────┘   │
│                                                │
│  如果是从搜索跳转来的，命中单元格高亮显示        │
└────────────────────────────────────────────────┘
```

关键交互：
- 表数据**分页加载**（每页 50 行），避免一次性拉取大表
- 搜索跳转来时，自动定位到命中行，**命中单元格高亮**
- 列头显示字段备注（hover 或直接显示）
- 支持列宽拖拽调整

### 5.3 设置页面

```
┌────────────────────────────────────────────────┐
│  ⚙️ 设置                                       │
├────────────────────────────────────────────────┤
│                                                │
│  数据库连接                                     │
│  ┌────────────────────────────────────────┐   │
│  │  主机: [192.168.1.100]                  │   │
│  │  端口: [3306]                           │   │
│  │  用户名: [root]                         │   │
│  │  密码: [••••••••]                       │   │
│  │  数据库: [game_config]                  │   │
│  │  [测试连接]  [保存]                      │   │
│  └────────────────────────────────────────┘   │
│                                                │
│  挂件模式                                      │
│  ○ 托盘常驻 + 快捷键呼出                       │
│  ○ 桌面悬浮小窗                                │
│  快捷键: [Ctrl+Shift+F] （仅托盘模式）         │
│  ☑ 置顶显示 （仅悬浮模式）                     │
│                                                │
│  搜索设置                                      │
│  全库搜索时排除的表（正则）: [^t_log_.*]        │
│  单表搜索超时: [10] 秒                         │
│  每表最大返回行数: [50]                         │
│                                                │
│  开机自启: ☑                                   │
│                                                │
└────────────────────────────────────────────────┘
```

### 5.4 搜索交互细节

1. **输入防抖**：用户停止输入 300ms 后才触发搜索（元信息搜索）
2. **数据值搜索手动触发**：因为全库数据搜索较慢，不自动触发。在元信息结果下方显示按钮「🔍 在数据值中搜索」，用户点击后才执行
3. **搜索历史**：本地存储最近 20 条搜索记录，下拉可选
4. **关键词高亮**：结果中命中部分用高亮色标记
5. **快捷复制**：点击表名/字段名可快速复制到剪贴板

---

## 六、配置管理（团队共享方案）

因为组内多人使用，数据库连接信息需要共享，但每人的窗口偏好不同。

### 配置分层

```
配置文件位置：{app_data_dir}/config.json

{
  // 共享配置（可导出为 .json 给同事导入）
  "shared": {
    "db": {
      "host": "192.168.1.100",
      "port": 3306,
      "username": "readonly_user",
      "password": "加密后的密码",
      "database": "game_config"
    },
    "search": {
      "exclude_tables": ["^t_log_.*", "^tmp_.*"],
      "per_table_timeout_sec": 10,
      "per_table_max_rows": 50
    }
  },
  // 个人配置（不共享）
  "personal": {
    "widget_mode": "tray",         // "tray" | "floating"
    "hotkey": "Ctrl+Shift+F",
    "always_on_top": true,
    "window_position": { "x": 100, "y": 200 },
    "window_size": { "width": 600, "height": 400 },
    "auto_start": true
  }
}
```

### 共享方式

- **方案推荐：导入/导出 JSON 文件**
  - 设置页提供「导出共享配置」→ 生成一个 `db_config.json`
  - 同事打开工具 →「导入配置」→ 选文件即可
  - 简单直接，无需搭建额外服务

- **备选：共享网络路径**
  - 指定一个内网共享目录存放配置文件
  - 工具启动时优先读取共享目录的配置
  - 适合人多、配置经常变的情况

---

## 七、项目结构

```
mysql-search-widget/
├── src-tauri/                     # Rust 后端
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs                # Tauri 入口
│   │   ├── commands/              # Tauri Command 接口
│   │   │   ├── mod.rs
│   │   │   ├── search.rs          # search, search_all
│   │   │   ├── database.rs        # connect_db, disconnect_db
│   │   │   ├── schema.rs          # refresh_schema, get_schema
│   │   │   ├── table.rs           # get_table_data
│   │   │   └── config.rs          # get_config, save_config, import, export
│   │   ├── db/                    # 数据库层
│   │   │   ├── mod.rs
│   │   │   ├── pool.rs            # 连接池管理
│   │   │   ├── schema_cache.rs    # Schema 缓存逻辑
│   │   │   └── query_engine.rs    # 搜索查询构造和执行
│   │   ├── models/                # 数据结构定义
│   │   │   ├── mod.rs
│   │   │   ├── config.rs
│   │   │   ├── schema.rs
│   │   │   └── search.rs
│   │   └── utils/
│   │       ├── crypto.rs          # 密码加密/解密
│   │       └── error.rs           # 统一错误处理
│   └── tauri.conf.json            # Tauri 窗口配置
│
├── src/                           # Vue 前端
│   ├── App.vue                    # 根组件
│   ├── main.ts
│   ├── views/
│   │   ├── SearchView.vue         # 主搜索页
│   │   ├── TableView.vue          # 表详情页
│   │   └── SettingsView.vue       # 设置页
│   ├── components/
│   │   ├── SearchBar.vue          # 搜索输入框
│   │   ├── SearchOptions.vue      # 搜索范围勾选
│   │   ├── ResultList.vue         # 搜索结果列表
│   │   ├── MetaResultCard.vue     # 元信息结果卡片
│   │   ├── DataResultCard.vue     # 数据值结果卡片
│   │   ├── ProgressBar.vue        # 搜索进度条
│   │   ├── TableGrid.vue          # 表数据网格（分页）
│   │   ├── ConnectionStatus.vue   # 连接状态指示
│   │   └── TitleBar.vue           # 自定义标题栏（无边框窗口需要）
│   ├── composables/
│   │   ├── useSearch.ts           # 搜索逻辑 hook
│   │   ├── useDatabase.ts         # 数据库连接 hook
│   │   └── useConfig.ts           # 配置管理 hook
│   ├── stores/
│   │   └── appStore.ts            # Pinia 全局状态
│   └── styles/
│       └── global.css
│
├── package.json
├── vite.config.ts
└── README.md
```

---

## 八、关键流程

### 8.1 首次启动流程

```
应用启动
  ↓
读取本地配置文件
  ↓ (无配置)          ↓ (有配置)
弹出设置页            尝试连接数据库
要求输入连接信息         ↓ (成功)         ↓ (失败)
  ↓                  拉取 Schema 缓存    显示连接错误
保存配置 → 连接         ↓                允许手动重连
  ↓                  进入搜索主界面
  └──────────────────→ ✅ 就绪
```

### 8.2 搜索流程

```
用户输入关键词
  ↓
防抖 300ms
  ↓
┌─ 元信息搜索（立即）─────────────────────┐
│  在 SchemaCache 中匹配                   │
│  → 瞬间返回结果，渲染到结果区上半部分     │
└──────────────────────────────────────────┘
  ↓
  用户是否勾选了「数据值」搜索？
  ↓ (是)
  显示 "🔍 在数据值中搜索" 按钮
  ↓ 用户点击
┌─ 数据值搜索（异步）─────────────────────┐
│  显示进度条                               │
│  Rust 端遍历表 → 每完成一张表推送进度     │
│  前端实时更新进度条和已出结果             │
│  → 全部完成后隐藏进度条                   │
│                                          │
│  中途用户输入新关键词？→ 取消当前搜索     │
└──────────────────────────────────────────┘
```

### 8.3 查看表详情流程

```
用户点击搜索结果中的某张表/某行数据
  ↓
路由跳转到 TableView
  ↓
同时发起两个请求：
  1. 从 SchemaCache 获取表结构（瞬间）
  2. get_table_data(table, page=1, pageSize=50)
  ↓
渲染表结构区域 + 数据网格
  ↓
如果是从搜索跳转来的：
  → 自动跳到命中行所在页
  → 高亮命中单元格
```

---

## 九、性能优化要点

| 场景 | 策略 |
|------|------|
| 元信息搜索 | Schema 缓存在内存，纯字符串匹配，<10ms 响应 |
| 全库数据搜索 | 并发 5 张表，每张 LIMIT 50，单表超时 10s |
| 大表查看 | 分页加载，每次只拉 50 行 |
| 搜索防抖 | 300ms 防抖 + 请求取消（AbortController 思路） |
| 冷启动 | Schema 缓存可持久化到本地 JSON，启动时先用缓存，后台异步刷新 |
| 排除表 | 用正则排除日志表、临时表，减少无意义扫描 |

---

## 十、Tauri 窗口配置参考

```json
// tauri.conf.json 关键配置
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "DB Search",
        "width": 650,
        "height": 500,
        "decorations": false,
        "transparent": false,
        "resizable": true,
        "visible": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "windows": {
      "nsis": {
        "installMode": "currentUser"
      }
    }
  },
  "plugins": {
    "global-shortcut": {},
    "autostart": {}
  }
}
```

需要的 Tauri 插件：
- `tauri-plugin-global-shortcut`：全局快捷键
- `tauri-plugin-autostart`：开机自启
- `tauri-plugin-store`：本地持久化存储（替代手动读写文件）

---

## 十一、分发方案

| 项目 | 方案 |
|------|------|
| 打包格式 | NSIS 安装包（.exe），Tauri 自带支持 |
| 分发方式 | 内网共享文件夹 / 企业微信群 直接发安装包 |
| 更新机制 | V1 先手动更新（发新包）；后期可加 `tauri-plugin-updater` |
| 安装要求 | Windows 10+，无需安装额外运行时（Tauri 用系统 WebView2） |
| 注意事项 | WebView2 在 Win10 上可能需要首次安装，NSIS 打包时可选自动携带 |

---

## 十二、开发节奏（单人 + AI 协作，一天搞定）

### Step 1 — 骨架搭建（~1h）

- `npm create tauri-app`，选 Vue + Vite 模板
- 装好依赖：`sqlx`（Rust 侧）、`naive-ui`（前端侧）
- 把窗口配置（无边框、大小、位置）跑通
- 验证 Tauri invoke 前后端通信 OK

### Step 2 — 数据库层（~1.5h）

- 实现 `connect_db` / `disconnect_db` + 连接池
- 实现 Schema 拉取（`information_schema` 查询）+ 内存缓存
- 实现设置页 UI，能填连接信息、测试连接、保存

### Step 3 — 核心搜索（~2h）

- 实现元信息搜索（走缓存，模糊匹配）
- 实现数据值搜索（并发查表 + 进度 Event 推送）
- 搜索 UI：搜索框 + 范围标签 + 结果分组列表 + 进度条

### Step 4 — 表详情 + 体验（~1.5h）

- 表详情页：Schema 展示 + 分页数据 + 命中高亮
- 双模式切换（托盘 vs 悬浮）
- 全局快捷键、托盘图标
- 搜索历史、防抖、取消

### Step 5 — 收尾打包（~30min）

- `cargo tauri build` 打 NSIS 安装包
- 快速测一轮核心流程
- 配置导出功能（方便分享给同事）

> 总计约 6-7 小时，AI 协作下一天完全可以搞定。关键是按 Step 顺序来，每步都能跑起来验证。

---

## 附：关键术语对照

| 中文 | 英文 | 说明 |
|------|------|------|
| 连接池 | Connection Pool | 复用数据库连接，避免频繁创建销毁 |
| 元信息 | Metadata / Schema | 表结构信息：表名、字段名、类型、备注等 |
| 防抖 | Debounce | 延迟执行，避免频繁触发 |
| 信号量 | Semaphore | 控制并发数量的同步原语 |
| 系统托盘 | System Tray | Windows 右下角任务栏通知区域 |
| IPC | Inter-Process Communication | Tauri 前后端通信机制 |
| NSIS | Nullsoft Scriptable Install System | Windows 安装包制作工具 |
| WebView2 | - | 微软的 Edge 内核浏览器组件，Tauri 在 Windows 上的渲染引擎 |
