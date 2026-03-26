use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::mysql::{MySqlConnectOptions, MySqlConnection};
use sqlx::{Connection, Row};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

pub const DB_MIGRATION_PROGRESS_EVENT: &str = "db-migration-progress";
pub const DB_MIGRATION_RESET_EVENT: &str = "db-migration-reset";

const DB_MIGRATION_SYSTEM_DATABASES: [&str; 4] = [
    "information_schema",
    "mysql",
    "performance_schema",
    "sys",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbMigrationLoginParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbMigrationLoginResult {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub databases: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbMigrationRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub source_database: String,
    pub target_database: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbMigrationOutcome {
    pub source_database: String,
    pub target_database: String,
    pub table_count: usize,
    pub backup_dir: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbMigrationProgressEvent {
    pub step: String,
    pub status: String,
    pub message: String,
    pub detail: Option<String>,
    pub command: Option<String>,
    pub path: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone)]
struct TableColumn {
    column_name: String,
    data_type: String,
    extra: String,
}

pub fn filter_user_databases(databases: Vec<String>) -> Vec<String> {
    let mut unique = databases
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .filter(|item| {
            !DB_MIGRATION_SYSTEM_DATABASES
                .iter()
                .any(|system| item.eq_ignore_ascii_case(system))
        })
        .collect::<Vec<_>>();

    unique.sort_by(|left, right| left.to_lowercase().cmp(&right.to_lowercase()));
    unique.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    unique
}

pub fn build_backup_folder_name(timestamp: &str, source_database: &str, target_database: &str) -> String {
    format!(
        "{}-{}-to-{}",
        sanitize_path_segment(timestamp),
        sanitize_path_segment(source_database),
        sanitize_path_segment(target_database)
    )
}

pub fn format_backup_file_name(kind: &str, database: &str) -> String {
    format!(
        "{}-{}.sql",
        sanitize_path_segment(kind),
        sanitize_path_segment(database)
    )
}

pub fn emit_db_migration_reset(app: &AppHandle) {
    let _ = app.emit(DB_MIGRATION_RESET_EVENT, ());
}

pub async fn connect_db_migration_server(
    params: DbMigrationLoginParams,
) -> Result<DbMigrationLoginResult, String> {
    let options = build_server_connect_options(
        &params.host,
        params.port,
        &params.username,
        &params.password,
    )?;
    let mut connection = MySqlConnection::connect_with(&options)
        .await
        .map_err(|e| format!("数据库连接失败: {e}"))?;
    let databases = list_user_databases(&mut connection).await?;

    Ok(DbMigrationLoginResult {
        host: params.host.trim().to_string(),
        port: params.port,
        username: params.username.trim().to_string(),
        databases,
    })
}

pub async fn run_db_migration(
    app: &AppHandle,
    request: DbMigrationRequest,
) -> Result<DbMigrationOutcome, String> {
    let host = request.host.trim().to_string();
    let username = request.username.trim().to_string();
    let source_database = request.source_database.trim().to_string();
    let target_database = request.target_database.trim().to_string();

    emit_progress(
        app,
        "validate",
        "running",
        "正在校验数据库连接和迁移范围",
        None,
        None,
        None,
    );

    if host.is_empty() || username.is_empty() || source_database.is_empty() || target_database.is_empty() {
        return emit_failure(
            app,
            "validate",
            "连接信息或数据库选择不完整",
            "请填写主机、端口、用户名，并选择源库和目标库".to_string(),
            None,
            None,
        );
    }

    if source_database.eq_ignore_ascii_case(&target_database) {
        return emit_failure(
            app,
            "validate",
            "源库和目标库不能相同",
            "请选择两个不同的数据库".to_string(),
            None,
            None,
        );
    }

    let options = build_server_connect_options(
        &host,
        request.port,
        &username,
        &request.password,
    )?;
    let mut connection = MySqlConnection::connect_with(&options)
        .await
        .map_err(|e| format!("数据库连接失败: {e}"))?;

    let visible_databases = list_user_databases(&mut connection).await?;
    if !visible_databases
        .iter()
        .any(|item| item.eq_ignore_ascii_case(&source_database))
    {
        return emit_failure(
            app,
            "validate",
            "源库不在当前账号可见范围内",
            format!("未找到源库 {source_database}"),
            None,
            None,
        );
    }
    if !visible_databases
        .iter()
        .any(|item| item.eq_ignore_ascii_case(&target_database))
    {
        return emit_failure(
            app,
            "validate",
            "目标库不在当前账号可见范围内",
            format!("未找到目标库 {target_database}"),
            None,
            None,
        );
    }

    emit_progress(
        app,
        "validate",
        "success",
        "连接校验完成，准备生成备份",
        Some(format!("源库: {source_database}\n目标库: {target_database}")),
        None,
        None,
    );

    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_dir = resolve_backup_dir(&timestamp, &source_database, &target_database)?;
    fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("创建备份目录失败 {}: {e}", backup_dir.display()))?;

    let source_backup_file = backup_dir.join(format_backup_file_name("source", &source_database));
    let target_backup_file = backup_dir.join(format_backup_file_name("target", &target_database));

    emit_progress(
        app,
        "backup_source",
        "running",
        "正在备份源库到桌面",
        None,
        None,
        Some(source_backup_file.display().to_string()),
    );
    backup_database(&mut connection, &source_database, &source_backup_file).await?;
    emit_progress(
        app,
        "backup_source",
        "success",
        "源库备份完成",
        Some(source_backup_file.display().to_string()),
        None,
        Some(source_backup_file.display().to_string()),
    );

    emit_progress(
        app,
        "backup_target",
        "running",
        "正在备份目标库到桌面",
        None,
        None,
        Some(target_backup_file.display().to_string()),
    );
    backup_database(&mut connection, &target_database, &target_backup_file).await?;
    emit_progress(
        app,
        "backup_target",
        "success",
        "目标库备份完成",
        Some(target_backup_file.display().to_string()),
        None,
        Some(target_backup_file.display().to_string()),
    );

    let source_tables = list_base_tables(&mut connection, &source_database).await?;
    let mut foreign_key_checks_disabled = false;

    let migration_result = async {
        emit_progress(
            app,
            "drop_target_tables",
            "running",
            "正在删除目标库中的普通表",
            Some(target_database.clone()),
            None,
            None,
        );
        set_foreign_key_checks(&mut connection, false).await?;
        foreign_key_checks_disabled = true;
        drop_all_tables(&mut connection, &target_database).await?;
        emit_progress(
            app,
            "drop_target_tables",
            "success",
            "目标库普通表已清空",
            Some(target_database.clone()),
            None,
            None,
        );

        emit_progress(
            app,
            "recreate_tables",
            "running",
            "正在根据源库重建目标表结构",
            Some(format!("共 {} 张表", source_tables.len())),
            None,
            None,
        );
        use_database(&mut connection, &target_database).await?;
        for table_name in &source_tables {
            let create_table_sql = show_create_table(&mut connection, &source_database, table_name).await?;
            sqlx::query(&create_table_sql)
                .execute(&mut connection)
                .await
                .map_err(|e| format!("重建表 {} 失败: {e}", table_name))?;
        }
        emit_progress(
            app,
            "recreate_tables",
            "success",
            "目标表结构重建完成",
            Some(format!("共 {} 张表", source_tables.len())),
            None,
            None,
        );

        emit_progress(
            app,
            "copy_data",
            "running",
            "正在复制源库数据到目标库",
            Some(format!("共 {} 张表", source_tables.len())),
            None,
            None,
        );
        for table_name in &source_tables {
            let columns = list_table_columns(&mut connection, &source_database, table_name).await?;
            let insertable_columns = columns
                .iter()
                .filter(|column| !is_generated_column(column))
                .map(|column| column.column_name.as_str())
                .collect::<Vec<_>>();
            if insertable_columns.is_empty() {
                continue;
            }
            let copy_sql = build_copy_table_sql(
                &source_database,
                &target_database,
                table_name,
                &insertable_columns,
            );
            sqlx::query(&copy_sql)
                .execute(&mut connection)
                .await
                .map_err(|e| format!("复制表 {} 数据失败: {e}", table_name))?;
        }
        emit_progress(
            app,
            "copy_data",
            "success",
            "源库数据复制完成",
            Some(format!("共 {} 张表", source_tables.len())),
            None,
            None,
        );

        Ok::<DbMigrationOutcome, String>(DbMigrationOutcome {
            source_database: source_database.clone(),
            target_database: target_database.clone(),
            table_count: source_tables.len(),
            backup_dir: backup_dir.display().to_string(),
            summary: format!(
                "已完成 {} -> {} 的覆盖迁移，共同步 {} 张表",
                source_database,
                target_database,
                source_tables.len()
            ),
        })
    }
    .await;

    if foreign_key_checks_disabled {
        let _ = set_foreign_key_checks(&mut connection, true).await;
    }

    match migration_result {
        Ok(outcome) => {
            emit_progress(
                app,
                "finish",
                "success",
                &outcome.summary,
                Some(outcome.backup_dir.clone()),
                None,
                Some(outcome.backup_dir.clone()),
            );
            Ok(outcome)
        }
        Err(error) => emit_failure(app, "finish", "数据库覆盖失败", error, None, None),
    }
}

fn sanitize_path_segment(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '_' | '-' | '.' => ch,
            _ => '_',
        })
        .collect::<String>();

    if sanitized.is_empty() {
        "unnamed".to_string()
    } else {
        sanitized
    }
}

