use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::{MySqlPool, Row};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::RwLock;

#[derive(serde::Deserialize)]
struct ProxyDbConfig {
    host: String,
    port: u16,
    user: String,
    password: String,
    #[serde(default)]
    database: String,
}

#[derive(serde::Deserialize)]
struct TableRequest {
    #[serde(flatten)]
    config: ProxyDbConfig,
    table: String,
}

#[derive(serde::Deserialize)]
struct RowsRequest {
    #[serde(flatten)]
    config: ProxyDbConfig,
    table: String,
    #[serde(default = "default_offset")]
    offset: u64,
    #[serde(default = "default_limit")]
    limit: u64,
}

fn default_offset() -> u64 {
    0
}
fn default_limit() -> u64 {
    100000
}

fn build_options(config: &ProxyDbConfig) -> MySqlConnectOptions {
    let mut opts = MySqlConnectOptions::new()
        .host(&config.host)
        .port(config.port)
        .username(&config.user)
        .password(&config.password)
        .ssl_mode(MySqlSslMode::Disabled);
    let db = config.database.trim();
    if !db.is_empty() {
        opts = opts.database(db);
    }
    opts
}

async fn create_pool(config: &ProxyDbConfig) -> Result<MySqlPool, String> {
    let key = pool_cache_key(config);
    if let Some(pool) = pool_cache().read().await.get(&key).cloned() {
        return Ok(pool);
    }

    let opts = build_options(config);
    let pool = MySqlPoolOptions::new()
        .min_connections(0)
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(20))
        .connect_lazy_with(opts);

    pool_cache().write().await.insert(key, pool.clone());
    Ok(pool)
}

fn pool_cache() -> &'static RwLock<HashMap<String, MySqlPool>> {
    static POOLS: OnceLock<RwLock<HashMap<String, MySqlPool>>> = OnceLock::new();
    POOLS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn pool_cache_key(config: &ProxyDbConfig) -> String {
    format!(
        "{}:{}/{}/{}",
        config.host.trim(),
        config.port,
        config.user.trim(),
        config.database.trim()
    )
}

async fn remove_cached_pool(key: &str) {
    if let Some(pool) = pool_cache().write().await.remove(key) {
        pool.close().await;
    }
}

fn json_response(status: u16, body: &str) -> String {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        _ => "Internal Server Error",
    };
    format!(
        "HTTP/1.1 {status} {status_text}\r\n\
         Content-Type: application/json; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Connection: close\r\n\r\n{body}",
        body.len()
    )
}

fn error_response(status: u16, msg: &str) -> String {
    json_response(
        status,
        &format!("{{\"error\":\"{}\"}}", msg.replace('"', "\\\"")),
    )
}

