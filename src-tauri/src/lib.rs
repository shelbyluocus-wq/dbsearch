pub mod db_migration;
pub mod sync_workspace;

use crate::sync_workspace::{execute_sync_pipeline, SyncProfile, SyncRunOutcome};
use crate::db_migration::{
    connect_db_migration_server as connect_db_migration_server_impl,
    run_db_migration as run_db_migration_impl,
    DbMigrationLoginParams,
    DbMigrationLoginResult,
    DbMigrationOutcome,
    DbMigrationRequest,
};
use chrono::{DateTime, Local, Utc};
use enigo::{Enigo, Keyboard, Settings};
use mouse_position::mouse_position::Mouse;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::{MySqlPool, Row};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PetHitbox {
    width: f64,
    height: f64,
    offset_x: f64,
    offset_y: f64,
}

#[derive(Clone)]
struct AppState {
    runtime: Arc<tokio::sync::Mutex<RuntimeState>>,
    cancel_seq: Arc<AtomicU64>,
    panel_hotkey_sync: Arc<std::sync::RwLock<Option<String>>>,
    quick_date_hotkey_sync: Arc<std::sync::RwLock<Option<String>>>,
    sync_window_hotkey_sync: Arc<std::sync::RwLock<Option<String>>>,
    db_migration_window_hotkey_sync: Arc<std::sync::RwLock<Option<String>>>,
    db_migration_window_size_sync: Arc<std::sync::RwLock<Option<DbMigrationWindowSize>>>,
    db_migration_running_sync: Arc<AtomicBool>,
    db_migration_resize_seq: Arc<AtomicU64>,
    pet_hitbox: Arc<std::sync::RwLock<Option<PetHitbox>>>,
    pet_cursor_ignored: Arc<AtomicBool>,
}
impl Default for AppState {
    fn default() -> Self {
        Self {
            runtime: Arc::new(tokio::sync::Mutex::new(RuntimeState::default())),
            cancel_seq: Arc::new(AtomicU64::new(0)),
            panel_hotkey_sync: Arc::new(std::sync::RwLock::new(None)),
            quick_date_hotkey_sync: Arc::new(std::sync::RwLock::new(None)),
            sync_window_hotkey_sync: Arc::new(std::sync::RwLock::new(None)),
            db_migration_window_hotkey_sync: Arc::new(std::sync::RwLock::new(None)),
            db_migration_window_size_sync: Arc::new(std::sync::RwLock::new(None)),
            db_migration_running_sync: Arc::new(AtomicBool::new(false)),
            db_migration_resize_seq: Arc::new(AtomicU64::new(0)),
            pet_hitbox: Arc::new(std::sync::RwLock::new(None)),
            pet_cursor_ignored: Arc::new(AtomicBool::new(false)),
        }
    }
}
#[derive(Default)]
struct RuntimeState {
    pool: Option<MySqlPool>,
    schema_cache: SchemaCache,
    config: AppConfig,
    panel_open_settings_pending: bool,
    registered_hotkey: Option<String>,
    registered_quick_date_hotkey: Option<String>,
    registered_sync_window_hotkey: Option<String>,
    registered_db_migration_window_hotkey: Option<String>,
    sync_running: bool,
    pet_hidden_this_session: bool,
}