fn escape_ident(value: &str) -> String {
    value.replace('`', "``")
}

fn build_server_connect_options(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
) -> Result<MySqlConnectOptions, String> {
    if host.trim().is_empty() || username.trim().is_empty() {
        return Err("主机和用户名不能为空".to_string());
    }

    Ok(MySqlConnectOptions::new()
        .host(host.trim())
        .port(port)
        .username(username.trim())
        .password(password))
}

async fn list_user_databases(connection: &mut MySqlConnection) -> Result<Vec<String>, String> {
    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(&mut *connection)
        .await
        .map_err(|e| format!("读取数据库列表失败: {e}"))?;

    Ok(filter_user_databases(
        rows.into_iter()
            .filter_map(|row| row.try_get::<String, _>(0).ok())
            .collect(),
    ))
}

async fn list_base_tables(
    connection: &mut MySqlConnection,
    database: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT TABLE_NAME \
         FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' \
         ORDER BY TABLE_NAME",
    )
    .bind(database)
    .fetch_all(&mut *connection)
    .await
    .map_err(|e| format!("读取数据库 {} 的表列表失败: {e}", database))?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("TABLE_NAME").ok())
        .collect())
}

async fn list_table_columns(
    connection: &mut MySqlConnection,
    database: &str,
    table_name: &str,
) -> Result<Vec<TableColumn>, String> {
    let rows = sqlx::query(
        "SELECT COLUMN_NAME, DATA_TYPE, EXTRA \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table_name)
    .fetch_all(&mut *connection)
    .await
    .map_err(|e| format!("读取表 {}.{} 的字段失败: {e}", database, table_name))?;

    Ok(rows
        .into_iter()
        .map(|row| TableColumn {
            column_name: row.try_get::<String, _>("COLUMN_NAME").unwrap_or_default(),
            data_type: row.try_get::<String, _>("DATA_TYPE").unwrap_or_default(),
            extra: row.try_get::<String, _>("EXTRA").unwrap_or_default(),
        })
        .collect())
}

fn is_generated_column(column: &TableColumn) -> bool {
    column.extra.to_uppercase().contains("GENERATED")
}

fn is_binary_data_type(data_type: &str) -> bool {
    matches!(
        data_type.to_lowercase().as_str(),
        "binary"
            | "varbinary"
            | "blob"
            | "tinyblob"
            | "mediumblob"
            | "longblob"
            | "bit"
            | "geometry"
            | "point"
            | "linestring"
            | "polygon"
            | "multipoint"
            | "multilinestring"
            | "multipolygon"
            | "geometrycollection"
    )
}

fn build_value_literal_expression(column: &TableColumn) -> String {
    let identifier = format!("`{}`", escape_ident(&column.column_name));
    if is_binary_data_type(&column.data_type) {
        format!(
            "IF({identifier} IS NULL, 'NULL', CONCAT('0x', HEX({identifier})))"
        )
    } else {
        format!(
            "IF({identifier} IS NULL, 'NULL', QUOTE(CAST({identifier} AS CHAR CHARACTER SET utf8mb4)))"
        )
    }
}

async fn show_create_table(
    connection: &mut MySqlConnection,
    database: &str,
    table_name: &str,
) -> Result<String, String> {
    let sql = format!(
        "SHOW CREATE TABLE `{}`.`{}`",
        escape_ident(database),
        escape_ident(table_name)
    );
    let row = sqlx::query(&sql)
        .fetch_one(&mut *connection)
        .await
        .map_err(|e| format!("读取表 {}.{} 的建表语句失败: {e}", database, table_name))?;

    row.try_get::<String, _>(1)
        .map_err(|e| format!("读取表 {}.{} 的建表内容失败: {e}", database, table_name))
}

async fn backup_database(
    connection: &mut MySqlConnection,
    database: &str,
    output_file: &Path,
) -> Result<(), String> {
    let tables = list_base_tables(connection, database).await?;
    let file = File::create(output_file)
        .map_err(|e| format!("创建备份文件失败 {}: {e}", output_file.display()))?;
    let mut writer = BufWriter::new(file);

    writeln!(writer, "-- DB Scout backup for `{}`", database).map_err(io_error)?;
    writeln!(writer, "CREATE DATABASE IF NOT EXISTS `{}`;", escape_ident(database)).map_err(io_error)?;
    writeln!(writer, "USE `{}`;", escape_ident(database)).map_err(io_error)?;
    writeln!(writer, "SET FOREIGN_KEY_CHECKS = 0;\n").map_err(io_error)?;

    for table_name in tables {
        let create_table_sql = show_create_table(connection, database, &table_name).await?;
        writeln!(writer, "-- Table `{}`", table_name).map_err(io_error)?;
        writeln!(writer, "DROP TABLE IF EXISTS `{}`;", escape_ident(&table_name)).map_err(io_error)?;
        writeln!(writer, "{};\n", create_table_sql).map_err(io_error)?;

        let columns = list_table_columns(connection, database, &table_name).await?;
        let insertable_columns = columns
            .iter()
            .filter(|column| !is_generated_column(column))
            .cloned()
            .collect::<Vec<_>>();

        if insertable_columns.is_empty() {
            continue;
        }

        let row_query = build_backup_row_query(database, &table_name, &insertable_columns);
        let rows = sqlx::query(&row_query)
            .fetch_all(&mut *connection)
            .await
            .map_err(|e| format!("读取表 {}.{} 的备份数据失败: {e}", database, table_name))?;

        if rows.is_empty() {
            continue;
        }

        let row_literals = rows
            .into_iter()
            .filter_map(|row| row.try_get::<String, _>("row_sql").ok())
            .collect::<Vec<_>>();
        let column_list = insertable_columns
            .iter()
            .map(|column| format!("`{}`", escape_ident(&column.column_name)))
            .collect::<Vec<_>>()
            .join(", ");

        for chunk in row_literals.chunks(200) {
            writeln!(
                writer,
                "INSERT INTO `{}` ({}) VALUES",
                escape_ident(&table_name),
                column_list
            )
            .map_err(io_error)?;
            writeln!(writer, "{};\n", chunk.join(",\n")).map_err(io_error)?;
        }
    }

    writeln!(writer, "SET FOREIGN_KEY_CHECKS = 1;").map_err(io_error)?;
    writer.flush().map_err(io_error)?;
    Ok(())
}

fn build_backup_row_query(database: &str, table_name: &str, columns: &[TableColumn]) -> String {
    let concat_parts = columns
        .iter()
        .map(build_value_literal_expression)
        .collect::<Vec<_>>()
        .join(", ',', ");

    format!(
        "SELECT CONCAT('(', {concat_parts}, ')') AS row_sql FROM `{database}`.`{table}`",
        database = escape_ident(database),
        table = escape_ident(table_name),
    )
}

fn build_copy_table_sql(
    source_database: &str,
    target_database: &str,
    table_name: &str,
    columns: &[&str],
) -> String {
    let quoted_columns = columns
        .iter()
        .map(|column| format!("`{}`", escape_ident(column)))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "INSERT INTO `{target_database}`.`{table_name}` ({quoted_columns}) \
         SELECT {quoted_columns} FROM `{source_database}`.`{table_name}`",
        target_database = escape_ident(target_database),
        source_database = escape_ident(source_database),
        table_name = escape_ident(table_name),
    )
}