fn quote_sqlite_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn quote_mysql_identifier(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

fn build_sqlite_snapshot_schema(table_name: &str, columns: &[String]) -> Result<String, String> {
    if columns.is_empty() {
        return Err(format!("表 {table_name} 没有可快照字段"));
    }

    let table = quote_sqlite_identifier(table_name);
    let column_defs = columns
        .iter()
        .map(|column| format!("{} TEXT", quote_sqlite_identifier(column)))
        .collect::<Vec<_>>()
        .join(", ");

    Ok(format!("CREATE TABLE {table} ({column_defs})"))
}

fn build_mobile_rows_query(
    table_name: &str,
    columns: &[String],
    limit: u64,
    offset: u64,
) -> Result<String, String> {
    if columns.is_empty() {
        return Err(format!("表 {table_name} 没有可读取字段"));
    }

    let table = quote_mysql_identifier(table_name);
    let select_cols = columns
        .iter()
        .map(|column| {
            let column = quote_mysql_identifier(column);
            format!("CAST({column} AS CHAR) AS {column}")
        })
        .collect::<Vec<_>>()
        .join(", ");

    Ok(format!(
        "SELECT {select_cols} FROM {table} LIMIT {limit} OFFSET {offset}"
    ))
}

fn cors_preflight() -> String {
    "HTTP/1.1 204 No Content\r\n\
     Access-Control-Allow-Origin: *\r\n\
     Access-Control-Allow-Methods: POST, OPTIONS\r\n\
     Access-Control-Allow-Headers: Content-Type\r\n\
     Content-Length: 0\r\n\
     Connection: close\r\n\r\n"
        .to_string()
}

async fn handle_request(method: &str, path: &str, body: &[u8]) -> String {
    if method == "OPTIONS" {
        return cors_preflight();
    }
    if path == "/api/health" && (method == "GET" || method == "POST") {
        return json_response(200, "{\"ok\":true}");
    }
    if method != "POST" {
        return error_response(400, "仅支持 POST 请求");
    }

    match path {
        "/api/connect/test" => {
            let config: ProxyDbConfig = match serde_json::from_slice(body) {
                Ok(c) => c,
                Err(e) => return error_response(400, &format!("参数错误: {e}")),
            };
            let cache_key = pool_cache_key(&config);
            match create_pool(&config).await {
                Ok(pool) => match sqlx::query("SELECT 1").execute(&pool).await {
                    Ok(_) => json_response(200, "{\"ok\":true,\"message\":\"连接成功\"}"),
                    Err(e) => {
                        remove_cached_pool(&cache_key).await;
                        error_response(400, &format!("连接失败: {e}"))
                    }
                },
                Err(e) => error_response(400, &e),
            }
        }

        "/api/databases" => {
            let config: ProxyDbConfig = match serde_json::from_slice(body) {
                Ok(c) => c,
                Err(e) => return error_response(400, &format!("参数错误: {e}")),
            };
            let pool = match create_pool(&config).await {
                Ok(p) => p,
                Err(e) => return error_response(400, &e),
            };
            let result = sqlx::query("SHOW DATABASES")
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("查询失败: {e}"));
            match result {
                Ok(rows) => {
                    let databases: Vec<String> = rows
                        .iter()
                        .map(|r| r.get::<String, _>(0))
                        .filter(|d| {
                            let d = d.to_lowercase();
                            d != "information_schema"
                                && d != "performance_schema"
                                && d != "mysql"
                                && d != "sys"
                        })
                        .collect();
                    let json = serde_json::json!({"databases": databases}).to_string();
                    json_response(200, &json)
                }
                Err(e) => error_response(400, &e),
            }
        }

        "/api/tables" => {
            let config: ProxyDbConfig = match serde_json::from_slice(body) {
                Ok(c) => c,
                Err(e) => return error_response(400, &format!("参数错误: {e}")),
            };
            let pool = match create_pool(&config).await {
                Ok(p) => p,
                Err(e) => return error_response(400, &e),
            };
            let rows = sqlx::query("SHOW TABLES")
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("查询失败: {e}"));
            match rows {
                Ok(rows) => {
                    let tables: Vec<String> = rows.iter().map(|r| r.get::<String, _>(0)).collect();
                    let json = serde_json::json!({"tables": tables}).to_string();
                    json_response(200, &json)
                }
                Err(e) => error_response(400, &e),
            }
        }

        "/api/table/schema" => {
            let req: TableRequest = match serde_json::from_slice(body) {
                Ok(r) => r,
                Err(e) => return error_response(400, &format!("参数错误: {e}")),
            };
            let pool = match create_pool(&req.config).await {
                Ok(p) => p,
                Err(e) => return error_response(400, &e),
            };
            let column_query = format!("SHOW COLUMNS FROM `{}`", req.table);
            let result = sqlx::query(&column_query)
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("查询字段失败: {e}"));
            match result {
                Ok(rows) => {
                    let columns: Vec<String> = rows.iter().map(|r| r.get::<String, _>(0)).collect();
                    match build_sqlite_snapshot_schema(&req.table, &columns) {
                        Ok(sql) => {
                            let json =
                                serde_json::json!({"sql": sql, "columns": columns}).to_string();
                            json_response(200, &json)
                        }
                        Err(e) => error_response(400, &e),
                    }
                }
                Err(e) => error_response(400, &e),
            }
        }

        "/api/table/rows" => {
            let req: RowsRequest = match serde_json::from_slice(body) {
                Ok(r) => r,
                Err(e) => return error_response(400, &format!("参数错误: {e}")),
            };
            let pool = match create_pool(&req.config).await {
                Ok(p) => p,
                Err(e) => return error_response(400, &e),
            };
            let column_query = format!("SHOW COLUMNS FROM {}", quote_mysql_identifier(&req.table));
            let columns_result = sqlx::query(&column_query)
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("查询字段失败: {e}"));
            let result = match columns_result {
                Ok(column_rows) => {
                    let columns: Vec<String> =
                        column_rows.iter().map(|r| r.get::<String, _>(0)).collect();
                    let query = match build_mobile_rows_query(
                        &req.table,
                        &columns,
                        req.limit,
                        req.offset,
                    ) {
                        Ok(sql) => sql,
                        Err(e) => return error_response(400, &e),
                    };
                    sqlx::query(&query)
                        .fetch_all(&pool)
                        .await
                        .map(|rows| (columns, rows))
                        .map_err(|e| format!("查询失败: {e}"))
                }
                Err(e) => Err(e),
            };
            match result {
                Ok((columns, rows)) => {
                    let mut row_maps: Vec<HashMap<String, serde_json::Value>> = Vec::new();
                    for row in &rows {
                        let mut map = HashMap::new();
                        for (i, col) in columns.iter().enumerate() {
                            let val: Option<String> = row.try_get(i).ok();
                            map.insert(
                                col.clone(),
                                match val {
                                    Some(v) => serde_json::Value::String(v),
                                    None => serde_json::Value::Null,
                                },
                            );
                        }
                        row_maps.push(map)
                    }
                    let json = serde_json::json!({
                        "columns": columns,
                        "rows": row_maps
                    })
                    .to_string();
                    json_response(200, &json)
                }
                Err(e) => error_response(400, &e),
            }
        }

        _ => error_response(400, &format!("未知路径: {path}")),
    }
}