const MAIN_WINDOW_LABEL: &str = "main";
const PANEL_WINDOW_LABEL: &str = "panel";
const PET_MENU_WINDOW_LABEL: &str = "pet_menu";
const SYNC_WORKSPACE_WINDOW_LABEL: &str = "sync_workspace";
const DB_MIGRATION_WORKSPACE_WINDOW_LABEL: &str = "db_migration_workspace";
const PANEL_WIDTH: f64 = 780.0;
const PANEL_HEIGHT: f64 = 860.0;
const PET_MENU_WIDTH: f64 = 212.0;
const PET_MENU_HEIGHT: f64 = 248.0;
const PET_MENU_BUTTON_COUNT: f64 = 5.0;
const PET_MENU_CHILD_COUNT: f64 = 6.0;
const PET_MENU_BUTTON_HEIGHT: f64 = 38.0;
const PET_MENU_ROW_GAP: f64 = 4.0;
const PET_MENU_DIVIDER_BLOCK_HEIGHT: f64 = 5.0;
const PET_MENU_VERTICAL_PADDING: f64 = 20.0;
const SYNC_WORKSPACE_WIDTH: f64 = 760.0;
const SYNC_WORKSPACE_HEIGHT: f64 = 640.0;
const DB_MIGRATION_WORKSPACE_WIDTH: f64 = 1120.0;
const DB_MIGRATION_WORKSPACE_HEIGHT: f64 = 760.0;
const DB_MIGRATION_WORKSPACE_MIN_WIDTH: f64 = 980.0;
const DB_MIGRATION_WORKSPACE_MIN_HEIGHT: f64 = 660.0;
const DEFAULT_DB_MIGRATION_WINDOW_HOTKEY: &str = "Shift+D";
const TRAY_ICON_ID: &str = "main_tray";
const TRAY_MENU_OPEN_PANEL_ID: &str = "tray-open-panel";
const TRAY_MENU_SHOW_PET_ID: &str = "tray-show-pet";
const TRAY_MENU_EXIT_ID: &str = "tray-exit";
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayMenuAction {
    OpenPanel,
    ShowPet,
    ExitApp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowCloseAction {
    HideToTray,
    HideWindow,
}

fn tray_click_opens_panel(button: MouseButton, state: MouseButtonState) -> bool {
    button == MouseButton::Left && state == MouseButtonState::Up
}

fn resolve_tray_menu_action(id: impl AsRef<str>) -> Option<TrayMenuAction> {
    match id.as_ref() {
        TRAY_MENU_OPEN_PANEL_ID => Some(TrayMenuAction::OpenPanel),
        TRAY_MENU_SHOW_PET_ID => Some(TrayMenuAction::ShowPet),
        TRAY_MENU_EXIT_ID => Some(TrayMenuAction::ExitApp),
        _ => None,
    }
}

fn close_request_action_for_window(label: &str) -> WindowCloseAction {
    match label {
        PANEL_WINDOW_LABEL | SYNC_WORKSPACE_WINDOW_LABEL | DB_MIGRATION_WORKSPACE_WINDOW_LABEL => {
            WindowCloseAction::HideToTray
        }
        _ => WindowCloseAction::HideWindow,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct AppConfig {
    shared: SharedConfig,
    personal: PersonalConfig,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct SharedConfig {
    db: DbConfig,
    search: SearchConfig,
    #[serde(default)]
    db_templates: Vec<DbTemplate>,
}
impl Default for SharedConfig {
    fn default() -> Self {
        Self {
            db: DbConfig::default(),
            search: SearchConfig::default(),
            db_templates: Vec::new(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct SearchConfig {
    exclude_tables: Vec<String>,
    per_table_timeout_sec: u64,
    per_table_max_rows: u32,
}
impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            exclude_tables: vec!["^t_log_.*".into(), "^tmp_.*".into()],
            per_table_timeout_sec: 10,
            per_table_max_rows: 50,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct PersonalConfig {
    widget_mode: String,
    hotkey: String,
    quick_date_hotkey: String,
    #[serde(default = "default_sync_window_hotkey")]
    sync_window_hotkey: String,
    #[serde(default = "default_db_migration_window_hotkey")]
    db_migration_window_hotkey: String,
    always_on_top: bool,
    auto_start: bool,
    ui_scale: f32,
    table_default_view: String,
    pet_locked: bool,
    pet_position: Option<WindowPosition>,
    idle_states: Vec<String>,
    export_hotkey: String,
    batch_export_hotkey: String,
    template_prev_hotkey: String,
    template_next_hotkey: String,
    reset_on_open_to_all_tables: bool,
    #[serde(default = "default_always_on_top_hotkey")]
    always_on_top_hotkey: String,
    #[serde(default = "default_pet_skin")]
    pet_skin: String,
    #[serde(default)]
    pet_scale: std::collections::HashMap<String, f64>,
    #[serde(default)]
    custom_font: Option<String>,
    #[serde(default = "default_true")]
    weather_enabled: bool,
    #[serde(default = "default_background_opacity")]
    background_opacity: f32,
    #[serde(default)]
    reduce_transparency_mode: bool,
    #[serde(default)]
    sync_profiles: Vec<SyncProfile>,
    #[serde(default)]
    default_sync_profile_id: Option<String>,
    #[serde(default)]
    last_used_sync_profile_id: Option<String>,
    #[serde(default)]
    db_migration_window_size: Option<DbMigrationWindowSize>,
    #[serde(default)]
    db_migration_last_connection: Option<DbMigrationRememberedConnection>,
    #[serde(default = "default_true")]
    auto_check_updates: bool,
    #[serde(default)]
    last_update_check_at: Option<String>,
}
fn default_true() -> bool {
    true
}
fn default_background_opacity() -> f32 {
    1.0
}
fn default_always_on_top_hotkey() -> String {
    "P".into()
}
fn default_sync_window_hotkey() -> String {
    "Shift+S".into()
}
fn default_db_migration_window_hotkey() -> String {
    DEFAULT_DB_MIGRATION_WINDOW_HOTKEY.into()
}
fn default_pet_skin() -> String {
    "eagle".into()
}

fn sanitize_db_migration_window_size(
    size: Option<DbMigrationWindowSize>,
) -> Option<DbMigrationWindowSize> {
    size.and_then(|value| {
        if !value.width.is_finite() || !value.height.is_finite() {
            return None;
        }
        Some(DbMigrationWindowSize {
            width: value.width.max(DB_MIGRATION_WORKSPACE_MIN_WIDTH).round(),
            height: value.height.max(DB_MIGRATION_WORKSPACE_MIN_HEIGHT).round(),
        })
    })
}

fn default_db_migration_window_size() -> DbMigrationWindowSize {
    DbMigrationWindowSize {
        width: DB_MIGRATION_WORKSPACE_WIDTH,
        height: DB_MIGRATION_WORKSPACE_HEIGHT,
    }
}

fn sanitize_db_migration_remembered_connection(
    connection: Option<DbMigrationRememberedConnection>,
) -> Option<DbMigrationRememberedConnection> {
    connection.and_then(|value| {
        let host = value.host.trim().to_string();
        let username = value.username.trim().to_string();
        if host.is_empty() || username.is_empty() {
            return None;
        }
        Some(DbMigrationRememberedConnection {
            host,
            port: if value.port == 0 { 3306 } else { value.port },
            username,
            password: value.password,
            source_database: value.source_database.trim().to_string(),
            target_database: value.target_database.trim().to_string(),
        })
    })
}

fn payload_to_db_migration_remembered_connection(
    payload: Option<DbMigrationRememberedConnectionPayload>,
) -> Option<DbMigrationRememberedConnection> {
    sanitize_db_migration_remembered_connection(payload.map(|value| {
        DbMigrationRememberedConnection {
            host: value.host,
            port: value.port,
            username: value.username,
            password: value.password,
            source_database: value.source_database,
            target_database: value.target_database,
        }
    }))
}

fn db_migration_remembered_connection_to_payload(
    connection: Option<DbMigrationRememberedConnection>,
) -> Option<DbMigrationRememberedConnectionPayload> {
    sanitize_db_migration_remembered_connection(connection).map(|value| {
        DbMigrationRememberedConnectionPayload {
            host: value.host,
            port: value.port,
            username: value.username,
            password: value.password,
            source_database: value.source_database,
            target_database: value.target_database,
        }
    })
}

fn clamp_db_migration_window_size_to_monitor(
    app: &tauri::AppHandle,
    size: DbMigrationWindowSize,
) -> DbMigrationWindowSize {
    let mut next = sanitize_db_migration_window_size(Some(size))
        .unwrap_or_else(default_db_migration_window_size);

    let monitor = if let Some(window) = app
        .get_webview_window(PANEL_WINDOW_LABEL)
        .or_else(|| app.get_webview_window(MAIN_WINDOW_LABEL))
    {
        window.current_monitor().ok().flatten()
    } else {
        app.primary_monitor().ok().flatten()
    };

    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let width_limit = (monitor.size().width as f64 / scale - 40.0).floor();
        let height_limit = (monitor.size().height as f64 / scale - 40.0).floor();

        if width_limit.is_finite() && width_limit > 0.0 {
            next.width = next
                .width
                .min(width_limit.max(DB_MIGRATION_WORKSPACE_MIN_WIDTH));
        }
        if height_limit.is_finite() && height_limit > 0.0 {
            next.height = next
                .height
                .min(height_limit.max(DB_MIGRATION_WORKSPACE_MIN_HEIGHT));
        }
    }

    next
}

fn resolve_db_migration_window_size_from_cache(state: &AppState) -> DbMigrationWindowSize {
    sanitize_db_migration_window_size(state.db_migration_window_size_sync.read().unwrap().clone())
        .unwrap_or_else(default_db_migration_window_size)
}

fn resolve_db_migration_window_size(app: &tauri::AppHandle) -> DbMigrationWindowSize {
    let state = app.state::<AppState>();
    clamp_db_migration_window_size_to_monitor(app, resolve_db_migration_window_size_from_cache(&state))
}
impl Default for PersonalConfig {
    fn default() -> Self {
        Self {
            widget_mode: "tray".into(),
            hotkey: "Ctrl+Shift+F".into(),
            quick_date_hotkey: "F9".into(),
            sync_window_hotkey: "Shift+S".into(),
            db_migration_window_hotkey: default_db_migration_window_hotkey(),
            always_on_top: true,
            auto_start: false,
            ui_scale: 1.0,
            table_default_view: "hits".into(),
            pet_locked: false,
            pet_position: None,
            idle_states: vec![
                "float_breathe".into(),
                "sleep_zzz".into(),
                "look_around".into(),
                "ghost_fade".into(),
                "wave_hello".into(),
                "charge_spell".into(),
                "jump_play".into(),
                "spin_show".into(),
            ],
            export_hotkey: "Ctrl+E".into(),
            batch_export_hotkey: "Ctrl+Shift+E".into(),
            template_prev_hotkey: "Ctrl+Alt+Left".into(),
            template_next_hotkey: "Ctrl+Alt+Right".into(),
            reset_on_open_to_all_tables: true,
            always_on_top_hotkey: "P".into(),
            pet_skin: "eagle".into(),
            pet_scale: std::collections::HashMap::new(),
            custom_font: None,
            weather_enabled: true,
            background_opacity: 1.0,
            reduce_transparency_mode: false,
            sync_profiles: Vec::new(),
            default_sync_profile_id: None,
            last_used_sync_profile_id: None,
            db_migration_window_size: None,
            db_migration_last_connection: None,
            auto_check_updates: true,
            last_update_check_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSettingsSnapshot {
    current_version: String,
    auto_check_updates: bool,
    last_update_check_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckPlan {
    should_check: bool,
    reason: String,
    checked_at: Option<String>,
    current_version: String,
}

fn parse_update_check_at(value: Option<&str>) -> Option<DateTime<Utc>> {
    let text = value?.trim();
    if text.is_empty() {
        return None;
    }

    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|parsed| parsed.with_timezone(&Utc))
}

fn build_update_check_plan(
    auto_check_updates: bool,
    _last_update_check_at: Option<&str>,
    now: DateTime<Utc>,
    manual: bool,
) -> UpdateCheckPlan {
    if manual {
        return UpdateCheckPlan {
            should_check: true,
            reason: "manual".into(),
            checked_at: Some(now.to_rfc3339()),
            current_version: String::new(),
        };
    }

    if !auto_check_updates {
        return UpdateCheckPlan {
            should_check: false,
            reason: "startup-disabled".into(),
            checked_at: None,
            current_version: String::new(),
        };
    }

    UpdateCheckPlan {
        should_check: true,
        reason: "startup-due".into(),
        checked_at: Some(now.to_rfc3339()),
        current_version: String::new(),
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowPosition {
    x: i32,
    y: i32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DbMigrationWindowSize {
    width: f64,
    height: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DbMigrationRememberedConnection {
    host: String,
    port: u16,
    username: String,
    password: String,
    source_database: String,
    target_database: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DbMigrationRememberedConnectionPayload {
    host: String,
    port: u16,
    username: String,
    password: String,
    source_database: String,
    target_database: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DbMigrationWorkspaceState {
    hotkey: String,
    remembered_connection: Option<DbMigrationRememberedConnectionPayload>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DbConfig {
    host: String,
    port: u16,
    username: String,
    password: String,
    database: String,
}
impl Default for DbConfig {
    fn default() -> Self {
        Self {
            host: "".into(),
            port: 3306,
            username: "".into(),
            password: "".into(),
            database: "".into(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DbTemplate {
    name: String,
    db: DbConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SkinAnimationDef {
    file: String,
    #[serde(rename = "frameWidth")]
    frame_width: u32,
    #[serde(rename = "frameHeight")]
    frame_height: u32,
    #[serde(rename = "frameCount")]
    frame_count: u32,
    fps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SkinManifest {
    name: String,
    animations: HashMap<String, SkinAnimationDef>,
    #[serde(rename = "searchAnim")]
    search_anim: String,
    #[serde(rename = "foundAnim")]
    found_anim: String,
    #[serde(rename = "defaultAnim")]
    default_anim: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SchemaCache {
    tables: Vec<TableMeta>,
    last_refresh: Option<DateTime<Utc>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TableMeta {
    table_name: String,
    table_comment: String,
    columns: Vec<ColumnMeta>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ColumnMeta {
    column_name: String,
    column_type: String,
    column_comment: String,
    is_primary_key: bool,
    is_nullable: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SchemaInfo {
    table_count: usize,
    column_count: usize,
    last_refresh: Option<DateTime<Utc>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConnectionStatus {
    connected: bool,
    database: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchParams {
    keyword: String,
    scope: SearchScope,
    target_table: Option<String>,
    target_tables: Option<Vec<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
enum SearchScope {
    All,
    MetaOnly,
    DataOnly,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SearchResponse {
    meta_results: Vec<MetaSearchResult>,
    data_results: Vec<DataSearchResult>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct MetaSearchResult {
    match_type: MatchType,
    table_name: String,
    column_name: Option<String>,
    matched_text: String,
    highlight_range: (usize, usize),
    score: i32,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
enum MatchType {
    TableName,
    ColumnName,
    TableComment,
    ColumnComment,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DataSearchResult {
    table_name: String,
    matched_rows: Vec<HashMap<String, String>>,
    matched_columns: Vec<String>,
    total_matches: u64,
    truncated: bool,
    first_row_index: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableData {
    table_name: String,
    table_comment: String,
    columns: Vec<ColumnMeta>,
    rows: Vec<HashMap<String, String>>,
    total_rows: u64,
    page: u32,
    page_size: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableChangeSet {
    table_name: String,
    primary_keys: Vec<String>,
    updates: Vec<RowUpdate>,
    inserts: Vec<HashMap<String, String>>,
    deletes: Vec<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RowUpdate {
    where_keys: HashMap<String, String>,
    changes: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SaveResult {
    updated: u64,
    inserted: u64,
    deleted: u64,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TableOption {
    table_name: String,
    table_comment: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    total_rows: u64,
    table_count: usize,
}
#[derive(Debug, Clone, Serialize)]
struct SearchProgress {
    current: usize,
    total: usize,
    current_table: String,
    status: &'static str,
}

#[derive(Debug, Clone, Serialize)]
struct PetMenuOpenedPayload {
    pet_locked: bool,
}

#[derive(Debug, Clone, Serialize)]
struct PetLockChangedPayload {
    locked: bool,
}

#[tauri::command]
async fn connect_db(
    config: DbConfig,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if config.host.trim().is_empty() || config.database.trim().is_empty() {
        return Err("请填写数据库主机和库名".into());
    }
    let opts = MySqlConnectOptions::new()
        .host(config.host.trim())
        .port(config.port)
        .username(config.username.trim())
        .password(&config.password)
        .database(config.database.trim())
        .ssl_mode(MySqlSslMode::Disabled);
    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .map_err(|e| format!("数据库连接失败: {e}"))?;
    let schema = load_schema_from_database(&pool, &config.database)
        .await
        .unwrap_or_else(|_| mock_schema_cache());
    let mut runtime = state.runtime.lock().await;
    runtime.pool = Some(pool);
    runtime.schema_cache = schema;
    runtime.config.shared.db = config;
    save_config_to_disk(&app, &runtime.config)?;
    Ok("数据库连接成功".into())
}
#[tauri::command]
async fn disconnect_db(state: State<'_, AppState>) -> Result<(), String> {
    state.runtime.lock().await.pool = None;
    Ok(())
}
#[tauri::command]
async fn get_connection_status(state: State<'_, AppState>) -> Result<ConnectionStatus, String> {
    let rt = state.runtime.lock().await;
    Ok(ConnectionStatus {
        connected: rt.pool.is_some(),
        database: if rt.config.shared.db.database.is_empty() {
            None
        } else {
            Some(rt.config.shared.db.database.clone())
        },
    })
}
#[tauri::command]
async fn refresh_schema(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SchemaInfo, String> {
    let (pool, db) = {
        let rt = state.runtime.lock().await;
        (rt.pool.clone(), rt.config.shared.db.database.clone())
    };
    let schema = if let Some(pool) = pool {
        load_schema_from_database(&pool, &db).await?
    } else {
        mock_schema_cache()
    };
    let info = SchemaInfo {
        table_count: schema.tables.len(),
        column_count: schema.tables.iter().map(|t| t.columns.len()).sum(),
        last_refresh: schema.last_refresh,
    };
    let mut rt = state.runtime.lock().await;
    rt.schema_cache = schema;
    save_config_to_disk(&app, &rt.config)?;
    Ok(info)
}
#[tauri::command]
async fn search(
    app: tauri::AppHandle,
    params: SearchParams,
    state: State<'_, AppState>,
) -> Result<SearchResponse, String> {
    let keyword = params.keyword.trim().to_string();
    if keyword.is_empty() {
        return Ok(SearchResponse {
            meta_results: vec![],
            data_results: vec![],
        });
    }
    let token = state.cancel_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let terms = split_terms(&keyword);
    let (pool, schema, cfg) = {
        let rt = state.runtime.lock().await;
        (
            rt.pool.clone(),
            if rt.schema_cache.tables.is_empty() {
                mock_schema_cache()
            } else {
                rt.schema_cache.clone()
            },
            rt.config.clone(),
        )
    };
    let mut targets = params.target_tables.clone().unwrap_or_default();
    if let Some(single) = params.target_table.clone() {
        targets.push(single);
    }
    let target_tables: Vec<String> = targets
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    let target_filter: Option<Vec<String>> = if target_tables.is_empty() {
        None
    } else {
        Some(target_tables)
    };

    let mut meta_results = if params.scope != SearchScope::DataOnly {
        meta_search(&schema, &terms)
    } else {
        vec![]
    };
    if let Some(targets) = &target_filter {
        meta_results.retain(|item| targets.iter().any(|target| item.table_name.eq_ignore_ascii_case(target)));
    }
    if params.scope == SearchScope::DataOnly {
        meta_results.clear();
    }
    let mut data_results = vec![];
    if params.scope != SearchScope::MetaOnly {
        let mut tables = schema.tables.clone();
        if let Some(targets) = &target_filter {
            tables.retain(|t| targets.iter().any(|target| t.table_name.eq_ignore_ascii_case(target)));
        }
        let patterns = compile_patterns(&cfg.shared.search.exclude_tables);
        tables.retain(|t| !patterns.iter().any(|p| p.is_match(&t.table_name)));
        let _ = app.emit(
            "search-progress",
            SearchProgress {
                current: 0,
                total: tables.len(),
                current_table: "".into(),
                status: "searching",
            },
        );
        for (i, table) in tables.iter().enumerate() {
            if state.cancel_seq.load(Ordering::SeqCst) != token {
                let _ = app.emit(
                    "search-progress",
                    SearchProgress {
                        current: i,
                        total: tables.len(),
                        current_table: table.table_name.clone(),
                        status: "cancelled",
                    },
                );
                return Ok(SearchResponse {
                    meta_results,
                    data_results,
                });
            }
            let _ = app.emit(
                "search-progress",
                SearchProgress {
                    current: i + 1,
                    total: tables.len(),
                    current_table: table.table_name.clone(),
                    status: "searching",
                },
            );
            let item = if let Some(pool) = &pool {
                search_table_data_in_db(
                    pool,
                    table,
                    &keyword,
                    cfg.shared.search.per_table_max_rows,
                    &terms,
                )
                .await?
            } else {
                search_table_data_in_mock(table, &terms, cfg.shared.search.per_table_max_rows)
            };
            if let Some(item) = item {
                data_results.push(item);
            }
        }
        let _ = app.emit(
            "search-progress",
            SearchProgress {
                current: tables.len(),
                total: tables.len(),
                current_table: "done".into(),
                status: "completed",
            },
        );
    }
    Ok(SearchResponse {
        meta_results,
        data_results,
    })
}
#[tauri::command]
async fn cancel_search(state: State<'_, AppState>) -> Result<(), String> {
    state.cancel_seq.fetch_add(1, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
async fn get_table_data(
    table_name: String,
    page: u32,
    page_size: u32,
    state: State<'_, AppState>,
) -> Result<TableData, String> {
    let page = page.max(1);
    let page_size = page_size.max(1).min(200);
    let (pool, schema) = {
        let rt = state.runtime.lock().await;
        (rt.pool.clone(), rt.schema_cache.clone())
    };
    let table = schema
        .tables
        .iter()
        .find(|t| t.table_name == table_name)
        .cloned()
        .or_else(|| {
            mock_schema_cache()
                .tables
                .into_iter()
                .find(|t| t.table_name == table_name)
        })
        .ok_or_else(|| "目标表不存在".to_string())?;
    if let Some(pool) = pool {
        let total_sql = format!(
            "SELECT COUNT(*) as cnt FROM `{}`",
            escape_ident(&table_name)
        );
        let total_row = sqlx::query(&total_sql)
            .fetch_one(&pool)
            .await
            .map_err(|e| format!("统计失败: {e}"))?;
        let total_rows: i64 = total_row.try_get("cnt").unwrap_or(0);
        let offset = (page.saturating_sub(1) * page_size) as i64;
        let select_cols = table
            .columns
            .iter()
            .map(|c| {
                format!(
                    "CAST(`{}` AS CHAR) AS `{}`",
                    escape_ident(&c.column_name),
                    escape_ident(&c.column_name)
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT {} FROM `{}` LIMIT {} OFFSET {}",
            select_cols,
            escape_ident(&table_name),
            page_size,
            offset
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("读取失败: {e}"))?;
        return Ok(TableData {
            table_name,
            table_comment: table.table_comment,
            columns: table.columns.clone(),
            rows: map_rows_to_string_map(rows, &table.columns),
            total_rows: total_rows.max(0) as u64,
            page,
            page_size,
        });
    }
    let data = mock_rows_for_table(&table_name);
    let total_rows = data.len() as u64;
    let s = (page.saturating_sub(1) * page_size) as usize;
    let e = (s + page_size as usize).min(data.len());
    let rows = if s >= data.len() {
        vec![]
    } else {
        data[s..e].to_vec()
    };
    Ok(TableData {
        table_name,
        table_comment: table.table_comment,
        columns: table.columns,
        rows,
        total_rows,
        page,
        page_size,
    })
}

#[tauri::command]
async fn save_table_changes(
    changeset: TableChangeSet,
    state: State<'_, AppState>,
) -> Result<SaveResult, String> {
    let pool = {
        let rt = state.runtime.lock().await;
        rt.pool
            .clone()
            .ok_or_else(|| "数据库未连接".to_string())?
    };
    let table = escape_ident(&changeset.table_name);
    let has_pk = !changeset.primary_keys.is_empty();
    let mut warnings: Vec<String> = Vec::new();
    let mut deleted: u64 = 0;
    let mut updated: u64 = 0;
    let mut inserted: u64 = 0;

    let mut tx = pool.begin().await.map_err(|e| format!("开启事务失败: {e}"))?;

    // --- DELETE ---
    for del_row in &changeset.deletes {
        if del_row.is_empty() {
            continue;
        }
        let (where_clause, where_vals) = if has_pk {
            build_where_from_keys(&changeset.primary_keys, del_row)?
        } else {
            build_where_from_all(del_row)?
        };
        let sql = if has_pk {
            format!("DELETE FROM `{}` WHERE {}", table, where_clause)
        } else {
            format!("DELETE FROM `{}` WHERE {} LIMIT 1", table, where_clause)
        };
        let mut q = sqlx::query(&sql);
        for v in &where_vals {
            q = q.bind(v);
        }
        let result = q.execute(&mut *tx).await.map_err(|e| format!("删除失败: {e}"))?;
        deleted += result.rows_affected();
        if !has_pk {
            warnings.push(format!("无主键表删除使用全列匹配 LIMIT 1"));
        }
    }

    // --- UPDATE ---
    for upd in &changeset.updates {
        if upd.changes.is_empty() {
            continue;
        }
        let set_cols: Vec<String> = upd
            .changes
            .keys()
            .map(|k| format!("`{}` = ?", escape_ident(k)))
            .collect();
        let set_vals: Vec<&String> = upd.changes.values().collect();

        let (where_clause, where_vals) = if has_pk {
            build_where_from_keys(&changeset.primary_keys, &upd.where_keys)?
        } else {
            build_where_from_all(&upd.where_keys)?
        };

        let sql = if has_pk {
            format!(
                "UPDATE `{}` SET {} WHERE {}",
                table,
                set_cols.join(", "),
                where_clause
            )
        } else {
            format!(
                "UPDATE `{}` SET {} WHERE {} LIMIT 1",
                table,
                set_cols.join(", "),
                where_clause
            )
        };

        let mut q = sqlx::query(&sql);
        for v in &set_vals {
            q = q.bind(*v);
        }
        for v in &where_vals {
            q = q.bind(v);
        }
        let result = q.execute(&mut *tx).await.map_err(|e| format!("更新失败: {e}"))?;
        updated += result.rows_affected();
        if !has_pk {
            warnings.push(format!("无主键表更新使用全列匹配 LIMIT 1"));
        }
    }

    // --- INSERT ---
    for ins_row in &changeset.inserts {
        if ins_row.is_empty() {
            continue;
        }
        let cols: Vec<String> = ins_row.keys().map(|k| format!("`{}`", escape_ident(k))).collect();
        let placeholders: Vec<&str> = ins_row.keys().map(|_| "?").collect();
        let vals: Vec<&String> = ins_row.values().collect();
        let sql = format!(
            "INSERT INTO `{}` ({}) VALUES ({})",
            table,
            cols.join(", "),
            placeholders.join(", ")
        );
        let mut q = sqlx::query(&sql);
        for v in &vals {
            q = q.bind(*v);
        }
        let result = q.execute(&mut *tx).await.map_err(|e| format!("插入失败: {e}"))?;
        inserted += result.rows_affected();
    }

    tx.commit().await.map_err(|e| format!("提交事务失败: {e}"))?;

    // Deduplicate warnings
    warnings.sort();
    warnings.dedup();

    Ok(SaveResult {
        updated,
        inserted,
        deleted,
        warnings,
    })
}

fn build_where_from_keys(
    pk_cols: &[String],
    row: &HashMap<String, String>,
) -> Result<(String, Vec<String>), String> {
    let mut parts = Vec::new();
    let mut vals = Vec::new();
    for col in pk_cols {
        let val = row
            .get(col)
            .ok_or_else(|| format!("缺少主键列值: {}", col))?;
        parts.push(format!("`{}` = ?", escape_ident(col)));
        vals.push(val.clone());
    }
    if parts.is_empty() {
        return Err("WHERE 条件为空".to_string());
    }
    Ok((parts.join(" AND "), vals))
}

fn build_where_from_all(
    row: &HashMap<String, String>,
) -> Result<(String, Vec<String>), String> {
    let mut parts = Vec::new();
    let mut vals = Vec::new();
    for (col, val) in row {
        parts.push(format!("`{}` = ?", escape_ident(col)));
        vals.push(val.clone());
    }
    if parts.is_empty() {
        return Err("WHERE 条件为空".to_string());
    }
    Ok((parts.join(" AND "), vals))
}

#[tauri::command]
async fn list_tables(state: State<'_, AppState>) -> Result<Vec<TableOption>, String> {
    let schema = {
        let rt = state.runtime.lock().await;
        if rt.schema_cache.tables.is_empty() {
            mock_schema_cache()
        } else {
            rt.schema_cache.clone()
        }
    };
    let mut out = schema
        .tables
        .iter()
        .map(|item| TableOption {
            table_name: item.table_name.clone(),
            table_comment: item.table_comment.clone(),
        })
        .collect::<Vec<_>>();
    out.sort_by(|a, b| a.table_name.cmp(&b.table_name));
    Ok(out)
}

#[tauri::command]
fn list_system_fonts() -> Result<Vec<String>, String> {
    use font_kit::source::SystemSource;
    let source = SystemSource::new();
    let families = source
        .all_families()
        .map_err(|e| format!("Failed to list fonts: {}", e))?;
    let mut sorted = families;
    sorted.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    sorted.dedup();
    Ok(sorted)
}

#[tauri::command]
async fn export_tables_xlsx(
    tables: Vec<String>,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<ExportResult, String> {
    use rust_xlsxwriter::{Format, Workbook};

    let (pool, schema) = {
        let rt = state.runtime.lock().await;
        (
            rt.pool
                .clone()
                .ok_or_else(|| "数据库未连接".to_string())?,
            rt.schema_cache.clone(),
        )
    };

    let mut workbook = Workbook::new();
    let bold = Format::new().set_bold();
    let mut total_rows: u64 = 0;
    let table_count = tables.len();

    for table_name in &tables {
        let table_meta = schema
            .tables
            .iter()
            .find(|t| &t.table_name == table_name)
            .ok_or_else(|| format!("表 {} 不存在", table_name))?;

        // Sheet name max 31 chars
        let sheet_name: String = table_name.chars().take(31).collect();
        let worksheet = workbook
            .add_worksheet()
            .set_name(&sheet_name)
            .map_err(|e| format!("创建工作表失败: {e}"))?;

        // Write header row
        for (col_idx, col) in table_meta.columns.iter().enumerate() {
            worksheet
                .write_string_with_format(0, col_idx as u16, &col.column_name, &bold)
                .map_err(|e| format!("写入表头失败: {e}"))?;
        }

        // Query all data
        let select_cols = table_meta
            .columns
            .iter()
            .map(|c| {
                format!(
                    "CAST(`{}` AS CHAR) AS `{}`",
                    escape_ident(&c.column_name),
                    escape_ident(&c.column_name)
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT {} FROM `{}`",
            select_cols,
            escape_ident(table_name)
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("读取表 {} 失败: {e}", table_name))?;

        total_rows += rows.len() as u64;

        for (row_idx, row) in rows.iter().enumerate() {
            for (col_idx, col) in table_meta.columns.iter().enumerate() {
                let val: Option<String> = row.try_get(col.column_name.as_str()).unwrap_or(None);
                if let Some(v) = val {
                    let _ = worksheet.write_string((row_idx + 1) as u32, col_idx as u16, &v);
                }
            }
        }
    }

    workbook
        .save(&file_path)
        .map_err(|e| format!("保存文件失败: {e}"))?;

    Ok(ExportResult {
        total_rows,
        table_count,
    })
}

#[tauri::command]
async fn export_tables_xlsx_batch(
    tables: Vec<String>,
    dir_path: String,
    state: State<'_, AppState>,
) -> Result<ExportResult, String> {
    use rust_xlsxwriter::{Format, Workbook};

    let (pool, schema) = {
        let rt = state.runtime.lock().await;
        (
            rt.pool
                .clone()
                .ok_or_else(|| "数据库未连接".to_string())?,
            rt.schema_cache.clone(),
        )
    };

    let bold = Format::new().set_bold();
    let mut total_rows: u64 = 0;
    let table_count = tables.len();

    for table_name in &tables {
        let table_meta = schema
            .tables
            .iter()
            .find(|t| &t.table_name == table_name)
            .ok_or_else(|| format!("表 {} 不存在", table_name))?;

        let mut workbook = Workbook::new();
        let sheet_name: String = table_name.chars().take(31).collect();
        let worksheet = workbook
            .add_worksheet()
            .set_name(&sheet_name)
            .map_err(|e| format!("创建工作表失败: {e}"))?;

        for (col_idx, col) in table_meta.columns.iter().enumerate() {
            worksheet
                .write_string_with_format(0, col_idx as u16, &col.column_name, &bold)
                .map_err(|e| format!("写入表头失败: {e}"))?;
        }

        let select_cols = table_meta
            .columns
            .iter()
            .map(|c| {
                format!(
                    "CAST(`{}` AS CHAR) AS `{}`",
                    escape_ident(&c.column_name),
                    escape_ident(&c.column_name)
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT {} FROM `{}`",
            select_cols,
            escape_ident(table_name)
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("读取表 {} 失败: {e}", table_name))?;

        total_rows += rows.len() as u64;

        for (row_idx, row) in rows.iter().enumerate() {
            for (col_idx, col) in table_meta.columns.iter().enumerate() {
                let val: Option<String> = row.try_get(col.column_name.as_str()).unwrap_or(None);
                if let Some(v) = val {
                    let _ = worksheet.write_string((row_idx + 1) as u32, col_idx as u16, &v);
                }
            }
        }

        let file_path = format!("{}/{}.xlsx", dir_path.trim_end_matches(['/', '\\']), table_name);
        workbook
            .save(&file_path)
            .map_err(|e| format!("保存文件 {} 失败: {e}", file_path))?;
    }

    Ok(ExportResult {
        total_rows,
        table_count,
    })
}

#[tauri::command]
async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.runtime.lock().await.config.clone())
}
#[tauri::command]
async fn save_config(
    config: AppConfig,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.runtime.lock().await.config = config.clone();
    save_config_to_disk(&app, &config)
}

#[tauri::command]
async fn get_update_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateSettingsSnapshot, String> {
    let config = state.runtime.lock().await.config.clone();
    Ok(UpdateSettingsSnapshot {
        current_version: app.package_info().version.to_string(),
        auto_check_updates: config.personal.auto_check_updates,
        last_update_check_at: config.personal.last_update_check_at,
    })
}

#[tauri::command]
async fn prepare_startup_update_check(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateCheckPlan, String> {
    let current_version = app.package_info().version.to_string();
    let now = Utc::now();
    let mut rt = state.runtime.lock().await;
    let mut plan = build_update_check_plan(
        rt.config.personal.auto_check_updates,
        rt.config.personal.last_update_check_at.as_deref(),
        now,
        false,
    );
    plan.current_version = current_version;

    if let Some(checked_at) = plan.checked_at.clone() {
        rt.config.personal.last_update_check_at = Some(checked_at);
        save_config_to_disk(&app, &rt.config)?;
    }

    Ok(plan)
}

#[tauri::command]
async fn check_for_updates_now(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateCheckPlan, String> {
    let current_version = app.package_info().version.to_string();
    let now = Utc::now();
    let mut rt = state.runtime.lock().await;
    let mut plan = build_update_check_plan(
        rt.config.personal.auto_check_updates,
        rt.config.personal.last_update_check_at.as_deref(),
        now,
        true,
    );
    plan.current_version = current_version;

    if let Some(checked_at) = plan.checked_at.clone() {
        rt.config.personal.last_update_check_at = Some(checked_at);
        save_config_to_disk(&app, &rt.config)?;
    }

    Ok(plan)
}

#[tauri::command]
async fn register_hotkey(
    hotkey: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let normalized = normalize_hotkey_for_plugin(&hotkey)?;
    let (previous, quick_date, sync_window_hotkey, db_migration_window_hotkey) = {
        let rt = state.runtime.lock().await;
        (
            rt.registered_hotkey.clone(),
            rt.registered_quick_date_hotkey.clone(),
            rt.registered_sync_window_hotkey.clone(),
            rt.registered_db_migration_window_hotkey.clone(),
        )
    };
    if quick_date.as_deref() == Some(normalized.as_str())
        || sync_window_hotkey.as_deref() == Some(normalized.as_str())
        || db_migration_window_hotkey.as_deref() == Some(normalized.as_str())
    {
        return Err("主快捷键不能与其他全局快捷键重复".into());
    }
    let manager = app.global_shortcut();

    if previous.as_deref() == Some(normalized.as_str()) {
        return Ok(normalized);
    }

    if let Some(ref prev) = previous {
        let _ = manager.unregister(prev.as_str());
    }

    manager
        .register(normalized.as_str())
        .map_err(|e| format!("快捷键注册失败: {e}"))?;

    *state.panel_hotkey_sync.write().unwrap() = Some(normalized.clone());
    state.runtime.lock().await.registered_hotkey = Some(normalized.clone());
    Ok(normalized)
}

#[tauri::command]
async fn register_quick_date_hotkey(
    hotkey: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let normalized = normalize_hotkey_for_plugin(&hotkey)?;
    let (previous, panel_hotkey, sync_window_hotkey, db_migration_window_hotkey) = {
        let rt = state.runtime.lock().await;
        (
            rt.registered_quick_date_hotkey.clone(),
            rt.registered_hotkey.clone(),
            rt.registered_sync_window_hotkey.clone(),
            rt.registered_db_migration_window_hotkey.clone(),
        )
    };
    if panel_hotkey.as_deref() == Some(normalized.as_str())
        || sync_window_hotkey.as_deref() == Some(normalized.as_str())
        || db_migration_window_hotkey.as_deref() == Some(normalized.as_str())
    {
        return Err("日期快捷键不能与其他全局快捷键重复".into());
    }
    let manager = app.global_shortcut();

    if previous.as_deref() == Some(normalized.as_str()) {
        return Ok(normalized);
    }

    if let Some(ref prev) = previous {
        let _ = manager.unregister(prev.as_str());
    }

    manager
        .register(normalized.as_str())
        .map_err(|e| format!("日期快捷键注册失败: {e}"))?;

    *state.quick_date_hotkey_sync.write().unwrap() = Some(normalized.clone());
    state.runtime.lock().await.registered_quick_date_hotkey = Some(normalized.clone());
    Ok(normalized)
}

#[tauri::command]
async fn register_sync_window_hotkey(
    hotkey: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let normalized = normalize_hotkey_for_plugin(&hotkey)?;
    let (previous, panel_hotkey, quick_date_hotkey, db_migration_window_hotkey) = {
        let rt = state.runtime.lock().await;
        (
            rt.registered_sync_window_hotkey.clone(),
            rt.registered_hotkey.clone(),
            rt.registered_quick_date_hotkey.clone(),
            rt.registered_db_migration_window_hotkey.clone(),
        )
    };
    if panel_hotkey.as_deref() == Some(normalized.as_str())
        || quick_date_hotkey.as_deref() == Some(normalized.as_str())
        || db_migration_window_hotkey.as_deref() == Some(normalized.as_str())
    {
        return Err("同步工作台快捷键不能与其他全局快捷键重复".into());
    }
    let manager = app.global_shortcut();

    if previous.as_deref() == Some(normalized.as_str()) {
        return Ok(normalized);
    }

    // Unregister previous before registering the new one
    if let Some(ref prev) = previous {
        let _ = manager.unregister(prev.as_str());
    }

    manager
        .register(normalized.as_str())
        .map_err(|e| format!("同步窗口快捷键注册失败: {e}"))?;

    *state.sync_window_hotkey_sync.write().unwrap() = Some(normalized.clone());
    state.runtime.lock().await.registered_sync_window_hotkey = Some(normalized.clone());
    Ok(normalized)
}

#[tauri::command]
async fn register_db_migration_window_hotkey(
    hotkey: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let normalized = if hotkey.trim().is_empty() {
        normalize_hotkey_for_plugin(default_db_migration_window_hotkey().as_str())?
    } else {
        normalize_hotkey_for_plugin(&hotkey)?
    };

    let (previous, panel_hotkey, quick_date_hotkey, sync_window_hotkey) = {
        let rt = state.runtime.lock().await;
        (
            rt.registered_db_migration_window_hotkey.clone(),
            rt.registered_hotkey.clone(),
            rt.registered_quick_date_hotkey.clone(),
            rt.registered_sync_window_hotkey.clone(),
        )
    };

    if panel_hotkey.as_deref() == Some(normalized.as_str())
        || quick_date_hotkey.as_deref() == Some(normalized.as_str())
        || sync_window_hotkey.as_deref() == Some(normalized.as_str())
    {
        return Err("数据库迁移工作台快捷键不能与其他全局快捷键重复".into());
    }

    let manager = app.global_shortcut();

    if previous.as_deref() != Some(normalized.as_str()) {
        if let Some(ref prev) = previous {
            let _ = manager.unregister(prev.as_str());
        }

        manager
            .register(normalized.as_str())
            .map_err(|e| format!("数据库迁移工作台快捷键注册失败: {e}"))?;
    }

    *state.db_migration_window_hotkey_sync.write().unwrap() = Some(normalized.clone());

    let mut rt = state.runtime.lock().await;
    rt.registered_db_migration_window_hotkey = Some(normalized.clone());
    rt.config.personal.db_migration_window_hotkey = normalized.clone();
    save_config_to_disk(&app, &rt.config)?;

    Ok(normalized)
}

#[tauri::command]
async fn show_sync_workspace_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = ensure_sync_workspace_window(&app)?;
    window.show().map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn hide_sync_workspace_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SYNC_WORKSPACE_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_sync_workspace_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = ensure_sync_workspace_window(&app)?;
    let visible = window.is_visible().map_err(|e| e.to_string())?;
    if visible {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        window.show().map_err(|e| e.to_string())?;
        let _ = window.unminimize();
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn show_db_migration_window(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    let window = ensure_db_migration_workspace_window(&app)?;
    window.show().map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn hide_db_migration_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if state.db_migration_running_sync.load(Ordering::SeqCst) {
        return Err("数据库迁移进行中，不能隐藏窗口".into());
    }
    if let Some(window) = app.get_webview_window(DB_MIGRATION_WORKSPACE_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_db_migration_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let window = ensure_db_migration_workspace_window(&app)?;
    let visible = window.is_visible().map_err(|e| e.to_string())?;
    let running = state.db_migration_running_sync.load(Ordering::SeqCst);
    if visible {
        if running {
            let _ = window.unminimize();
            let _ = window.set_focus();
            return Ok(());
        }
        window.hide().map_err(|e| e.to_string())?;
        return Ok(());
    }

    window.show().map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_db_migration_workspace_state(
    state: State<'_, AppState>,
) -> Result<DbMigrationWorkspaceState, String> {
    let rt = state.runtime.lock().await;
    Ok(DbMigrationWorkspaceState {
        hotkey: rt.config.personal.db_migration_window_hotkey.clone(),
        remembered_connection: db_migration_remembered_connection_to_payload(
            rt.config.personal.db_migration_last_connection.clone(),
        ),
    })
}

#[tauri::command]
async fn save_db_migration_workspace_connection(
    connection: Option<DbMigrationRememberedConnectionPayload>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut rt = state.runtime.lock().await;
    rt.config.personal.db_migration_last_connection =
        payload_to_db_migration_remembered_connection(connection);
    save_config_to_disk(&app, &rt.config)?;
    Ok(())
}

#[tauri::command]
async fn connect_db_migration_server(
    params: DbMigrationLoginParams,
) -> Result<DbMigrationLoginResult, String> {
    connect_db_migration_server_impl(params).await
}

#[tauri::command]
async fn run_db_migration(
    request: DbMigrationRequest,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<DbMigrationOutcome, String> {
    state
        .db_migration_running_sync
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "当前已有数据库迁移任务在执行中，请稍后再试".to_string())?;

    let result = run_db_migration_impl(&app, request).await;
    state
        .db_migration_running_sync
        .store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
async fn open_directory_in_explorer(path: String) -> Result<(), String> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("目标目录不能为空".into());
    }
    if !path.exists() {
        return Err(format!("目标目录不存在: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("目标路径不是目录: {}", path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开资源管理器失败: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开目录失败: {e}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开目录失败: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
async fn run_sync_profile(
    profile_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SyncRunOutcome, String> {
    let profile = {
        let mut rt = state.runtime.lock().await;
        if rt.sync_running {
            return Err("当前已有同步任务在进行中，请等待完成后再试".into());
        }
        let profile = rt
            .config
            .personal
            .sync_profiles
            .iter()
            .find(|item| item.id == profile_id)
            .cloned()
            .ok_or_else(|| format!("未找到同步配置: {profile_id}"))?;
        rt.sync_running = true;
        profile
    };

    let app_handle = app.clone();
    let profile_for_run = profile.clone();
    let outcome_result = tauri::async_runtime::spawn_blocking(move || {
        execute_sync_pipeline(&app_handle, &profile_for_run)
    })
    .await
    .map_err(|e| format!("同步任务线程失败: {e}"))?;

    let finished_at = Utc::now().to_rfc3339();
    let mut rt = state.runtime.lock().await;
    rt.sync_running = false;
    rt.config.personal.last_used_sync_profile_id = Some(profile_id.clone());

    match outcome_result {
        Ok(outcome) => {
            if let Some(item) = rt
                .config
                .personal
                .sync_profiles
                .iter_mut()
                .find(|item| item.id == profile_id)
            {
                item.last_run_status = "success".into();
                item.last_run_at = Some(finished_at);
                item.last_run_summary = outcome.summary.clone();
            }
            save_config_to_disk(&app, &rt.config)?;
            Ok(outcome)
        }
        Err(error) => {
            if let Some(item) = rt
                .config
                .personal
                .sync_profiles
                .iter_mut()
                .find(|item| item.id == profile_id)
            {
                item.last_run_status = "error".into();
                item.last_run_at = Some(finished_at);
                item.last_run_summary = summarize_sync_error(&error);
            }
            save_config_to_disk(&app, &rt.config)?;
            Err(error)
        }
    }
}

#[tauri::command]
async fn show_panel_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    open_settings: Option<bool>,
) -> Result<(), String> {
    let always_on_top = state.runtime.lock().await.config.personal.always_on_top;
    let panel = activate_panel_window(&app, always_on_top)?;
    if open_settings.unwrap_or(false) {
        state.runtime.lock().await.panel_open_settings_pending = true;
        let _ = panel.emit("panel-open-settings", ());
    }
    Ok(())
}

#[tauri::command]
async fn hide_panel_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(panel) = app.get_webview_window(PANEL_WINDOW_LABEL) {
        panel.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_panel_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    open_settings: Option<bool>,
) -> Result<(), String> {
    let always_on_top = state.runtime.lock().await.config.personal.always_on_top;
    let panel = ensure_panel_window(&app, always_on_top)?;
    let visible = panel.is_visible().map_err(|e| e.to_string())?;

    if visible {
        panel.hide().map_err(|e| e.to_string())?;
    } else {
        panel.show().map_err(|e| e.to_string())?;
        let _ = panel.unminimize();
        panel.set_focus().map_err(|e| e.to_string())?;
        if open_settings.unwrap_or(false) {
            state.runtime.lock().await.panel_open_settings_pending = true;
            let _ = panel.emit("panel-open-settings", ());
        }
    }
    Ok(())
}

#[tauri::command]
async fn consume_panel_open_settings(state: State<'_, AppState>) -> Result<bool, String> {
    let mut rt = state.runtime.lock().await;
    let pending = rt.panel_open_settings_pending;
    rt.panel_open_settings_pending = false;
    Ok(pending)
}

#[tauri::command]
async fn set_panel_always_on_top(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    always_on_top: bool,
) -> Result<(), String> {
    {
        let mut rt = state.runtime.lock().await;
        rt.config.personal.always_on_top = always_on_top;
        save_config_to_disk(&app, &rt.config)?;
    }

    if let Some(panel) = app.get_webview_window(PANEL_WINDOW_LABEL) {
        let _ = panel.set_always_on_top(always_on_top);
    }
    Ok(())
}

#[tauri::command]
async fn show_pet_menu(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let pet_locked = {
        let rt = state.runtime.lock().await;
        if rt.pet_hidden_this_session {
            return Ok(());
        }
        rt.config.personal.pet_locked
    };
    let menu = ensure_pet_menu_window(&app)?;

    let mut menu_x = x + 6.0;
    let mut menu_y = y + 6.0;
    if let Ok(Some(monitor)) = menu.current_monitor() {
        let monitor_pos = monitor.position();
        let monitor_size = monitor.size();
        let min_x = monitor_pos.x as f64 + 6.0;
        let min_y = monitor_pos.y as f64 + 6.0;
        let max_x = monitor_pos.x as f64 + monitor_size.width as f64 - PET_MENU_WIDTH - 6.0;
        let max_y = monitor_pos.y as f64 + monitor_size.height as f64 - PET_MENU_HEIGHT - 6.0;
        menu_x = menu_x.clamp(min_x, max_x.max(min_x));
        menu_y = menu_y.clamp(min_y, max_y.max(min_y));
    }

    menu.set_size(Size::Logical(LogicalSize::new(
        PET_MENU_WIDTH,
        PET_MENU_HEIGHT,
    )))
    .map_err(|e| e.to_string())?;
    menu.set_position(Position::Logical(LogicalPosition::new(menu_x, menu_y)))
        .map_err(|e| e.to_string())?;
    menu.show().map_err(|e| e.to_string())?;
    menu.set_focus().map_err(|e| e.to_string())?;
    let _ = menu.emit("pet-menu-opened", PetMenuOpenedPayload { pet_locked });
    Ok(())
}

#[tauri::command]
async fn hide_pet_menu(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(menu) = app.get_webview_window(PET_MENU_WINDOW_LABEL) {
        menu.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn hide_pet_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.runtime.lock().await.pet_hidden_this_session = true;
    if let Some(menu) = app.get_webview_window(PET_MENU_WINDOW_LABEL) {
        let _ = menu.hide();
    }
    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        main_window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_pet_lock(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let locked = {
        let mut rt = state.runtime.lock().await;
        rt.config.personal.pet_locked = !rt.config.personal.pet_locked;
        let locked = rt.config.personal.pet_locked;
        save_config_to_disk(&app, &rt.config)?;
        locked
    };

    let _ = app.emit("pet-lock-changed", PetLockChangedPayload { locked });
    Ok(locked)
}

#[tauri::command]
async fn save_pet_position(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    x: i32,
    y: i32,
) -> Result<(), String> {
    let mut rt = state.runtime.lock().await;
    rt.config.personal.pet_position = Some(WindowPosition { x, y });
    save_config_to_disk(&app, &rt.config)
}

#[tauri::command]
async fn resize_pet_window(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        main_window
            .set_size(Size::Logical(LogicalSize::new(width, height)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn update_pet_hitbox(
    state: State<'_, AppState>,
    hitbox: PetHitbox,
) -> Result<(), String> {
    *state.pet_hitbox.write().unwrap() = Some(hitbox);
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn activate_panel_window(
    app: &tauri::AppHandle,
    always_on_top: bool,
) -> Result<WebviewWindow, String> {
    let panel = ensure_panel_window(app, always_on_top)?;
    panel.show().map_err(|e| e.to_string())?;
    let _ = panel.unminimize();
    panel.set_focus().map_err(|e| e.to_string())?;
    Ok(panel)
}

fn ensure_panel_window(
    app: &tauri::AppHandle,
    always_on_top: bool,
) -> Result<WebviewWindow, String> {
    if let Some(panel) = app.get_webview_window(PANEL_WINDOW_LABEL) {
        let _ = panel.set_always_on_top(always_on_top);
        return Ok(panel);
    }

    let panel = WebviewWindowBuilder::new(
        app,
        PANEL_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("DB Scout")
    .inner_size(PANEL_WIDTH, PANEL_HEIGHT)
    .min_inner_size(680.0, 720.0)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(always_on_top)
    .skip_taskbar(false)
    .visible(false)
    .drag_and_drop(false)
    .build()
    .map_err(|e| format!("failed to create panel window: {e}"))?;

    let panel_for_events = panel.clone();
    panel.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            match close_request_action_for_window(PANEL_WINDOW_LABEL) {
                WindowCloseAction::HideToTray | WindowCloseAction::HideWindow => {
                    let _ = panel_for_events.hide();
                }
            }
        }
    });

    Ok(panel)
}

fn ensure_sync_workspace_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(SYNC_WORKSPACE_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        SYNC_WORKSPACE_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("DB Scout Sync")
    .inner_size(SYNC_WORKSPACE_WIDTH, SYNC_WORKSPACE_HEIGHT)
    .min_inner_size(680.0, 500.0)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(false)
    .skip_taskbar(false)
    .visible(false)
    .drag_and_drop(false)
    .build()
    .map_err(|e| format!("failed to create sync workspace window: {e}"))?;

    let window_for_events = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            match close_request_action_for_window(SYNC_WORKSPACE_WINDOW_LABEL) {
                WindowCloseAction::HideToTray | WindowCloseAction::HideWindow => {
                    let _ = window_for_events.hide();
                }
            }
        }
    });

    Ok(window)
}

async fn persist_db_migration_window_size(
    app: tauri::AppHandle,
    state: AppState,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(DB_MIGRATION_WORKSPACE_WINDOW_LABEL) else {
        return Ok(());
    };

    if window.is_maximized().map_err(|e| e.to_string())? {
        return Ok(());
    }

    let physical_size = window.inner_size().map_err(|e| e.to_string())?;
    let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;
    let logical_size = DbMigrationWindowSize {
        width: physical_size.width as f64 / scale_factor,
        height: physical_size.height as f64 / scale_factor,
    };

    let mut rt = state.runtime.lock().await;
    rt.config.personal.db_migration_window_size =
        sanitize_db_migration_window_size(Some(logical_size));
    *state.db_migration_window_size_sync.write().unwrap() =
        rt.config.personal.db_migration_window_size.clone();
    save_config_to_disk(&app, &rt.config)?;
    Ok(())
}

fn schedule_db_migration_window_size_save(app: tauri::AppHandle) {
    let state = app.state::<AppState>().inner().clone();
    let seq = state
        .db_migration_resize_seq
        .fetch_add(1, Ordering::SeqCst)
        + 1;

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(220)).await;
        if state.db_migration_resize_seq.load(Ordering::SeqCst) != seq {
            return;
        }
        if let Err(e) = persist_db_migration_window_size(app.clone(), state.clone()).await {
            eprintln!("failed to persist db migration workspace size: {e}");
        }
    });
}

fn ensure_db_migration_workspace_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(DB_MIGRATION_WORKSPACE_WINDOW_LABEL) {
        return Ok(window);
    }

    let remembered_size = resolve_db_migration_window_size(app);

    let window = WebviewWindowBuilder::new(
        app,
        DB_MIGRATION_WORKSPACE_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("DB Scout Migration")
    .inner_size(remembered_size.width, remembered_size.height)
    .min_inner_size(
        DB_MIGRATION_WORKSPACE_MIN_WIDTH,
        DB_MIGRATION_WORKSPACE_MIN_HEIGHT,
    )
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(false)
    .skip_taskbar(false)
    .visible(false)
    .drag_and_drop(false)
    .build()
    .map_err(|e| format!("failed to create db migration workspace window: {e}"))?;

    let window_for_events = window.clone();
    let app_handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let running = app_handle
                .state::<AppState>()
                .db_migration_running_sync
                .load(Ordering::SeqCst);
            if running {
                let _ = window_for_events.show();
                let _ = window_for_events.set_focus();
                return;
            }
            let _ = window_for_events.hide();
        }
        WindowEvent::Resized(_) => {
            schedule_db_migration_window_size_save(app_handle.clone());
        }
        _ => {}
    });

    Ok(window)
}

fn ensure_pet_menu_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(menu) = app.get_webview_window(PET_MENU_WINDOW_LABEL) {
        return Ok(menu);
    }

    let menu = WebviewWindowBuilder::new(
        app,
        PET_MENU_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Pet Menu")
    .inner_size(PET_MENU_WIDTH, PET_MENU_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map_err(|e| format!("failed to create pet menu window: {e}"))?;

    let menu_for_events = menu.clone();
    menu.on_window_event(move |event| match event {
        WindowEvent::Focused(false) => {
            let _ = menu_for_events.hide();
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = menu_for_events.hide();
        }
        _ => {}
    });

    Ok(menu)
}

fn normalize_hotkey_for_plugin(raw: &str) -> Result<String, String> {
    let tokens = raw
        .split('+')
        .map(|part| part.trim().to_lowercase())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return Err("快捷键不能为空".into());
    }

    let mut ctrl = false;
    let mut shift = false;
    let mut alt = false;
    let mut meta = false;
    let mut key: Option<String> = None;

    for token in tokens {
        match token.as_str() {
            "ctrl" | "control" => ctrl = true,
            "shift" => shift = true,
            "alt" | "option" => alt = true,
            "meta" | "super" | "win" | "command" | "cmd" => meta = true,
            _ => {
                let normalized_key = normalize_shortcut_main_key(&token)
                    .ok_or_else(|| format!("不支持的快捷键按键: {token}"))?;
                key = Some(normalized_key);
            }
        }
    }

    let key = key.ok_or_else(|| "快捷键需要包含至少一个非修饰键，例如 Ctrl+Shift+F".to_string())?;
    let mut parts = Vec::with_capacity(5);
    if ctrl {
        parts.push("ctrl".to_string());
    }
    if shift {
        parts.push("shift".to_string());
    }
    if alt {
        parts.push("alt".to_string());
    }
    if meta {
        parts.push("super".to_string());
    }
    parts.push(key);
    Ok(parts.join("+"))
}

fn normalize_shortcut_main_key(token: &str) -> Option<String> {
    if token.len() == 1 {
        let c = token.chars().next()?;
        if c.is_ascii_alphanumeric() {
            return Some(c.to_ascii_lowercase().to_string());
        }
        return match c {
            '/' | '?' => Some("slash".into()),
            '\\' | '|' => Some("backslash".into()),
            ';' | ':' => Some("semicolon".into()),
            '\'' | '"' => Some("quote".into()),
            ',' | '<' => Some("comma".into()),
            '.' | '>' => Some("period".into()),
            '[' | '{' => Some("bracketleft".into()),
            ']' | '}' => Some("bracketright".into()),
            '-' | '_' => Some("minus".into()),
            '=' | '+' => Some("equal".into()),
            '`' | '~' => Some("backquote".into()),
            _ => None,
        };
    }

    // Handle global_hotkey Code Display format: "keya"→"a", "keyf"→"f"
    if token.starts_with("key") && token.len() == 4 {
        let c = token.chars().nth(3)?;
        if c.is_ascii_alphabetic() {
            return Some(c.to_ascii_lowercase().to_string());
        }
    }

    // Handle global_hotkey Code Display format: "digit0"→"0", "digit1"→"1"
    if token.starts_with("digit") && token.len() == 6 {
        let c = token.chars().nth(5)?;
        if c.is_ascii_digit() {
            return Some(c.to_string());
        }
    }

    if token.starts_with('f') && token[1..].chars().all(|ch| ch.is_ascii_digit()) {
        return Some(token.to_string());
    }

    match token {
        "space" => Some("space".into()),
        "enter" | "return" => Some("enter".into()),
        "tab" => Some("tab".into()),
        "esc" | "escape" => Some("escape".into()),
        "backspace" => Some("backspace".into()),
        "delete" | "del" => Some("delete".into()),
        "insert" | "ins" => Some("insert".into()),
        "home" => Some("home".into()),
        "end" => Some("end".into()),
        "pageup" | "page_up" => Some("pageup".into()),
        "pagedown" | "page_down" => Some("pagedown".into()),
        "up" | "arrowup" => Some("up".into()),
        "down" | "arrowdown" => Some("down".into()),
        "left" | "arrowleft" => Some("left".into()),
        "right" | "arrowright" => Some("right".into()),
        "slash" | "question" => Some("slash".into()),
        "backslash" | "pipe" => Some("backslash".into()),
        "semicolon" | "colon" => Some("semicolon".into()),
        "quote" | "apostrophe" => Some("quote".into()),
        "comma" | "lessthan" => Some("comma".into()),
        "period" | "dot" | "greaterthan" => Some("period".into()),
        "bracketleft" | "leftbracket" | "braceleft" => Some("bracketleft".into()),
        "bracketright" | "rightbracket" | "braceright" => Some("bracketright".into()),
        "minus" | "underscore" | "dash" | "hyphen" => Some("minus".into()),
        "equal" | "equals" | "plus" => Some("equal".into()),
        "backquote" | "grave" => Some("backquote".into()),
        _ => None,
    }
}

fn open_panel_from_global_shortcut(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>().inner().clone();
        let always_on_top = state.runtime.lock().await.config.personal.always_on_top;
        if let Ok(panel) = ensure_panel_window(&app, always_on_top) {
            let visible = panel.is_visible().unwrap_or(false);
            if visible {
                let _ = panel.hide();
            } else {
                let _ = activate_panel_window(&app, always_on_top);
            }
        }
    });
}

async fn show_pet_window_from_tray(
    app: tauri::AppHandle,
    state: AppState,
) -> Result<(), String> {
    {
        let mut runtime = state.runtime.lock().await;
        runtime.pet_hidden_this_session = false;
    }

    if let Some(menu) = app.get_webview_window(PET_MENU_WINDOW_LABEL) {
        let _ = menu.hide();
    }
    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        main_window.show().map_err(|e| e.to_string())?;
        let _ = main_window.unminimize();
        let _ = main_window.set_ignore_cursor_events(false);
        state
            .pet_cursor_ignored
            .store(false, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

fn create_system_tray(app: &tauri::AppHandle) -> Result<(), String> {
    let open_panel = MenuItemBuilder::with_id(TRAY_MENU_OPEN_PANEL_ID, "打开主面板")
        .build(app)
        .map_err(|e| e.to_string())?;
    let show_pet = MenuItemBuilder::with_id(TRAY_MENU_SHOW_PET_ID, "显示宠物")
        .build(app)
        .map_err(|e| e.to_string())?;
    let exit_app = MenuItemBuilder::with_id(TRAY_MENU_EXIT_ID, "退出")
        .build(app)
        .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&open_panel, &show_pet, &exit_app])
        .map_err(|e| e.to_string())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "failed to load tray icon".to_string())?;

    let _ = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .icon(icon)
        .tooltip("DB Scout")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match resolve_tray_menu_action(event.id()) {
            Some(TrayMenuAction::OpenPanel) => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>().inner().clone();
                    let always_on_top = state.runtime.lock().await.config.personal.always_on_top;
                    let _ = activate_panel_window(&app_handle, always_on_top);
                });
            }
            Some(TrayMenuAction::ShowPet) => {
                let app_handle = app.clone();
                let state = app.state::<AppState>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = show_pet_window_from_tray(app_handle, state).await;
                });
            }
            Some(TrayMenuAction::ExitApp) => app.exit(0),
            None => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if tray_click_opens_panel(button, button_state) {
                    let app_handle = tray.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app_handle.state::<AppState>().inner().clone();
                        let always_on_top = state.runtime.lock().await.config.personal.always_on_top;
                        let _ = activate_panel_window(&app_handle, always_on_top);
                    });
                }
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn toggle_sync_workspace_from_global_shortcut(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Ok(window) = ensure_sync_workspace_window(&app) {
            let visible = window.is_visible().unwrap_or(false);
            if visible {
                let _ = window.hide();
            } else {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
    });
}

fn toggle_db_migration_from_global_shortcut(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Ok(window) = ensure_db_migration_workspace_window(&app) {
            let running = app
                .state::<AppState>()
                .db_migration_running_sync
                .load(Ordering::SeqCst);
            let visible = window.is_visible().unwrap_or(false);

            if visible {
                if running {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                } else {
                    let _ = window.hide();
                }
                return;
            }

            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    });
}

fn summarize_sync_error(error: &str) -> String {
    error
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
        .unwrap_or_else(|| "同步失败".to_string())
}

fn input_today_date_globally() -> Result<(), String> {
    let text = Local::now().format("%Y%m%d").to_string();
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("failed to init input driver: {e}"))?;
    enigo
        .text(text.as_str())
        .map_err(|e| format!("failed to input date: {e}"))
}

async fn search_table_data_in_db(
    pool: &MySqlPool,
    table: &TableMeta,
    keyword: &str,
    max_rows: u32,
    terms: &[String],
) -> Result<Option<DataSearchResult>, String> {
    if table.columns.is_empty() {
        return Ok(None);
    }
    let pattern = format!("%{}%", keyword);
    let select_cols = table
        .columns
        .iter()
        .map(|c| {
            format!(
                "CAST(`{}` AS CHAR) AS `{}`",
                escape_ident(&c.column_name),
                escape_ident(&c.column_name)
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    let where_clause = table
        .columns
        .iter()
        .map(|c| format!("CAST(`{}` AS CHAR) LIKE ?", escape_ident(&c.column_name)))
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!(
        "SELECT {} FROM `{}` WHERE {} LIMIT {}",
        select_cols,
        escape_ident(&table.table_name),
        where_clause,
        max_rows
    );
    let mut q = sqlx::query(&sql);
    for _ in &table.columns {
        q = q.bind(&pattern);
    }
    let rows = q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询失败: {e}"))?;
    let mapped = map_rows_to_string_map(rows, &table.columns);
    if mapped.is_empty() {
        return Ok(None);
    }
    let mut cols = vec![];
    for c in &table.columns {
        if mapped.iter().any(|r| {
            r.get(&c.column_name)
                .map(|v| contains_all_terms(v, terms))
                .unwrap_or(false)
        }) {
            cols.push(c.column_name.clone());
        }
    }
    Ok(Some(DataSearchResult {
        table_name: table.table_name.clone(),
        matched_rows: mapped.clone(),
        matched_columns: cols,
        total_matches: mapped.len() as u64,
        truncated: false,
        first_row_index: None,
    }))
}
fn search_table_data_in_mock(
    table: &TableMeta,
    terms: &[String],
    max_rows: u32,
) -> Option<DataSearchResult> {
    let source = mock_rows_for_table(&table.table_name);
    let mut rows = vec![];
    let mut cols: Vec<String> = vec![];
    let mut first = None;
    for (idx, row) in source.iter().enumerate() {
        let mut hit = false;
        for (k, v) in row {
            if contains_all_terms(v, terms) {
                hit = true;
                if !cols.contains(k) {
                    cols.push(k.clone());
                }
            }
        }
        if hit {
            if first.is_none() {
                first = Some(idx as u64);
            }
            rows.push(row.clone());
            if rows.len() >= max_rows as usize {
                break;
            }
        }
    }
    if rows.is_empty() {
        return None;
    }
    Some(DataSearchResult {
        table_name: table.table_name.clone(),
        matched_rows: rows.clone(),
        matched_columns: cols,
        total_matches: rows.len() as u64,
        truncated: false,
        first_row_index: first,
    })
}
fn meta_search(schema: &SchemaCache, terms: &[String]) -> Vec<MetaSearchResult> {
    let mut out = vec![];
    for t in &schema.tables {
        push_meta(
            &mut out,
            MatchType::TableName,
            &t.table_name,
            &t.table_name,
            None,
            terms,
        );
        push_meta(
            &mut out,
            MatchType::TableComment,
            &t.table_name,
            &t.table_comment,
            None,
            terms,
        );
        for c in &t.columns {
            push_meta(
                &mut out,
                MatchType::ColumnName,
                &t.table_name,
                &c.column_name,
                Some(c.column_name.clone()),
                terms,
            );
            push_meta(
                &mut out,
                MatchType::ColumnComment,
                &t.table_name,
                &c.column_comment,
                Some(c.column_name.clone()),
                terms,
            );
        }
    }
    out.sort_by(|a, b| b.score.cmp(&a.score));
    out
}
fn push_meta(
    out: &mut Vec<MetaSearchResult>,
    mt: MatchType,
    table: &str,
    text: &str,
    col: Option<String>,
    terms: &[String],
) {
    if text.is_empty() {
        return;
    }
    if let Some((score, range)) = match_score(text, terms) {
        out.push(MetaSearchResult {
            match_type: mt,
            table_name: table.to_string(),
            column_name: col,
            matched_text: text.to_string(),
            highlight_range: range,
            score,
        });
    }
}
fn match_score(text: &str, terms: &[String]) -> Option<(i32, (usize, usize))> {
    let lower = text.to_lowercase();
    let mut score = 0;
    let mut range = (0, 0);
    for (i, t) in terms.iter().enumerate() {
        if lower == *t {
            score += 300;
            if i == 0 {
                range = (0, t.len());
            }
        } else if lower.starts_with(t) {
            score += 200;
            if i == 0 {
                range = (0, t.len());
            }
        } else if let Some(p) = lower.find(t) {
            score += 100;
            if i == 0 {
                range = (p, p + t.len());
            }
        } else {
            return None;
        }
    }
    Some((score, range))
}
fn split_terms(keyword: &str) -> Vec<String> {
    keyword
        .split_whitespace()
        .map(|v| v.to_lowercase())
        .filter(|v| !v.is_empty())
        .collect()
}
fn contains_all_terms(value: &str, terms: &[String]) -> bool {
    let l = value.to_lowercase();
    terms.iter().all(|t| l.contains(t))
}
fn compile_patterns(items: &[String]) -> Vec<Regex> {
    items.iter().filter_map(|i| Regex::new(i).ok()).collect()
}
fn map_rows_to_string_map(
    rows: Vec<sqlx::mysql::MySqlRow>,
    cols: &[ColumnMeta],
) -> Vec<HashMap<String, String>> {
    rows.into_iter()
        .map(|row| {
            let mut m = HashMap::new();
            for c in cols {
                let v: Option<String> = row.try_get(c.column_name.as_str()).unwrap_or(None);
                m.insert(c.column_name.clone(), v.unwrap_or_default());
            }
            m
        })
        .collect()
}
async fn load_schema_from_database(
    pool: &MySqlPool,
    database: &str,
) -> Result<SchemaCache, String> {
    let tables = sqlx::query("SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME").bind(database).fetch_all(pool).await.map_err(|e| format!("读取表失败: {e}"))?;
    let columns = sqlx::query("SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT, COLUMN_KEY, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION").bind(database).fetch_all(pool).await.map_err(|e| format!("读取字段失败: {e}"))?;
    let mut map: HashMap<String, TableMeta> = HashMap::new();
    for r in tables {
        let name: String = r.try_get("TABLE_NAME").unwrap_or_default();
        let comment: Option<String> = r.try_get("TABLE_COMMENT").unwrap_or(None);
        map.insert(
            name.clone(),
            TableMeta {
                table_name: name,
                table_comment: comment.unwrap_or_default(),
                columns: vec![],
            },
        );
    }
    for r in columns {
        let table: String = r.try_get("TABLE_NAME").unwrap_or_default();
        let c = ColumnMeta {
            column_name: r.try_get("COLUMN_NAME").unwrap_or_default(),
            column_type: r
                .try_get::<Option<String>, _>("COLUMN_TYPE")
                .unwrap_or(None)
                .unwrap_or_default(),
            column_comment: r
                .try_get::<Option<String>, _>("COLUMN_COMMENT")
                .unwrap_or(None)
                .unwrap_or_default(),
            is_primary_key: r
                .try_get::<Option<String>, _>("COLUMN_KEY")
                .unwrap_or(None)
                .unwrap_or_default()
                .eq_ignore_ascii_case("PRI"),
            is_nullable: r
                .try_get::<Option<String>, _>("IS_NULLABLE")
                .unwrap_or(None)
                .unwrap_or_else(|| "YES".into())
                .eq_ignore_ascii_case("YES"),
        };
        if let Some(t) = map.get_mut(&table) {
            t.columns.push(c);
        }
    }
    let mut list: Vec<TableMeta> = map.into_values().collect();
    list.sort_by(|a, b| a.table_name.cmp(&b.table_name));
    Ok(SchemaCache {
        tables: list,
        last_refresh: Some(Utc::now()),
    })
}
fn mock_schema_cache() -> SchemaCache {
    SchemaCache {
        last_refresh: Some(Utc::now()),
        tables: vec![
            TableMeta {
                table_name: "t_hero_config".into(),
                table_comment: "英雄配置表".into(),
                columns: vec![
                    ColumnMeta {
                        column_name: "id".into(),
                        column_type: "int(11)".into(),
                        column_comment: "主键ID".into(),
                        is_primary_key: true,
                        is_nullable: false,
                    },
                    ColumnMeta {
                        column_name: "name".into(),
                        column_type: "varchar(64)".into(),
                        column_comment: "英雄名称".into(),
                        is_primary_key: false,
                        is_nullable: false,
                    },
                    ColumnMeta {
                        column_name: "atk".into(),
                        column_type: "int(11)".into(),
                        column_comment: "基础攻击力".into(),
                        is_primary_key: false,
                        is_nullable: false,
                    },
                ],
            },
            TableMeta {
                table_name: "t_hero_skill".into(),
                table_comment: "英雄技能表".into(),
                columns: vec![
                    ColumnMeta {
                        column_name: "id".into(),
                        column_type: "int(11)".into(),
                        column_comment: "主键ID".into(),
                        is_primary_key: true,
                        is_nullable: false,
                    },
                    ColumnMeta {
                        column_name: "hero_id".into(),
                        column_type: "int(11)".into(),
                        column_comment: "关联英雄ID".into(),
                        is_primary_key: false,
                        is_nullable: false,
                    },
                    ColumnMeta {
                        column_name: "skill_name".into(),
                        column_type: "varchar(64)".into(),
                        column_comment: "技能名".into(),
                        is_primary_key: false,
                        is_nullable: false,
                    },
                ],
            },
        ],
    }
}
fn mock_rows_for_table(table: &str) -> Vec<HashMap<String, String>> {
    match table {
        "t_hero_config" => vec![
            map_row(&[("id", "1"), ("name", "火焰英雄"), ("atk", "350")]),
            map_row(&[("id", "2"), ("name", "冰霜法师"), ("atk", "280")]),
            map_row(&[("id", "3"), ("name", "雷鸣骑士"), ("atk", "410")]),
        ],
        "t_hero_skill" => vec![
            map_row(&[("id", "1001"), ("hero_id", "1"), ("skill_name", "炎爆冲锋")]),
            map_row(&[("id", "1002"), ("hero_id", "2"), ("skill_name", "极寒结界")]),
        ],
        _ => vec![],
    }
}
fn map_row(input: &[(&str, &str)]) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for (k, v) in input {
        m.insert((*k).into(), (*v).into());
    }
    m
}
fn escape_ident(s: &str) -> String {
    s.replace('`', "``")
}
fn config_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("配置目录失败: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    Ok(dir.join("config.json"))
}
fn save_config_to_disk(app: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
    fs::write(
        config_file_path(app)?,
        serde_json::to_string_pretty(config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("保存配置失败: {e}"))
}
fn load_config_from_disk(app: &tauri::AppHandle) -> Result<AppConfig, String> {
    let p = config_file_path(app)?;
    if !p.exists() {
        return Ok(AppConfig::default());
    }
    serde_json::from_str(&fs::read_to_string(p).map_err(|e| format!("读取配置失败: {e}"))?)
        .map_err(|e| format!("解析配置失败: {e}"))
}
fn custom_skins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("配置目录失败: {e}"))?
        .join("custom_skins");
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    Ok(dir)
}

#[tauri::command]
async fn detect_sprite_dimensions(file_path: String) -> Result<HashMap<String, u32>, String> {
    let (w, h) = image::image_dimensions(&file_path)
        .map_err(|e| format!("读取图片尺寸失败: {e}"))?;
    let mut map = HashMap::new();
    map.insert("width".into(), w);
    map.insert("height".into(), h);
    Ok(map)
}

#[tauri::command]
async fn import_skin_sprites(
    skin_name: String,
    files: Vec<String>,
    app: tauri::AppHandle,
) -> Result<Vec<HashMap<String, serde_json::Value>>, String> {
    let dir = custom_skins_dir(&app)?.join(&skin_name);
    fs::create_dir_all(&dir).map_err(|e| format!("创建皮肤目录失败: {e}"))?;
    let mut result = Vec::new();
    for src_path in &files {
        let src = std::path::Path::new(src_path);
        let file_name = src
            .file_name()
            .ok_or("无效文件名")?
            .to_string_lossy()
            .to_string();
        let dest = dir.join(&file_name);
        fs::copy(src, &dest).map_err(|e| format!("复制文件失败: {e}"))?;
        let (w, h) = image::image_dimensions(&dest)
            .map_err(|e| format!("读取图片尺寸失败: {e}"))?;
        let mut entry = HashMap::new();
        entry.insert("name".into(), serde_json::Value::String(
            file_name.trim_end_matches(".png").trim_end_matches(".PNG").to_string(),
        ));
        entry.insert("file".into(), serde_json::Value::String(file_name));
        entry.insert("width".into(), serde_json::Value::Number(w.into()));
        entry.insert("height".into(), serde_json::Value::Number(h.into()));
        result.push(entry);
    }
    Ok(result)
}

#[tauri::command]
async fn save_skin_manifest(
    skin_name: String,
    manifest: SkinManifest,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let dir = custom_skins_dir(&app)?.join(&skin_name);
    fs::create_dir_all(&dir).map_err(|e| format!("创建皮肤目录失败: {e}"))?;
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    fs::write(dir.join("manifest.json"), json).map_err(|e| format!("保存清单失败: {e}"))
}

#[tauri::command]
async fn list_custom_skins(
    app: tauri::AppHandle,
) -> Result<Vec<HashMap<String, serde_json::Value>>, String> {
    let dir = custom_skins_dir(&app)?;
    let mut skins = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }
        let content =
            fs::read_to_string(&manifest_path).map_err(|e| format!("读取清单失败: {e}"))?;
        let manifest: SkinManifest =
            serde_json::from_str(&content).map_err(|e| format!("解析清单失败: {e}"))?;
        let id = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let mut entry_map = HashMap::new();
        entry_map.insert("id".into(), serde_json::Value::String(id));
        entry_map.insert(
            "manifest".into(),
            serde_json::to_value(&manifest).map_err(|e| e.to_string())?,
        );
        skins.push(entry_map);
    }
    Ok(skins)
}

#[tauri::command]
async fn delete_custom_skin(
    skin_name: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let dir = custom_skins_dir(&app)?.join(&skin_name);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("删除皮肤失败: {e}"))?;
    }
    let mut rt = state.runtime.lock().await;
    let current_skin = &rt.config.personal.pet_skin;
    if current_skin == &format!("custom:{}", skin_name) {
        rt.config.personal.pet_skin = "eagle".into();
        save_config_to_disk(&app, &rt.config)?;
    }
    Ok(())
}

#[tauri::command]
async fn get_skin_base_path(
    skin_name: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let dir = custom_skins_dir(&app)?.join(&skin_name);
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn set_autostart(enable: bool, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    if enable {
        app.autolaunch().enable().map_err(|e| e.to_string())
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WeatherInfo {
    code: i32,
    text: String,
    temp: i32,
    wind_speed: i32,
    humidity: i32,
    category: String,
    rain_intensity: f32,
    city: String,
}

fn classify_weather_code(code: i32) -> (&'static str, f32) {
    match code {
        100 | 150 => ("sunny", 0.0),
        101..=104 | 151..=153 => ("cloudy", 0.0),
        300 => ("rain", 0.3),
        301 => ("rain", 0.5),
        302..=304 => ("rain", 0.8),
        305..=309 => ("rain", 0.5),
        310..=313 => ("rain", 0.7),
        314..=318 => ("rain", 0.9),
        399 => ("rain", 0.6),
        400..=499 => ("snow", 0.0),
        _ => ("cloudy", 0.0),
    }
}

#[tauri::command]
async fn get_weather() -> Result<WeatherInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    const QW_API_KEY: &str = "11931e18542b476b8bfbc17778db5449";
    const QW_API_HOST: &str = "https://nu4nmu2ctr.re.qweatherapi.com";

    // Hardcoded Xiamen coordinates (removes ip-api.com dependency)
    let location = "118.08,24.48".to_string(); // 厦门市
    let city = "厦门".to_string();

    // Step 2: Get current weather from QWeather
    let weather_url = format!("{}/v7/weather/now?location={}", QW_API_HOST, location);
    let weather_resp: serde_json::Value = client
        .get(&weather_url)
        .header("X-QW-Api-Key", QW_API_KEY)
        .send()
        .await
        .map_err(|e| format!("天气数据请求失败: {}", e))?
        .json()
        .await
        .map_err(|e| format!("天气数据解析失败: {}", e))?;

    let resp_code = weather_resp["code"].as_str().unwrap_or("");
    if resp_code != "200" {
        return Err(format!("和风天气API返回错误码: {}", resp_code));
    }

    let now = &weather_resp["now"];
    let code = now["icon"]
        .as_str()
        .unwrap_or("999")
        .parse::<i32>()
        .unwrap_or(999);
    let text = now["text"].as_str().unwrap_or("未知").to_string();
    let temp = now["temp"]
        .as_str()
        .unwrap_or("0")
        .parse::<i32>()
        .unwrap_or(0);
    let wind_speed = now["windSpeed"]
        .as_str()
        .unwrap_or("0")
        .parse::<i32>()
        .unwrap_or(0);
    let humidity = now["humidity"]
        .as_str()
        .unwrap_or("0")
        .parse::<i32>()
        .unwrap_or(0);

    let (category, rain_intensity) = classify_weather_code(code);

    Ok(WeatherInfo {
        code,
        text,
        temp,
        wind_speed,
        humidity,
        category: category.to_string(),
        rain_intensity,
        city,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<AppState>().inner().clone();
                let always_on_top = state.runtime.lock().await.config.personal.always_on_top;
                if let Err(e) = activate_panel_window(&app_handle, always_on_top) {
                    eprintln!("failed to activate existing panel window: {e}");
                }
            });
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let raw = shortcut.to_string();
                    let triggered = match normalize_hotkey_for_plugin(raw.as_str()) {
                        Ok(value) => value,
                        Err(e) => {
                            eprintln!("hotkey normalize failed: raw={raw:?} err={e}");
                            return;
                        }
                    };
                    let state = app.state::<AppState>().inner().clone();
                    let panel_hotkey = state.panel_hotkey_sync.read().unwrap().clone();
                    let quick_date_hotkey = state.quick_date_hotkey_sync.read().unwrap().clone();
                    let sync_window_hotkey = state.sync_window_hotkey_sync.read().unwrap().clone();
                    let db_migration_window_hotkey =
                        state.db_migration_window_hotkey_sync.read().unwrap().clone();

                    if db_migration_window_hotkey.as_deref() == Some(triggered.as_str()) {
                        toggle_db_migration_from_global_shortcut(app.clone());
                        return;
                    }

                    if quick_date_hotkey.as_deref() == Some(triggered.as_str()) {
                        if let Err(e) = input_today_date_globally() {
                            eprintln!("failed to input quick date: {e}");
                        }
                        return;
                    }

                    if sync_window_hotkey.as_deref() == Some(triggered.as_str()) {
                        toggle_sync_workspace_from_global_shortcut(app.clone());
                        return;
                    }

                    if panel_hotkey.as_deref() == Some(triggered.as_str()) {
                        open_panel_from_global_shortcut(app.clone());
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .setup(|app| {
            let st = app.state::<AppState>().clone();
            let _ = app.global_shortcut().unregister_all();
            let mut loaded = load_config_from_disk(&app.handle()).unwrap_or_default();
            if loaded.personal.quick_date_hotkey.trim().is_empty() {
                loaded.personal.quick_date_hotkey = "F9".into();
            }
            if loaded.personal.sync_window_hotkey.trim().is_empty() {
                loaded.personal.sync_window_hotkey = default_sync_window_hotkey();
            }
            if loaded.personal.db_migration_window_hotkey.trim().is_empty() {
                loaded.personal.db_migration_window_hotkey =
                    default_db_migration_window_hotkey();
            }
            loaded.personal.db_migration_window_size =
                sanitize_db_migration_window_size(loaded.personal.db_migration_window_size.take());
            loaded.personal.db_migration_last_connection = sanitize_db_migration_remembered_connection(
                loaded.personal.db_migration_last_connection.take(),
            );
            let pet_position = loaded.personal.pet_position.clone();
            let registered_hotkey = match normalize_hotkey_for_plugin(&loaded.personal.hotkey) {
                Ok(shortcut) => {
                    match app.global_shortcut().register(shortcut.as_str()) {
                        Ok(()) => Some(shortcut),
                        Err(e) => {
                            eprintln!("failed to register startup hotkey: {e}");
                            None
                        }
                    }
                }
                Err(e) => {
                    eprintln!("invalid startup hotkey config: {e}");
                    None
                }
            };
            let registered_quick_date_hotkey =
                match normalize_hotkey_for_plugin(&loaded.personal.quick_date_hotkey) {
                    Ok(shortcut) => {
                        if registered_hotkey.as_deref() == Some(shortcut.as_str()) {
                            eprintln!("quick date hotkey is same as main hotkey, skipped");
                            None
                        } else {
                            match app.global_shortcut().register(shortcut.as_str()) {
                                Ok(()) => Some(shortcut),
                                Err(e) => {
                                    eprintln!("failed to register quick date hotkey: {e}");
                                    None
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("invalid quick date hotkey config: {e}");
                        None
                    }
                };
            let registered_sync_window_hotkey =
                match normalize_hotkey_for_plugin(&loaded.personal.sync_window_hotkey) {
                    Ok(shortcut) => {
                        if registered_hotkey.as_deref() == Some(shortcut.as_str())
                            || registered_quick_date_hotkey.as_deref() == Some(shortcut.as_str())
                        {
                            eprintln!("sync workspace hotkey conflicts with existing hotkeys, skipped");
                            None
                        } else {
                            match app.global_shortcut().register(shortcut.as_str()) {
                                Ok(()) => Some(shortcut),
                                Err(e) => {
                                    eprintln!("failed to register sync workspace hotkey: {e}");
                                    None
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("invalid sync workspace hotkey config: {e}");
                        None
                    }
                };
            let registered_db_migration_window_hotkey =
                match normalize_hotkey_for_plugin(&loaded.personal.db_migration_window_hotkey) {
                    Ok(shortcut) => {
                        if registered_hotkey.as_deref() == Some(shortcut.as_str())
                            || registered_quick_date_hotkey.as_deref() == Some(shortcut.as_str())
                            || registered_sync_window_hotkey.as_deref() == Some(shortcut.as_str())
                        {
                            eprintln!(
                                "db migration workspace hotkey conflicts with existing hotkeys, skipped"
                            );
                            None
                        } else {
                            match app.global_shortcut().register(shortcut.as_str()) {
                                Ok(()) => Some(shortcut),
                                Err(e) => {
                                    eprintln!(
                                        "failed to register db migration workspace hotkey: {e}"
                                    );
                                    None
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("invalid db migration workspace hotkey config: {e}");
                        None
                    }
                };
            // Sync-write hotkey values for the global shortcut handler
            *st.panel_hotkey_sync.write().unwrap() = registered_hotkey.clone();
            *st.quick_date_hotkey_sync.write().unwrap() = registered_quick_date_hotkey.clone();
            *st.sync_window_hotkey_sync.write().unwrap() = registered_sync_window_hotkey.clone();
            *st.db_migration_window_hotkey_sync.write().unwrap() =
                registered_db_migration_window_hotkey.clone();
            *st.db_migration_window_size_sync.write().unwrap() =
                loaded.personal.db_migration_window_size.clone();
            tauri::async_runtime::block_on(async move {
                let mut rt = st.runtime.lock().await;
                rt.config = loaded;
                rt.schema_cache = mock_schema_cache();
                rt.registered_hotkey = registered_hotkey;
                rt.registered_quick_date_hotkey = registered_quick_date_hotkey;
                rt.registered_sync_window_hotkey = registered_sync_window_hotkey;
                rt.registered_db_migration_window_hotkey = registered_db_migration_window_hotkey;
            });

            if let Err(e) = create_system_tray(&app.handle()) {
                eprintln!("failed to create system tray: {e}");
            }

            if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                if let Some(pos) = pet_position {
                    let _ = main_window.set_position(Position::Logical(LogicalPosition::new(
                        pos.x as f64,
                        pos.y as f64,
                    )));
                }
                let _ = main_window.set_always_on_top(true);
                let _ = main_window.set_skip_taskbar(true);
                let _ = main_window.set_shadow(false);

                // Start mouse hitbox polling for click-through
                let poll_window = main_window.clone();
                let poll_state = app.state::<AppState>().inner().clone();
                std::thread::spawn(move || {
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(50));

                        let hitbox = poll_state.pet_hitbox.read().unwrap().clone();
                        let hitbox = match hitbox {
                            Some(h) => h,
                            None => continue,
                        };

                        let mouse_pos = match Mouse::get_mouse_position() {
                            Mouse::Position { x, y } => (x as f64, y as f64),
                            Mouse::Error => continue,
                        };

                        let win_pos = match poll_window.outer_position() {
                            Ok(p) => (p.x as f64, p.y as f64),
                            Err(_) => continue,
                        };

                        let scale = poll_window.scale_factor().unwrap_or(1.0);
                        let sprite_left = win_pos.0 + hitbox.offset_x * scale;
                        let sprite_top = win_pos.1 + hitbox.offset_y * scale;
                        let sprite_right = sprite_left + hitbox.width * scale;
                        let sprite_bottom = sprite_top + hitbox.height * scale;

                        let pad = 6.0 * scale;
                        let inside = mouse_pos.0 >= sprite_left - pad
                            && mouse_pos.0 <= sprite_right + pad
                            && mouse_pos.1 >= sprite_top - pad
                            && mouse_pos.1 <= sprite_bottom + pad;

                        let currently_ignored = poll_state
                            .pet_cursor_ignored
                            .load(std::sync::atomic::Ordering::Relaxed);

                        if !inside && !currently_ignored {
                            if poll_window.set_ignore_cursor_events(true).is_ok() {
                                poll_state
                                    .pet_cursor_ignored
                                    .store(true, std::sync::atomic::Ordering::Relaxed);
                            }
                        } else if inside && currently_ignored {
                            if poll_window.set_ignore_cursor_events(false).is_ok() {
                                poll_state
                                    .pet_cursor_ignored
                                    .store(false, std::sync::atomic::Ordering::Relaxed);
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect_db,
            disconnect_db,
            get_connection_status,
            refresh_schema,
            search,
            cancel_search,
            get_table_data,
            list_tables,
            get_config,
            save_config,
            get_update_settings,
            prepare_startup_update_check,
            check_for_updates_now,
            register_hotkey,
            register_quick_date_hotkey,
            register_sync_window_hotkey,
            register_db_migration_window_hotkey,
            show_sync_workspace_window,
            hide_sync_workspace_window,
            toggle_sync_workspace_window,
            show_db_migration_window,
            hide_db_migration_window,
            toggle_db_migration_window,
            get_db_migration_workspace_state,
            save_db_migration_workspace_connection,
            connect_db_migration_server,
            run_db_migration,
            open_directory_in_explorer,
            run_sync_profile,
            show_panel_window,
            hide_panel_window,
            toggle_panel_window,
            consume_panel_open_settings,
            set_panel_always_on_top,
            show_pet_menu,
            hide_pet_menu,
            hide_pet_window,
            toggle_pet_lock,
            save_pet_position,
            quit_app,
            set_autostart,
            save_table_changes,
            export_tables_xlsx,
            export_tables_xlsx_batch,
            list_system_fonts,
            resize_pet_window,
            update_pet_hitbox,
            detect_sprite_dimensions,
            import_skin_sprites,
            save_skin_manifest,
            list_custom_skins,
            delete_custom_skin,
            get_skin_base_path,
            get_weather
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pet_menu_height_fits_all_actions() {
        let min_height = PET_MENU_VERTICAL_PADDING
            + PET_MENU_BUTTON_COUNT * PET_MENU_BUTTON_HEIGHT
            + PET_MENU_DIVIDER_BLOCK_HEIGHT
            + (PET_MENU_CHILD_COUNT - 1.0) * PET_MENU_ROW_GAP;

        assert!(
            PET_MENU_HEIGHT >= min_height,
            "pet menu height {PET_MENU_HEIGHT} is smaller than required minimum {min_height}"
        );
    }

    #[test]
    fn tray_left_click_opens_the_panel() {
        assert!(tray_click_opens_panel(MouseButton::Left, MouseButtonState::Up));
        assert!(!tray_click_opens_panel(MouseButton::Right, MouseButtonState::Up));
        assert!(!tray_click_opens_panel(MouseButton::Left, MouseButtonState::Down));
    }

    #[test]
    fn tray_menu_action_maps_all_supported_commands() {
        assert_eq!(
            resolve_tray_menu_action(TRAY_MENU_OPEN_PANEL_ID),
            Some(TrayMenuAction::OpenPanel)
        );
        assert_eq!(
            resolve_tray_menu_action(TRAY_MENU_SHOW_PET_ID),
            Some(TrayMenuAction::ShowPet)
        );
        assert_eq!(
            resolve_tray_menu_action(TRAY_MENU_EXIT_ID),
            Some(TrayMenuAction::ExitApp)
        );
        assert_eq!(resolve_tray_menu_action("unknown"), None);
    }

    #[test]
    fn primary_windows_close_to_tray_instead_of_exiting() {
        assert_eq!(
            close_request_action_for_window(PANEL_WINDOW_LABEL),
            WindowCloseAction::HideToTray
        );
        assert_eq!(
            close_request_action_for_window(SYNC_WORKSPACE_WINDOW_LABEL),
            WindowCloseAction::HideToTray
        );
        assert_eq!(
            close_request_action_for_window(DB_MIGRATION_WORKSPACE_WINDOW_LABEL),
            WindowCloseAction::HideToTray
        );
        assert_eq!(
            close_request_action_for_window(PET_MENU_WINDOW_LABEL),
            WindowCloseAction::HideWindow
        );
    }

    #[test]
    fn update_check_plan_runs_on_first_startup() {
        let now = DateTime::parse_from_rfc3339("2026-03-20T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let plan = build_update_check_plan(true, None, now, false);

        assert!(plan.should_check);
        assert_eq!(plan.reason, "startup-due");
        assert_eq!(plan.checked_at.as_deref(), Some("2026-03-20T08:00:00+00:00"));
    }

    #[test]
    fn update_check_plan_still_runs_on_every_startup_for_testing() {
        let now = DateTime::parse_from_rfc3339("2026-03-20T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let plan = build_update_check_plan(true, Some("2026-03-20T04:00:00Z"), now, false);

        assert!(plan.should_check);
        assert_eq!(plan.reason, "startup-due");
        assert_eq!(plan.checked_at.as_deref(), Some("2026-03-20T08:00:00+00:00"));
    }

    #[test]
    fn update_check_plan_manual_mode_bypasses_auto_and_throttle() {
        let now = DateTime::parse_from_rfc3339("2026-03-20T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let plan = build_update_check_plan(false, Some("2026-03-20T07:59:00Z"), now, true);

        assert!(plan.should_check);
        assert_eq!(plan.reason, "manual");
        assert_eq!(plan.checked_at.as_deref(), Some("2026-03-20T08:00:00+00:00"));
    }

    #[test]
    fn parse_update_check_at_rejects_invalid_values() {
        assert!(parse_update_check_at(None).is_none());
        assert!(parse_update_check_at(Some("")).is_none());
        assert!(parse_update_check_at(Some("not-a-date")).is_none());
    }

    #[test]
    fn db_migration_hotkey_defaults_to_shift_d() {
        assert_eq!(default_db_migration_window_hotkey(), "Shift+D");
    }

    #[test]
    fn db_migration_window_size_is_clamped_to_minimum_dimensions() {
        let size = sanitize_db_migration_window_size(Some(DbMigrationWindowSize {
            width: 720.0,
            height: 480.0,
        }))
        .expect("size should stay available");

        assert_eq!(size.width, 980.0);
        assert_eq!(size.height, 660.0);
    }

    #[test]
    fn db_migration_window_size_can_be_resolved_from_sync_cache() {
        let state = AppState::default();
        *state.db_migration_window_size_sync.write().unwrap() = Some(DbMigrationWindowSize {
            width: 1240.0,
            height: 820.0,
        });

        let size = resolve_db_migration_window_size_from_cache(&state);

        assert_eq!(size.width, 1240.0);
        assert_eq!(size.height, 820.0);
    }
}