async fn drop_all_tables(connection: &mut MySqlConnection, database: &str) -> Result<(), String> {
    let target_tables = list_base_tables(connection, database).await?;
    for table_name in target_tables {
        let sql = format!(
            "DROP TABLE IF EXISTS `{}`.`{}`",
            escape_ident(database),
            escape_ident(&table_name)
        );
        sqlx::query(&sql)
            .execute(&mut *connection)
            .await
            .map_err(|e| format!("删除目标表 {}.{} 失败: {e}", database, table_name))?;
    }
    Ok(())
}

async fn use_database(connection: &mut MySqlConnection, database: &str) -> Result<(), String> {
    let sql = format!("USE `{}`", escape_ident(database));
    sqlx::query(&sql)
        .execute(&mut *connection)
        .await
        .map_err(|e| format!("切换到目标库 {} 失败: {e}", database))
        .map(|_| ())
}

async fn set_foreign_key_checks(
    connection: &mut MySqlConnection,
    enabled: bool,
) -> Result<(), String> {
    let value = if enabled { "1" } else { "0" };
    sqlx::query(&format!("SET FOREIGN_KEY_CHECKS = {value}"))
        .execute(&mut *connection)
        .await
        .map_err(|e| format!("设置 FOREIGN_KEY_CHECKS = {value} 失败: {e}"))
        .map(|_| ())
}