pub async fn start_proxy_server(port: u16) {
    let listener = match tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("移动代理服务启动失败: {e}");
            return;
        }
    };
    eprintln!("移动代理服务已启动，监听端口 {port}");

    loop {
        let (stream, _) = match listener.accept().await {
            Ok(s) => s,
            Err(_) => continue,
        };
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buf = vec![0u8; 65536];
            let mut stream = stream;
            let n = match stream.read(&mut buf).await {
                Ok(0) => return,
                Ok(n) => n,
                Err(_) => return,
            };
            let request = String::from_utf8_lossy(&buf[..n]);
            let mut lines = request.lines();
            let first_line = lines.next().unwrap_or("");
            let parts: Vec<&str> = first_line.split_whitespace().collect();
            let method = parts.first().unwrap_or(&"").to_string();
            let path = parts.get(1).unwrap_or(&"").to_string();

            let body_start = request.find("\r\n\r\n").unwrap_or(0) + 4;
            let body = &buf[body_start..n];

            let response = handle_request(&method, &path, body).await;
            let _ = stream.write_all(response.as_bytes()).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_snapshot_schema_uses_text_columns_instead_of_mysql_column_types() {
        let columns = vec!["id".to_string(), "amount".to_string(), "status".to_string()];

        let sql = build_sqlite_snapshot_schema("orders", &columns).unwrap();

        assert_eq!(
            sql,
            r#"CREATE TABLE "orders" ("id" TEXT, "amount" TEXT, "status" TEXT)"#
        );
        assert!(!sql.to_lowercase().contains("unsigned"));
    }

    #[test]
    fn sqlite_snapshot_schema_quotes_identifiers() {
        let columns = vec!["select".to_string(), "a\"b".to_string()];

        let sql = build_sqlite_snapshot_schema("odd\"table", &columns).unwrap();

        assert_eq!(
            sql,
            r#"CREATE TABLE "odd""table" ("select" TEXT, "a""b" TEXT)"#
        );
    }

    #[test]
    fn sqlite_snapshot_schema_rejects_empty_column_list() {
        let err = build_sqlite_snapshot_schema("empty_table", &[]).unwrap_err();

        assert_eq!(err, "表 empty_table 没有可快照字段");
    }

    #[test]
    fn mobile_rows_query_casts_columns_to_text() {
        let columns = vec!["id".to_string(), "created_at".to_string(), "a`b".to_string()];

        let sql = build_mobile_rows_query("orders`2026", &columns, 100, 20).unwrap();

        assert_eq!(
            sql,
            "SELECT CAST(`id` AS CHAR) AS `id`, CAST(`created_at` AS CHAR) AS `created_at`, CAST(`a``b` AS CHAR) AS `a``b` FROM `orders``2026` LIMIT 100 OFFSET 20"
        );
    }

    #[test]
    fn pool_cache_key_ignores_password_and_preserves_database() {
        let config = ProxyDbConfig {
            host: "db.local".into(),
            port: 3306,
            user: "root".into(),
            password: "secret".into(),
            database: "app".into(),
        };

        assert_eq!(pool_cache_key(&config), "db.local:3306/root/app");
    }

    #[test]
    fn pool_cache_key_trims_database_name() {
        let config = ProxyDbConfig {
            host: "db.local".into(),
            port: 3306,
            user: "root".into(),
            password: "secret".into(),
            database: " app ".into(),
        };

        assert_eq!(pool_cache_key(&config), "db.local:3306/root/app");
    }
}
