import initSqlJs from 'sql.js'

let db = null
let SQL = null

async function getSQL() {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: file => `./sql-wasm.wasm`
    })
  }
  return SQL
}

export async function openDatabase(arrayBuffer) {
  const SQL = await getSQL()
  if (db) db.close()
  db = arrayBuffer
    ? new SQL.Database(new Uint8Array(arrayBuffer))
    : new SQL.Database()
  return db
}

export async function exportDatabase() {
  if (!db) return null
  return db.export()
}

export function exec(sql, params = []) {
  if (!db) throw new Error('数据库未打开')
  const results = []
  // sql.js doesn't support multi-statement with params easily,
  // so we handle single statements with params
  const stmt = db.prepare(sql)
  if (params.length > 0) {
    stmt.bind(params)
  }
  const columns = stmt.getColumnNames()
  while (stmt.step()) {
    const row = stmt.getAsObject()
    results.push(row)
  }
  stmt.free()
  return { columns, rows: results }
}

export function execRaw(sql) {
  if (!db) throw new Error('数据库未打开')
  return db.exec(sql)
}

export function getTableList() {
  const result = execRaw(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  if (!result.length) return []
  const cols = result[0].columns
  return result[0].values.map(row => {
    const obj = {}
    cols.forEach((c, i) => obj[c] = row[i])
    return obj
  })
}

export function getTableData(tableName, page = 1, pageSize = 100) {
  const countResult = execRaw(`SELECT COUNT(*) as cnt FROM "${tableName}"`)
  const total = countResult[0]?.values[0]?.[0] || 0
  const offset = (page - 1) * pageSize
  const result = execRaw(`SELECT * FROM "${tableName}" LIMIT ${pageSize} OFFSET ${offset}`)
  const columns = result[0]?.columns || []
  const rows = result[0]?.values.map(row => {
    const obj = {}
    columns.forEach((c, i) => obj[c] = row[i])
    return obj
  }) || []
  return { columns, rows, total, page, pageSize }
}

export function searchTables(keyword) {
  const tables = getTableList()
  if (!keyword) return tables
  const kw = keyword.toLowerCase()
  return tables.filter(t => t.name.toLowerCase().includes(kw))
}

export function globalSearch(keyword) {
  if (!keyword || !db) return { tableMatches: [], columnMatches: [], dataMatches: [] }
  const kw = keyword.toLowerCase()
  const escapedKw = keyword.replace(/'/g, "''")
  const allTables = getTableList()
  const tableMatches = []
  const columnMatches = []
  const dataMatches = []

  for (const t of allTables) {
    const name = t.name.toLowerCase()
    // Match table name
    if (name.includes(kw)) {
      tableMatches.push({ tableName: t.name, matchType: 'TableName' })
    }

    // Get columns and check column names
    const schema = execRaw(`PRAGMA table_info("${t.name}")`)
    const cols = schema[0]?.values.map(r => ({ name: r[1], type: r[2] })) || []
    const matchedCols = cols.filter(c => c.name.toLowerCase().includes(kw))
    if (matchedCols.length > 0) {
      columnMatches.push({ tableName: t.name, matchType: 'ColumnName', columns: matchedCols.map(c => c.name) })
    }

    // Search data values in this table
    try {
      const countResult = execRaw(`SELECT COUNT(*) as cnt FROM "${t.name}"`)
      const rowCount = countResult[0]?.values[0]?.[0] || 0
      if (rowCount > 0) {
        const colNames = cols.map(c => `"${c.name}"`)
        const conditions = cols.map(c => `CAST("${c.name}" AS TEXT) LIKE '%${escapedKw}%'`).join(' OR ')
        const sql = `SELECT * FROM "${t.name}" WHERE ${conditions} LIMIT 50`
        const result = execRaw(sql)
        if (result[0]?.values?.length > 0) {
          const resultCols = result[0].columns
          const rows = result[0].values.map(row => {
            const obj = {}
            resultCols.forEach((c, i) => obj[c] = row[i])
            return obj
          })
          // Find which columns matched
          const hitCols = []
          for (const c of cols) {
            const colName = c.name
            if (colName.toLowerCase().includes(kw)) continue
            if (rows.some(r => String(r[colName] ?? '').toLowerCase().includes(kw))) {
              hitCols.push(colName)
            }
          }
          dataMatches.push({
            tableName: t.name,
            matchType: 'DataValue',
            sampleRows: rows.slice(0, 5),
            columns: resultCols,
            hitColumns: hitCols,
            totalHits: result[0].values.length,
          })
        }
      }
    } catch (e) { /* skip tables that can't be queried */ }
  }

  return { tableMatches, columnMatches, dataMatches }
}

export function searchInTable(tableName, keyword) {
  if (!keyword) return getTableData(tableName)
  const schema = execRaw(`PRAGMA table_info("${tableName}")`)
  const columns = schema[0]?.values.map(r => r[1]) || []
  const conditions = columns.map(c => `CAST("${c}" AS TEXT) LIKE '%${keyword.replace(/'/g, "''")}%'`).join(' OR ')
  const sql = `SELECT * FROM "${tableName}" WHERE ${conditions} LIMIT 500`
  const result = execRaw(sql)
  const cols = result[0]?.columns || []
  const rows = result[0]?.values.map(row => {
    const obj = {}
    cols.forEach((c, i) => obj[c] = row[i])
    return obj
  }) || []
  return { columns: cols, rows, total: rows.length, page: 1, pageSize: 500 }
}

export function closeDatabase() {
  if (db) {
    db.close()
    db = null
  }
}

export async function generateTestData() {
  await getSQL()
  if (db) db.close()
  db = new SQL.Database()

  const rInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
  const rStr = (len) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let s = ''
    for (let i = 0; i < len; i++) s += chars[rInt(0, chars.length - 1)]
    return s
  }
  const rDate = () => {
    const y = rInt(2020, 2026)
    const m = String(rInt(1, 12)).padStart(2, '0')
    const d = String(rInt(1, 28)).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const rTime = () => `${String(rInt(0,23)).padStart(2,'0')}:${String(rInt(0,59)).padStart(2,'0')}:${String(rInt(0,59)).padStart(2,'0')}`
  const pick = arr => arr[rInt(0, arr.length - 1)]
  const rPhone = () => '1' + rInt(3, 9) + Array.from({length: 9}, () => rInt(0,9)).join('')
  const rEmail = () => rStr(rInt(4, 8)).toLowerCase() + '@' + pick(['qq.com', '163.com', 'gmail.com', 'outlook.com', 'company.cn'])
  const rStatus = () => pick(['正常', '停用', '审核中', '已归档'])
  const rDept = () => pick(['研发部', '市场部', '财务部', '人事部', '运营部', '销售部', '技术支持', '管理层'])
  const rCity = () => pick(['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '重庆', '西安', '苏州', '长沙'])
  const rProduct = () => pick(['基础版', '专业版', '企业版', '旗舰版', '试用版'])
  const rLevel = () => pick(['低', '中', '高', '紧急'])
  const rType = () => pick(['Bug', '需求', '改进', '优化', '安全'])
  const rBool = () => pick([1, 0])

  // Table 1: 员工信息 (2000 rows, 14 fields)
  db.run(`CREATE TABLE 员工信息 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    工号 TEXT NOT NULL,
    姓名 TEXT NOT NULL,
    部门 TEXT,
    职位 TEXT,
    手机号 TEXT,
    邮箱 TEXT,
    入职日期 TEXT,
    城市 TEXT,
    状态 TEXT,
    薪资等级 INTEGER,
    是否在职 INTEGER,
    备注 TEXT,
    更新时间 TEXT
  )`)
  const names = ['张伟','王芳','李强','赵敏','刘洋','陈静','杨帆','黄磊','周婷','吴鑫','徐超','孙丽','马军','朱琳','胡波','郭宁','何敏','林涛','罗慧','梁峰']
  const positions = ['工程师','经理','总监','专员','主管','实习生','架构师','分析师','设计师','顾问']
  const stmt1 = db.prepare(`INSERT INTO 员工信息 (工号,姓名,部门,职位,手机号,邮箱,入职日期,城市,状态,薪资等级,是否在职,备注,更新时间) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (let i = 0; i < 2000; i++) {
    stmt1.bind([
      'EMP' + String(i + 1).padStart(5, '0'),
      pick(names) + rStr(1),
      rDept(),
      pick(positions),
      rPhone(),
      rEmail(),
      rDate(),
      rCity(),
      rStatus(),
      rInt(1, 15),
      rBool(),
      pick(['', '', '', '优秀员工', '待考核', '试用期', '已转正']),
      rDate() + ' ' + rTime(),
    ])
    stmt1.step()
    stmt1.reset()
  }
  stmt1.free()

  // Table 2: 订单记录 (2000 rows, 13 fields)
  db.run(`CREATE TABLE 订单记录 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    订单号 TEXT NOT NULL,
    客户名称 TEXT,
    产品类型 TEXT,
    金额 REAL,
    数量 INTEGER,
    下单日期 TEXT,
    交付日期 TEXT,
    状态 TEXT,
    优先级 TEXT,
    负责人 TEXT,
    是否开票 INTEGER,
    备注 TEXT
  )`)
  const stmt2 = db.prepare(`INSERT INTO 订单记录 (订单号,客户名称,产品类型,金额,数量,下单日期,交付日期,状态,优先级,负责人,是否开票,备注) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (let i = 0; i < 2000; i++) {
    stmt2.bind([
      'ORD' + rStr(8).toUpperCase(),
      pick(['腾讯','阿里','百度','字节','美团','京东','网易','华为','小米','联想']) + rStr(1) + '有限公司',
      rProduct(),
      rInt(100, 500000) + 0.99,
      rInt(1, 500),
      rDate(),
      rDate(),
      pick(['待处理', '处理中', '已完成', '已取消', '退款中']),
      rLevel(),
      pick(names),
      rBool(),
      pick(['', '', '加急', '大客户', '合同已签', '待确认']),
    ])
    stmt2.step()
    stmt2.reset()
  }
  stmt2.free()

  // Table 3: 系统日志 (2000 rows, 11 fields)
  db.run(`CREATE TABLE 系统日志 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    时间戳 TEXT NOT NULL,
    级别 TEXT,
    模块 TEXT,
    操作人 TEXT,
    IP地址 TEXT,
    操作类型 TEXT,
    目标对象 TEXT,
    耗时毫秒 INTEGER,
    是否成功 INTEGER,
    详细信息 TEXT
  )`)
  const stmt3 = db.prepare(`INSERT INTO 系统日志 (时间戳,级别,模块,操作人,IP地址,操作类型,目标对象,耗时毫秒,是否成功,详细信息) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  for (let i = 0; i < 2000; i++) {
    stmt3.bind([
      rDate() + ' ' + rTime(),
      pick(['INFO', 'WARN', 'ERROR', 'DEBUG']),
      pick(['认证模块', '订单模块', '用户模块', '支付模块', '文件模块', '通知模块']),
      pick(names),
      `192.168.${rInt(1,254)}.${rInt(1,254)}`,
      pick(['查询', '新增', '修改', '删除', '导出', '登录', '登出']),
      pick(['用户表', '订单表', '配置表', '日志表', '权限表', '角色表']),
      rInt(1, 5000),
      rBool(),
      pick(['操作成功', '操作成功', '操作成功', '参数异常', '权限不足', '连接超时', '数据不存在']),
    ])
    stmt3.step()
    stmt3.reset()
  }
  stmt3.free()

  // Table 4: 产品库存 (500 rows, 12 fields)
  db.run(`CREATE TABLE 产品库存 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    SKU TEXT NOT NULL,
    产品名称 TEXT,
    分类 TEXT,
    仓库 TEXT,
    库存数量 INTEGER,
    安全库存 INTEGER,
    单价 REAL,
    供应商 TEXT,
    上架日期 TEXT,
    状态 TEXT,
    是否热销 INTEGER
  )`)
  const stmt4 = db.prepare(`INSERT INTO 产品库存 (SKU,产品名称,分类,仓库,库存数量,安全库存,单价,供应商,上架日期,状态,是否热销) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  for (let i = 0; i < 500; i++) {
    stmt4.bind([
      'SKU-' + rStr(6).toUpperCase(),
      pick(['键盘', '鼠标', '显示器', '耳机', '摄像头', '音箱', '路由器', '硬盘', '内存条', '主板', '电源', '散热器']) + ' ' + pick(['标准版', '增强版', '轻量版', '至尊版']),
      pick(['电脑外设', '网络设备', '存储设备', '配件', '音频设备']),
      pick(['华北仓', '华东仓', '华南仓', '西南仓', '华中仓']),
      rInt(0, 10000),
      rInt(50, 500),
      rInt(19, 5999) + 0.9,
      pick(['供应商A', '供应商B', '供应商C', '供应商D', '供应商E']),
      rDate(),
      pick(['在售', '下架', '缺货', '预售']),
      rBool(),
    ])
    stmt4.step()
    stmt4.reset()
  }
  stmt4.free()

  // Table 5: 项目任务 (1500 rows, 14 fields)
  db.run(`CREATE TABLE 项目任务 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    任务编号 TEXT NOT NULL,
    标题 TEXT,
    类型 TEXT,
    优先级 TEXT,
    状态 TEXT,
    负责人 TEXT,
    创建日期 TEXT,
    截止日期 TEXT,
    预估工时 REAL,
    实际工时 REAL,
    完成度 INTEGER,
    所属项目 TEXT,
    描述 TEXT
  )`)
  const stmt5 = db.prepare(`INSERT INTO 项目任务 (任务编号,标题,类型,优先级,状态,负责人,创建日期,截止日期,预估工时,实际工时,完成度,所属项目,描述) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (let i = 0; i < 1500; i++) {
    stmt5.bind([
      'TASK-' + String(i + 1).padStart(4, '0'),
      pick(['实现登录功能', '修复首页Bug', '优化查询性能', '设计数据库表结构', '编写API文档', '配置CI/CD', '代码审查', '编写测试用例', '重构用户模块', '集成第三方支付', '升级依赖版本', '性能压测']) + ' ' + rStr(3),
      rType(),
      rLevel(),
      pick(['待开始', '进行中', '已完成', '已关闭', '已搁置']),
      pick(names),
      rDate(),
      rDate(),
      rInt(1, 40) + 0.5,
      rInt(0, 60) + 0.5,
      rInt(0, 100),
      pick(['鹰捷数据平台', '用户中心', '支付系统', '数据中台', '运维平台', '移动端App']),
      pick(['需要尽快处理', '关联需求#'+rInt(100,999), '影响线上环境', '技术债务', '', '', '']),
    ])
    stmt5.step()
    stmt5.reset()
  }
  stmt5.free()

  // Table 6: 配置参数 (30 rows, 8 fields) - small lookup table
  db.run(`CREATE TABLE 配置参数 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    参数键 TEXT NOT NULL,
    参数值 TEXT,
    分类 TEXT,
    说明 TEXT,
    是否启用 INTEGER,
    创建时间 TEXT,
    更新时间 TEXT
  )`)
  const configs = [
    ['sys.name', '鹰捷数据管理系统', '系统', '系统名称', 1],
    ['sys.version', '5.6.0', '系统', '当前版本', 1],
    ['db.max_connections', '50', '数据库', '最大连接数', 1],
    ['db.timeout', '30', '数据库', '超时时间(秒)', 1],
    ['cache.ttl', '3600', '缓存', '缓存过期时间(秒)', 1],
    ['cache.enabled', 'true', '缓存', '是否启用缓存', 1],
    ['log.level', 'INFO', '日志', '日志级别', 1],
    ['log.retention_days', '90', '日志', '日志保留天数', 1],
    ['upload.max_size', '10485760', '上传', '最大上传大小(字节)', 1],
    ['upload.allowed_types', 'jpg,png,pdf,xlsx', '上传', '允许的文件类型', 1],
    ['auth.max_retries', '5', '安全', '最大登录重试次数', 1],
    ['auth.lock_duration', '1800', '安全', '账户锁定时长(秒)', 1],
    ['notify.email.enabled', 'true', '通知', '邮件通知开关', 1],
    ['notify.sms.enabled', 'false', '通知', '短信通知开关', 0],
    ['backup.auto_enabled', 'true', '备份', '自动备份开关', 1],
    ['backup.interval_hours', '24', '备份', '备份间隔(小时)', 1],
    ['session.timeout', '7200', '会话', '会话超时(秒)', 1],
    ['api.rate_limit', '1000', '接口', '接口限流(次/分钟)', 1],
    ['search.max_results', '500', '搜索', '最大搜索结果数', 1],
    ['export.max_rows', '100000', '导出', '最大导出行数', 1],
    ['theme.default', 'auto', '界面', '默认主题', 1],
    ['language.default', 'zh-CN', '界面', '默认语言', 1],
    ['pagination.page_size', '100', '分页', '每页条数', 1],
    ['snapshot.auto_enabled', 'true', '快照', '自动快照开关', 1],
    ['snapshot.compression', 'gzip', '快照', '压缩方式', 1],
    ['proxy.port', '9527', '代理', '代理端口', 1],
    ['proxy.timeout', '60', '代理', '代理超时(秒)', 1],
    ['security.encrypt_data', 'true', '安全', '数据加密开关', 1],
    ['security.audit_log', 'true', '安全', '审计日志开关', 1],
    ['mobile.offline_mode', 'true', '移动端', '离线模式开关', 1],
  ]
  for (const c of configs) {
    db.run(`INSERT INTO 配置参数 (参数键,参数值,分类,说明,是否启用,创建时间,更新时间) VALUES (?,?,?,?,?,?,?)`, [
      c[0], c[1], c[2], c[3], c[4], rDate() + ' ' + rTime(), rDate() + ' ' + rTime(),
    ])
  }

  // Table 7: API 接口配置 (200 rows, 10 fields) - JSON + function data
  db.run(`CREATE TABLE API接口配置 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    接口名称 TEXT NOT NULL,
    请求方法 TEXT,
    请求路径 TEXT,
    请求头 TEXT,
    请求参数 TEXT,
    响应模板 TEXT,
    校验函数 TEXT,
    状态 TEXT,
    备注 TEXT
  )`)
  const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  const paths = ['/api/users', '/api/orders', '/api/products', '/api/config', '/api/auth/login', '/api/auth/logout', '/api/search', '/api/export', '/api/upload', '/api/stats']
  const rHeaders = () => JSON.stringify({
    'Content-Type': pick(['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data']),
    'Authorization': 'Bearer ' + rStr(32),
    'X-Request-Id': rStr(16),
    'Accept': 'application/json',
    'X-App-Version': pick(['5.6.0', '5.5.9', '5.5.8']),
    'User-Agent': 'DBSearch/' + pick(['5.6.0', '5.5.9']),
  })
  const rBody = () => JSON.stringify(pick([
    { username: 'admin', password: '******', remember: true },
    { page: rInt(1, 100), pageSize: pick([10, 20, 50, 100]), keyword: rStr(rInt(2, 8)), sort: pick(['asc', 'desc']), field: pick(['name', 'created_at', 'id']) },
    { ids: Array.from({length: rInt(1, 5)}, () => rInt(1, 9999)) },
    { type: pick(['full', 'incremental']), options: { compress: true, encrypt: false, format: 'json', timeout: rInt(5, 30) }, filters: pick([null, { status: 'active', role: 'admin' }]) },
    { name: pick(['测试用户', '系统管理员', '访客']), email: rEmail(), roles: ['user', pick(['admin', 'editor', 'viewer'])], department: rDept() },
    { query: 'SELECT * FROM users WHERE status = ? AND created_at > ?', params: [pick(['active', 'inactive', 'pending']), rDate()], limit: rInt(10, 1000) },
    { file: { name: 'report.xlsx', size: rInt(1024, 10485760), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, overwrite: pick([true, false]) },
    { startDate: rDate(), endDate: rDate(), groupBy: pick(['day', 'week', 'month']), metrics: pick([['revenue', 'orders'], ['users', 'sessions'], ['errors', 'latency']]) },
    { transform: { type: pick(['map', 'filter', 'reduce']), expression: 'item => item.' + pick(['value', 'count', 'name', 'id']), source: 'input_' + rStr(4) } },
    { webhook: { url: 'https://api.example.com/hook/' + rStr(8), method: pick(['POST', 'PUT']), headers: { 'X-Secret': rStr(24) }, retry: { count: rInt(1, 5), delay: rInt(100, 5000) } } },
  ]))
  const rResponse = () => JSON.stringify({
    code: pick([200, 200, 200, 201, 204, 400, 401, 403, 404, 500]),
    message: pick(['success', 'ok', '操作成功', '创建成功', '参数错误', '未授权', '无权限', '资源不存在', '服务器内部错误']),
    data: pick([
      { total: rInt(100, 99999), list: Array.from({length: 2}, () => ({ id: rInt(1, 9999), name: rStr(rInt(4, 10)), status: pick(['active', 'inactive']) })) },
      { token: rStr(64), expires_in: pick([3600, 7200, 86400]), refresh_token: rStr(64) },
      { url: 'https://cdn.example.com/files/' + rStr(12) + '.xlsx', size: rInt(1024, 10485760) },
      null,
      { affected: rInt(1, 100), matched: rInt(1, 100) },
    ]),
    timestamp: rDate() + 'T' + rTime() + 'Z',
    traceId: rStr(16),
  })
  const rFunc = () => pick([
    '(data) => data.filter(item => item.status === "active").map(item => ({ ...item, score: item.score * 1.1 }))',
    'function validate(user) {\n  if (!user.name || user.name.length < 2) return { valid: false, msg: "名称过短" };\n  if (!/^[\\w-]+@[\\w-]+\\.[a-z]+$/.test(user.email)) return { valid: false, msg: "邮箱格式错误" };\n  return { valid: true };\n}',
    '(req, res) => {\n  const { page = 1, size = 20 } = req.query;\n  const offset = (page - 1) * size;\n  return db.query("SELECT * FROM orders LIMIT ? OFFSET ?", [size, offset]);\n}',
    'async (ctx) => {\n  const token = ctx.headers.authorization?.replace("Bearer ", "");\n  if (!token) throw new AuthError("Missing token");\n  const payload = jwt.verify(token, SECRET_KEY);\n  ctx.state.user = payload;\n  await next();\n}',
    '(items) => items.reduce((acc, cur) => {\n  const key = cur.category || "default";\n  if (!acc[key]) acc[key] = { count: 0, total: 0 };\n  acc[key].count += 1;\n  acc[key].total += cur.amount || 0;\n  return acc;\n}, {})',
    'function throttle(fn, delay = 300) {\n  let timer = null;\n  return function (...args) {\n    if (timer) return;\n    timer = setTimeout(() => {\n      fn.apply(this, args);\n      timer = null;\n    }, delay);\n  };\n}',
    '(config) => {\n  const defaults = { timeout: 5000, retries: 3, headers: {} };\n  return { ...defaults, ...config, headers: { ...defaults.headers, ...config.headers } };\n}',
    'function deepClone(obj) {\n  if (obj === null || typeof obj !== "object") return obj;\n  if (Array.isArray(obj)) return obj.map(deepClone);\n  return Object.fromEntries(\n    Object.entries(obj).map(([k, v]) => [k, deepClone(v)])\n  );\n}',
  ])
  const stmt7 = db.prepare(`INSERT INTO API接口配置 (接口名称,请求方法,请求路径,请求头,请求参数,响应模板,校验函数,状态,备注) VALUES (?,?,?,?,?,?,?,?,?)`)
  for (let i = 0; i < 200; i++) {
    stmt7.bind([
      pick(['用户登录', '用户注册', '获取用户列表', '创建订单', '查询订单', '导出报表', '上传文件', '搜索数据', '获取统计', '更新配置', '删除记录', '批量操作', '健康检查', '权限校验', '数据同步', '缓存刷新']) + rStr(1),
      pick(methods),
      pick(paths) + (pick([true, false]) ? '/' + rInt(1, 9999) : ''),
      rHeaders(),
      pick([true, true, false]) ? rBody() : '',
      rResponse(),
      rFunc(),
      pick(['启用', '启用', '启用', '启用', '禁用', '维护中', '测试中']),
      pick(['', '', '', '需要管理员权限', '限流100次/分钟', '仅内网可访问', '需要二次验证']),
    ])
    stmt7.step()
    stmt7.reset()
  }
  stmt7.free()

  return db
}