fn resolve_backup_dir(
    timestamp: &str,
    source_database: &str,
    target_database: &str,
) -> Result<PathBuf, String> {
    Ok(resolve_desktop_dir()?
        .join("DB Scout Backups")
        .join(build_backup_folder_name(
            timestamp,
            source_database,
            target_database,
        )))
}

fn resolve_desktop_dir() -> Result<PathBuf, String> {
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        if !user_profile.trim().is_empty() {
            return Ok(PathBuf::from(user_profile).join("Desktop"));
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return Ok(PathBuf::from(home).join("Desktop"));
        }
    }

    Err("无法定位桌面目录".to_string())
}

fn emit_progress(
    app: &AppHandle,
    step: &str,
    status: &str,
    message: &str,
    detail: Option<String>,
    command: Option<String>,
    path: Option<String>,
) {
    let _ = app.emit(
        DB_MIGRATION_PROGRESS_EVENT,
        DbMigrationProgressEvent {
            step: step.to_string(),
            status: status.to_string(),
            message: message.to_string(),
            detail,
            command,
            path,
            timestamp: Utc::now().to_rfc3339(),
        },
    );
}

fn emit_failure<T>(
    app: &AppHandle,
    step: &str,
    message: &str,
    detail: String,
    command: Option<String>,
    path: Option<String>,
) -> Result<T, String> {
    emit_progress(
        app,
        step,
        "error",
        message,
        Some(detail.clone()),
        command.clone(),
        path.clone(),
    );
    emit_progress(app, "finish", "error", message, Some(detail.clone()), command, path);
    Err(format!("{message}: {detail}"))
}

fn io_error(error: std::io::Error) -> String {
    error.to_string()
}
