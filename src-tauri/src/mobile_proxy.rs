use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::{Column, MySqlPool, Row};
use std::collections::HashMap;

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

fn default_offset() -> u64 { 0 }
fn default_limit() -> u64 { 100000 }

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
    let opts = build_options(config);
    MySqlPoolOptions::new()
        .max_connections(2)
        .connect_with(opts)
        .await
        .map_err(|e| format!("连接失败: {e}"))
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
    json_response(status, &format!("{{\"error\":\"{}\"}}", msg.replace('"', "\\\"")))
}

fn cors_preflight() -> String {
    "HTTP/1.1 204 No Content\r\n\
     Access-Control-Allow-Origin: *\r\n\
     Access-Control-Allow-Methods: POST, OPTIONS\r\n\
     Access-Control-Allow-Headers: Content-Type\r\n\
     Content-Length: 0\r\n\
     Connection: close\r\n\r\n".to_string()
}

async fn handle_request(method: &str, path: &str, body: &[u8]) -> String {
    if method == "OPTIONS" {
        return cors_preflight();
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
            match create_pool(&config).await {
                Ok(pool) => {
                    pool.close().await;
                    json_response(200, "{\"ok\":true,\"message\":\"连接成功\"}")
                }
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
            pool.close().await;
            match result {
                Ok(rows) => {
                    let databases: Vec<String> = rows.iter()
                        .map(|r| r.get::<String, _>(0))
                        .filter(|d| {
                            let d = d.to_lowercase();
                            d != "information_schema" && d != "performance_schema"
                                && d != "mysql" && d != "sys"
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
            pool.close().await;
            match rows {
                Ok(rows) => {
                    let tables: Vec<String> = rows.iter()
                        .map(|r| r.get::<String, _>(0))
                        .collect();
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
            let result = sqlx::query(&format!("SHOW CREATE TABLE `{}`", req.table))
                .fetch_one(&pool)
                .await
                .map_err(|e| format!("查询失败: {e}"));
            pool.close().await;
            match result {
                Ok(row) => {
                    let sql: String = row.get::<String, _>(1);
                    let json = serde_json::json!({"sql": sql}).to_string();
                    json_response(200, &json)
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
            let query = format!(
                "SELECT * FROM `{}` LIMIT {} OFFSET {}",
                req.table, req.limit, req.offset
            );
            let result = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("查询失败: {e}"));
            pool.close().await;
            match result {
                Ok(rows) => {
                    let mut columns: Vec<String> = Vec::new();
                    let mut row_maps: Vec<HashMap<String, serde_json::Value>> = Vec::new();
                    for row in &rows {
                        if columns.is_empty() {
                            for col in row.columns() {
                                columns.push(col.name().to_string());
                            }
                        }
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
                    }).to_string();
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
