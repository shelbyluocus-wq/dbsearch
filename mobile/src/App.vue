<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import * as db from './db.js'
import * as api from './api.js'
import { StatusBar, Style } from '@capacitor/status-bar'
import { App } from '@capacitor/app'
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning'
import mysqlTemplate1 from '../mysql_model/1.json'
import mysqlTemplate2 from '../mysql_model/2.json'

// ---- State ----
const currentTab = ref('tables')
const snapshots = ref([])
const activeSnapshot = ref(null)
const isDark = ref(false)

// Connection config
const config = reactive({
  host: '',
  port: '3306',
  user: '',
  password: '',
})

const mysqlTemplates = [
  { name: '1', config: mysqlTemplate1 },
  { name: '2', config: mysqlTemplate2 },
]
const selectedTemplateName = ref('1')
const preferredDatabase = ref(mysqlTemplate1.database || '')
const proxyBinding = reactive({ host: '', port: '19527' })
const manualProxyText = ref('')
const showManualProxy = ref(false)
const scannerActive = ref(false)

// Database selection
const databases = ref([])
const databaseCatalog = ref(null)

// Table list
const tables = ref([])
const tableSearch = ref('')

// Current table data view
const currentTable = ref(null)
const tableData = reactive({ columns: [], rows: [], total: 0, page: 1, pageSize: 100 })
const dataSearch = ref('')
const fullscreen = ref(false)

// UI state
const loading = ref(false)
const loadingText = ref('')
const error = ref('')
const showCellViewer = ref(false)
const cellViewerLabel = ref('')
const cellViewerValue = ref('')
const cellViewerFormatted = ref('')

// Triple-tap for test mode
const tapTimestamps = []

// ---- Computed ----
const filteredTables = computed(() => {
  if (!tableSearch.value) return tables.value
  const kw = tableSearch.value.toLowerCase()
  return tables.value.filter(t => t.name.toLowerCase().includes(kw))
})

const databaseCards = computed(() => {
  const cards = []
  const seen = new Set()
  const snapshotById = new Map(snapshots.value.map(snap => [snap.id, snap]))
  const catalog = databaseCatalog.value
  if (catalog?.databases?.length) {
    const host = catalog.host || config.host
    const port = String(catalog.port || config.port || '3306')
    for (const databaseName of catalog.databases) {
      const id = getSnapshotId(host, port, databaseName)
      const snapshot = snapshotById.get(id) || null
      seen.add(id)
      cards.push({
        id,
        name: databaseName,
        host,
        port,
        snapshot,
        hasSnapshot: Boolean(snapshot),
      })
    }
  }
  for (const snapshot of snapshots.value) {
    if (seen.has(snapshot.id)) continue
    cards.push({
      id: snapshot.id,
      name: snapshot.name,
      host: snapshot.host,
      port: snapshot.port,
      snapshot,
      hasSnapshot: true,
    })
  }
  return cards
})

// Global search
const searchResults = reactive({ tableMatches: [], columnMatches: [], dataMatches: [] })
const globalSearchActive = ref(false)
let searchDebounce = null

function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  if (!tableSearch.value.trim()) {
    globalSearchActive.value = false
    searchResults.tableMatches = []
    searchResults.columnMatches = []
    searchResults.dataMatches = []
    return
  }
  searchDebounce = setTimeout(() => runGlobalSearch(), 300)
}

function runGlobalSearch() {
  const kw = tableSearch.value.trim()
  if (!kw) return
  const results = db.globalSearch(kw)
  searchResults.tableMatches = results.tableMatches
  searchResults.columnMatches = results.columnMatches
  searchResults.dataMatches = results.dataMatches
  globalSearchActive.value = true
}

// ---- Dark mode ----
function statusBarThemeColor(dark) {
  return dark ? '#18181b' : '#ffffff'
}

async function syncStatusBarInset() {
  try {
    const info = await StatusBar.getInfo()
    document.documentElement.style.setProperty('--safe-top', `${Math.max(0, Number(info.height) || 0)}px`)
  } catch {
    document.documentElement.style.setProperty('--safe-top', '0px')
  }
}

async function applyTheme(dark) {
  isDark.value = dark
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  localStorage.setItem('dbs-theme', dark ? 'dark' : 'light')
  try { await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }) } catch {}
  try { await StatusBar.setBackgroundColor({ color: statusBarThemeColor(dark) }) } catch {}
}

function toggleTheme() { applyTheme(!isDark.value) }

function loadTheme() {
  const saved = localStorage.getItem('dbs-theme')
  if (saved === 'dark') applyTheme(true)
  else if (saved === 'light') applyTheme(false)
  else applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches)
}

// ---- Config storage ----
function applyTemplate(name) {
  const template = mysqlTemplates.find(t => t.name === name) || mysqlTemplates[0]
  selectedTemplateName.value = template.name
  config.host = template.config.host || ''
  config.port = String(template.config.port || '3306')
  config.user = template.config.user || ''
  config.password = template.config.password || ''
  preferredDatabase.value = template.config.database || ''
}

async function saveConfig() {
  try {
    localStorage.setItem('dbs-config', JSON.stringify(config))
    localStorage.setItem('dbs-template', selectedTemplateName.value)
  } catch {}
}
function loadConfig() {
  try {
    applyTemplate(localStorage.getItem('dbs-template') || '1')
  } catch {
    applyTemplate('1')
  }
}

function proxyBaseUrl() {
  return `http://${proxyBinding.host}:${proxyBinding.port || '19527'}`
}

function normalizeProxyInput(value) {
  const raw = String(value || '').trim().replace(/^https?:\/\//, '')
  const [host, port = '19527'] = raw.split(':')
  return { host: host.trim(), port: String(port || '19527').trim() }
}

function saveProxyBinding() {
  localStorage.setItem('dbs-proxy-binding', JSON.stringify(proxyBinding))
}

function loadProxyBinding() {
  try {
    const saved = JSON.parse(localStorage.getItem('dbs-proxy-binding'))
    if (saved?.host) {
      Object.assign(proxyBinding, { host: saved.host, port: String(saved.port || '19527') })
      manualProxyText.value = `${proxyBinding.host}:${proxyBinding.port}`
    }
  } catch {}
}

async function verifyProxyBinding() {
  api.setBaseUrl(proxyBaseUrl())
  try {
    await api.testProxy()
  } catch {
    throw new Error(`无法连接桌面端 ${proxyBinding.host}:${proxyBinding.port}，请确认手机和电脑在同一 Wi-Fi，电脑端已打开，并且局域网没有拦截 19527 端口`)
  }
}

async function bindProxyFromPayload(payload) {
  const parsed = typeof payload === 'string' && payload.trim().startsWith('{') ? JSON.parse(payload) : normalizeProxyInput(payload)
  const host = parsed.apiHost || parsed.host
  const port = parsed.apiPort || parsed.port || '19527'
  if (!host) throw new Error('二维码里没有桌面端地址')
  proxyBinding.host = String(host)
  proxyBinding.port = String(port)
  manualProxyText.value = `${proxyBinding.host}:${proxyBinding.port}`
  await verifyProxyBinding()
  saveProxyBinding()
}

async function stopProxyQrScan() {
  scannerActive.value = false
  document.body.classList.remove('barcode-scanner-active')
  try { await BarcodeScanner.removeAllListeners() } catch {}
  try { await BarcodeScanner.stopScan() } catch {}
}

async function scanProxyQr() {
  error.value = ''
  try {
    const supported = await BarcodeScanner.isSupported()
    if (!supported.supported) throw new Error('当前设备不支持扫码')
    const perm = await BarcodeScanner.requestPermissions()
    if (perm.camera !== 'granted') throw new Error('没有相机权限')
    scannerActive.value = true
    document.body.classList.add('barcode-scanner-active')
    await BarcodeScanner.removeAllListeners()
    await BarcodeScanner.addListener('barcodesScanned', async (event) => {
      const value = event.barcodes?.[0]?.rawValue || event.barcodes?.[0]?.displayValue
      if (!value) return
      await stopProxyQrScan()
      try {
        await bindProxyFromPayload(value)
        error.value = ''
      } catch (e) {
        error.value = e.message || '扫码绑定失败'
        showManualProxy.value = true
      }
    })
    await BarcodeScanner.startScan({ formats: [BarcodeFormat.QrCode] })
  } catch (e) {
    await stopProxyQrScan()
    error.value = e.message || '扫码失败，请手动输入桌面端地址'
    showManualProxy.value = true
  }
}

async function bindManualProxy() {
  try {
    const normalized = normalizeProxyInput(manualProxyText.value)
    if (!normalized.host) throw new Error('请输入桌面端地址')
    proxyBinding.host = normalized.host
    proxyBinding.port = normalized.port
    manualProxyText.value = `${proxyBinding.host}:${proxyBinding.port}`
    await verifyProxyBinding()
    saveProxyBinding()
    showManualProxy.value = false
    error.value = ''
  } catch (e) {
    error.value = e.message || '桌面端地址无效'
  }
}

// ---- Multi-snapshot storage ----
function getSnapshotId(host, port, database) {
  return `${host}:${port}/${database}`
}

function loadSnapshotsMeta() {
  try { return JSON.parse(localStorage.getItem('dbs-snapshots')) || [] } catch { return [] }
}

function saveSnapshotsMeta(list) {
  localStorage.setItem('dbs-snapshots', JSON.stringify(list))
}

const DATABASE_CATALOG_KEY = 'dbs-database-catalog'

function loadDatabaseCatalog() {
  try {
    const catalog = JSON.parse(localStorage.getItem(DATABASE_CATALOG_KEY))
    if (!catalog?.host || !Array.isArray(catalog.databases)) return null
    return {
      host: catalog.host,
      port: String(catalog.port || '3306'),
      databases: catalog.databases.map(String),
      time: catalog.time || '',
    }
  } catch {
    return null
  }
}

function saveDatabaseCatalog(catalog) {
  databaseCatalog.value = catalog
  databases.value = catalog.databases
  localStorage.setItem(DATABASE_CATALOG_KEY, JSON.stringify(catalog))
}

function updateDatabaseCatalog(databaseNames) {
  const catalog = {
    host: config.host,
    port: String(config.port || '3306'),
    databases: [...databaseNames].map(String),
    time: new Date().toISOString(),
  }
  saveDatabaseCatalog(catalog)
  return catalog
}

const IDB_NAME = 'dbs-snapshots'
const IDB_STORE = 'data'

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 2)
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveSnapshotData(id, uint8Array) {
  const idb = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(uint8Array, id)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

async function loadSnapshotData(id) {
  const idb = await openIDB()
  return new Promise((resolve) => {
    const tx = idb.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(id)
    req.onsuccess = () => resolve(req.result?.buffer || null)
    req.onerror = () => resolve(null)
  })
}

async function deleteSnapshotData(id) {
  const idb = await openIDB()
  return new Promise((resolve) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(id)
    tx.oncomplete = resolve
    tx.onerror = () => resolve()
  })
}

// Migrate old single-snapshot format
async function migrateLegacySnapshot() {
  const oldMeta = localStorage.getItem('dbs-snapshot-meta')
  if (!oldMeta || localStorage.getItem('dbs-snapshots')) return
  try {
    const meta = JSON.parse(oldMeta)
    if (meta.testMode) {
      localStorage.removeItem('dbs-snapshot-meta')
      localStorage.removeItem('dbs-snapshot-db')
      try { indexedDB.deleteDatabase('dbs-snapshot') } catch {}
      return
    }
    let buffer = null
    try {
      const base64 = localStorage.getItem('dbs-snapshot-db')
      if (base64) {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        buffer = bytes.buffer
      }
    } catch {}
    if (!buffer) {
      try {
        const oldIdb = await new Promise((resolve, reject) => {
          const r = indexedDB.open('dbs-snapshot', 1)
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => reject(r.error)
        })
        buffer = await new Promise((resolve) => {
          const tx = oldIdb.transaction('data', 'readonly')
          const r = tx.objectStore('data').get('snapshot')
          r.onsuccess = () => resolve(r.result?.buffer || null)
          r.onerror = () => resolve(null)
        })
      } catch {}
    }
    if (buffer) {
      const id = getSnapshotId(meta.host || 'unknown', meta.port || '3306', meta.database)
      const snapMeta = { id, name: meta.database, host: meta.host || '', port: meta.port || '3306', database: meta.database, tableCount: meta.tableCount || 0, time: meta.time, testMode: false }
      await saveSnapshotData(id, new Uint8Array(buffer))
      saveSnapshotsMeta([snapMeta])
    }
    localStorage.removeItem('dbs-snapshot-meta')
    localStorage.removeItem('dbs-snapshot-db')
    try { indexedDB.deleteDatabase('dbs-snapshot') } catch {}
  } catch {}
}

// ---- Test mode ----
function onHeaderTap() {
  const now = Date.now()
  tapTimestamps.push(now)
  if (tapTimestamps.length > 3) tapTimestamps.shift()
  if (tapTimestamps.length === 3 && tapTimestamps[2] - tapTimestamps[0] < 1500) {
    activateTestMode()
    tapTimestamps.length = 0
  }
}

async function activateTestMode() {
  loading.value = true
  loadingText.value = '正在生成测试数据...'
  try {
    await db.generateTestData()
    const snapshotDb = await db.exportDatabase()
    const id = 'test_mode'
    const now = new Date().toISOString()
    const meta = { id, name: '[测试模式]', host: '', port: '', database: '[测试模式]', tableCount: 0, time: now, testMode: true }
    await saveSnapshotData(id, snapshotDb)
    const list = loadSnapshotsMeta()
    const idx = list.findIndex(s => s.id === id)
    if (idx >= 0) list[idx] = meta; else list.push(meta)
    loadTableList()
    meta.tableCount = tables.value.length
    saveSnapshotsMeta(list)
    snapshots.value = list
    activeSnapshot.value = meta
    currentTab.value = 'tables'
  } catch (e) {
    error.value = '测试数据生成失败: ' + e.message
  } finally {
    loading.value = false
    loadingText.value = ''
  }
}

// ---- Snapshot selection ----
async function selectSnapshot(snap) {
  loading.value = true
  loadingText.value = '正在加载快照...'
  try {
    const buffer = await loadSnapshotData(snap.id)
    if (!buffer) throw new Error('快照数据不存在')
    await db.openDatabase(buffer)
    activeSnapshot.value = snap
    loadTableList()
    tableSearch.value = ''
    globalSearchActive.value = false
    currentTable.value = null
    currentTab.value = 'tables'
  } catch (e) {
    error.value = '加载快照失败: ' + e.message
  } finally {
    loading.value = false
    loadingText.value = ''
  }
}

function closeSnapshot() {
  activeSnapshot.value = null
  currentTable.value = null
  fullscreen.value = false
  tableSearch.value = ''
  globalSearchActive.value = false
  db.closeDatabase()
}

// ---- Connection & snapshot ----
async function connectAndFetchDatabases() {
  if (!proxyBinding.host) {
    error.value = '请先扫码绑定桌面端'
    return
  }
  if (!config.host || !config.user) {
    error.value = '请选择 MySQL 模板'
    return
  }
  loading.value = true
  error.value = ''
  const previousSnapshot = activeSnapshot.value
  try {
    api.setBaseUrl(proxyBaseUrl())
    loadingText.value = '正在连接并读取数据库列表...'
    const connConfig = { host: config.host, port: parseInt(config.port), user: config.user, password: config.password }
    await api.testConnection(connConfig)
    const result = await api.listDatabases(connConfig)
    databases.value = result.databases || []
    if (databases.value.length === 0) throw new Error('没有可快照的数据库')
    updateDatabaseCatalog(databases.value)
    saveConfig()
    closeSnapshot()
    currentTab.value = 'tables'
  } catch (e) {
    snapshots.value = loadSnapshotsMeta()
    if (previousSnapshot) await selectSnapshot(previousSnapshot)
    else closeSnapshot()
    error.value = e.message || '连接失败'
  } finally {
    loading.value = false
    loadingText.value = ''
  }
}

async function takeSnapshot(databaseName, options = {}) {
  if (!databaseName) { error.value = '请先选择一个数据库'; return null }
  const connConfig = { host: config.host, port: parseInt(config.port), user: config.user, password: config.password, database: databaseName }
  loadingText.value = `正在获取 ${databaseName} 的表列表...`
  const tablesResult = await api.getTables(connConfig)
  const tableNames = tablesResult.tables || []
  loadingText.value = `正在快照 ${databaseName} (${tableNames.length} 张表)...`
  await db.openDatabase()
  db.execRaw('BEGIN')
  try {
    let completed = 0
    for (const tbl of tableNames) {
      loadingText.value = `快照 ${databaseName} (${++completed}/${tableNames.length}): ${tbl}`
      const rowsResult = await api.getTableRows(connConfig, tbl, 0, 100000)
      if (rowsResult.columns?.length) {
        const columnDefs = rowsResult.columns.map(c => `"${String(c).replace(/"/g, '""')}" TEXT`).join(', ')
        db.execRaw(`CREATE TABLE "${tbl.replace(/"/g, '""')}" (${columnDefs})`)
        db.insertRows(tbl, rowsResult.columns, rowsResult.rows || [])
      }
    }
    db.execRaw('COMMIT')
  } catch (e) {
    try { db.execRaw('ROLLBACK') } catch {}
    throw e
  }
  const snapshotDb = await db.exportDatabase()
  const id = getSnapshotId(config.host, config.port, databaseName)
  const now = new Date().toISOString()
  const meta = { id, name: databaseName, host: config.host, port: config.port, database: databaseName, tableCount: tableNames.length, time: now, testMode: false }
  await saveSnapshotData(id, snapshotDb)
  const list = loadSnapshotsMeta()
  const idx = list.findIndex(s => s.id === id)
  if (idx >= 0) list[idx] = meta; else list.push(meta)
  saveSnapshotsMeta(list)
  snapshots.value = list
  if (options.activate !== false) {
    activeSnapshot.value = meta
    loadTableList()
    currentTab.value = 'tables'
  }
  return meta
}

async function snapshotDatabase(databaseName) {
  if (!proxyBinding.host) {
    error.value = '这个数据库还没有快照，请先在「连接」页绑定桌面端'
    currentTab.value = 'connect'
    return null
  }
  if (!config.host || !config.user) {
    error.value = '请先在「连接」页选择 MySQL 模板'
    currentTab.value = 'connect'
    return null
  }
  loading.value = true
  error.value = ''
  try {
    api.setBaseUrl(proxyBaseUrl())
    return await takeSnapshot(databaseName)
  } catch (e) {
    error.value = e.message || '快照失败'
    return null
  } finally {
    loading.value = false
    loadingText.value = ''
  }
}

async function openDatabaseCard(card) {
  if (card.snapshot) {
    await selectSnapshot(card.snapshot)
    return
  }
  if (!confirm(`数据库「${card.name}」还没有快照，现在快照这个数据库吗？`)) return
  if (card.host) config.host = card.host
  if (card.port) config.port = card.port
  await snapshotDatabase(card.name)
}

function loadTableList() {
  tables.value = db.getTableList().map(t => ({ name: t.name, sql: t.sql || '' }))
}

function openTable(tableName) {
  currentTable.value = tableName
  dataSearch.value = ''
  loadTablePage(1)
}

function loadTablePage(page) {
  const result = db.getTableData(currentTable.value, page, tableData.pageSize)
  tableData.columns = result.columns
  tableData.rows = result.rows
  tableData.total = result.total
  tableData.page = result.page
}

function searchInTable() {
  if (!dataSearch.value) { loadTablePage(1); return }
  const result = db.searchInTable(currentTable.value, dataSearch.value)
  tableData.columns = result.columns
  tableData.rows = result.rows
  tableData.total = result.total
  tableData.page = 1
}

function showCell(col, row) {
  cellViewerLabel.value = col
  const raw = String(row[col] ?? '')
  cellViewerValue.value = raw
  cellViewerFormatted.value = formatCellValue(raw)
  showCellViewer.value = true
}

function formatCellValue(val) {
  const trimmed = val.trim()
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return syntaxHighlight(JSON.stringify(JSON.parse(trimmed), null, 2)) } catch {}
  }
  if (trimmed.includes('\n') || /^(function\s*\(|(\(.*\)\s*=>)|(\w+\s*=>))/.test(trimmed) || /^(const|let|var|async|export|import|class)\s/.test(trimmed)) {
    return tsHighlight(trimmed)
  }
  return ''
}

function goBack() {
  if (currentTable.value) { currentTable.value = null; fullscreen.value = false }
  else if (activeSnapshot.value) closeSnapshot()
}

function switchTab(tab) {
  if (tab === 'tables' && currentTable.value) currentTable.value = null
  currentTab.value = tab
}

function deleteSnapshot(snapId) {
  const snap = snapshots.value.find(s => s.id === snapId)
  if (!confirm(`确定要删除快照「${snap?.name || ''}」吗？`)) return
  if (activeSnapshot.value?.id === snapId) closeSnapshot()
  deleteSnapshotData(snapId)
  const list = snapshots.value.filter(s => s.id !== snapId)
  saveSnapshotsMeta(list)
  snapshots.value = list
}

async function refreshSnapshot(snap) {
  if (!snap?.database) return
  config.host = snap.host || config.host
  config.port = snap.port || config.port || '3306'
  await snapshotDatabase(snap.database)
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function truncate(v, len = 40) {
  const s = String(v ?? '')
  return s.length > len ? s.slice(0, len) + '...' : s
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function syntaxHighlight(json) {
  return escapeHtml(json)
    .replace(/("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?)/g, (match) => {
      let cls = 'json-string'
      if (/:$/.test(match)) cls = 'json-key'
      return `<span class="${cls}">${match}</span>`
    })
    .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
    .replace(/\b(null)\b/g, '<span class="json-null">$1</span>')
    .replace(/\b(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, '<span class="json-number">$1</span>')
}

function tsHighlight(code) {
  const tokens = []
  let i = 0
  const len = code.length
  const kw = new Set(['function','return','const','let','var','if','else','for','while','do','switch','case','break','default','new','typeof','instanceof','in','of','class','extends','implements','interface','type','enum','import','export','from','as','async','await','try','catch','finally','throw','throws','void','delete','yield','super','this','static','get','set','constructor','public','private','protected','readonly','abstract','declare','namespace','module','require','true','false','null','undefined'])
  const builtins = new Set(['console','Math','JSON','Object','Array','String','Number','Boolean','Promise','Map','Set','Date','RegExp','Error','Symbol','BigInt','parseInt','parseFloat','isNaN','isFinite','encodeURI','decodeURI','encodeURIComponent','decodeURIComponent','setTimeout','setInterval','clearTimeout','clearInterval','fetch','Response','Request','Headers'])
  while (i < len) {
    if (code[i] === '/' && code[i+1] === '/') { let e = code.indexOf('\n', i); if (e === -1) e = len; tokens.push({type:'comment',text:code.slice(i,e)}); i = e; continue }
    if (code[i] === '/' && code[i+1] === '*') { let e = code.indexOf('*/', i+2); if (e === -1) e = len; else e += 2; tokens.push({type:'comment',text:code.slice(i,e)}); i = e; continue }
    if ("'\"`".includes(code[i])) { const q = code[i]; let j = i+1; while (j < len) { if (code[j] === '\\') { j += 2; continue } if (code[j] === q) { j++; break } j++ } tokens.push({type:'string',text:code.slice(i,j)}); i = j; continue }
    if (/\d/.test(code[i]) && (i === 0 || !/\w/.test(code[i-1]))) { let j = i; if (code[j] === '0' && (code[j+1] === 'x' || code[j+1] === 'X')) { j += 2; while (j < len && /[0-9a-fA-F]/.test(code[j])) j++ } else { while (j < len && /\d/.test(code[j])) j++; if (j < len && code[j] === '.') { j++; while (j < len && /\d/.test(code[j])) j++ } if (j < len && (code[j] === 'e' || code[j] === 'E')) { j++; if (j < len && (code[j] === '+' || code[j] === '-')) j++; while (j < len && /\d/.test(code[j])) j++ } } tokens.push({type:'number',text:code.slice(i,j)}); i = j; continue }
    if (/[a-zA-Z_$]/.test(code[i])) { let j = i; while (j < len && /[a-zA-Z0-9_$]/.test(code[j])) j++; const w = code.slice(i,j); let t = 'ident'; if (kw.has(w)) t = 'keyword'; else if (builtins.has(w)) t = 'builtin'; else if (j < len && code[j] === '(') t = 'function'; tokens.push({type:t,text:w}); i = j; continue }
    if ('=<>!+-*/%&|^~?:'.includes(code[i])) { let j = i+1; while (j < len && '=<>!+-*/%&|^~?:'.includes(code[j])) j++; tokens.push({type:'operator',text:code.slice(i,j)}); i = j; continue }
    if ('(){}[].,;'.includes(code[i])) { tokens.push({type:'punctuation',text:code[i]}); i++; continue }
    if (code[i] === '@' || code[i] === '#') { let j = i+1; while (j < len && /[a-zA-Z0-9_$]/.test(code[j])) j++; tokens.push({type:'decorator',text:code.slice(i,j)}); i = j; continue }
    tokens.push({type:'plain',text:code[i]}); i++
  }
  return tokens.map(t => { const s = escapeHtml(t.text); return (t.type === 'plain' || t.type === 'ident') ? s : `<span class="ts-${t.type}">${s}</span>` }).join('')
}

// ---- Init ----
onMounted(async () => {
  try { await StatusBar.setOverlaysWebView({ overlay: true }) } catch {}
  await syncStatusBarInset()
  try {
    let lastBack = 0
    App.addListener('backButton', () => {
      if (scannerActive.value) { stopProxyQrScan(); return }
      if (showCellViewer.value) { showCellViewer.value = false; return }
      if (fullscreen.value) { fullscreen.value = false; return }
      if (currentTable.value) { currentTable.value = null; fullscreen.value = false; return }
      if (activeSnapshot.value) { closeSnapshot(); return }
      if (currentTab.value !== 'tables') { currentTab.value = 'tables'; return }
      const now = Date.now()
      if (now - lastBack < 2000) App.exitApp()
      lastBack = now
    })
  } catch {}
  loadTheme()
  loadProxyBinding()
  loadConfig()
  databaseCatalog.value = loadDatabaseCatalog()
  if (databaseCatalog.value?.databases) databases.value = databaseCatalog.value.databases
  await migrateLegacySnapshot()
  snapshots.value = loadSnapshotsMeta()
})
</script>

<template>
  <!-- Loading overlay -->
  <div v-if="loading" class="loading-overlay">
    <div class="spinner"></div>
    <div class="loading-text">{{ loadingText }}</div>
  </div>

  <!-- Cell viewer modal -->
  <div v-if="showCellViewer" class="modal-overlay" @click="showCellViewer = false">
    <div class="modal-content" @click.stop>
      <div class="cell-viewer-label">{{ cellViewerLabel }}</div>
      <div v-if="cellViewerFormatted" class="cell-viewer-formatted" v-html="cellViewerFormatted"></div>
      <div v-else class="cell-viewer-value">{{ cellViewerValue }}</div>
      <div class="modal-footer">
        <button class="btn btn-sm btn-outline" @click="showCellViewer = false">关闭</button>
      </div>
    </div>
  </div>

  <!-- QR scanner overlay -->
  <div v-if="scannerActive" class="scanner-overlay">
    <div class="scanner-box"></div>
    <div class="scanner-tip">将桌面端二维码放入框内</div>
    <button class="scanner-cancel" @click="stopProxyQrScan">取消扫码</button>
  </div>

  <!-- Header -->
  <div v-if="!fullscreen" class="header">
    <template v-if="currentTable">
      <button class="back-btn" @click="goBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
      </button>
      <h1>{{ currentTable }}</h1>
      <div class="header-actions">
        <button class="theme-toggle" @click="fullscreen = true" title="全屏">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
        </button>
      </div>
    </template>
    <template v-else-if="activeSnapshot">
      <button class="back-btn" @click="goBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
      </button>
      <h1>{{ activeSnapshot.name }}</h1>
      <div class="header-actions">
        <button class="theme-toggle" @click="toggleTheme" :title="isDark ? '切换浅色' : '切换深色'">
          <svg v-if="isDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
      </div>
    </template>
    <template v-else>
      <h1 class="is-app-title" @click="onHeaderTap" style="cursor:pointer">鹰捷数据</h1>
      <span v-if="snapshots.length > 0" class="badge badge-success">{{ snapshots.length }} 个快照</span>
      <div class="header-actions">
        <button class="theme-toggle" @click="toggleTheme" :title="isDark ? '切换浅色' : '切换深色'">
          <svg v-if="isDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
      </div>
    </template>
  </div>

  <!-- Tables tab -->
  <template v-if="currentTab === 'tables'">

    <!-- Table data view -->
    <template v-if="currentTable">
      <!-- Fullscreen mode -->
      <template v-if="fullscreen">
        <div class="fullscreen-table">
          <div class="data-grid-wrapper">
            <table class="data-grid">
              <thead><tr><th v-for="col in tableData.columns" :key="col">{{ col }}</th></tr></thead>
              <tbody>
                <tr v-for="(row, ri) in tableData.rows" :key="ri">
                  <td v-for="col in tableData.columns" :key="col" @click="showCell(col, row)" :title="String(row[col] ?? '')">{{ truncate(row[col]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="tableData.total > tableData.pageSize" class="pagination" style="padding:8px 16px">
            <button class="btn btn-sm btn-outline" :disabled="tableData.page <= 1" @click="loadTablePage(tableData.page - 1)">上一页</button>
            <span class="pagination-info">{{ tableData.page }} / {{ Math.ceil(tableData.total / tableData.pageSize) }}</span>
            <button class="btn btn-sm btn-outline" :disabled="tableData.page * tableData.pageSize >= tableData.total" @click="loadTablePage(tableData.page + 1)">下一页</button>
          </div>
        </div>
        <button class="fullscreen-exit" @click="fullscreen = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>
        </button>
      </template>
      <!-- Normal mode -->
      <template v-else>
        <div class="content">
          <div class="search-box">
            <svg class="search-box-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input v-model="dataSearch" placeholder="搜索当前表..." @keyup.enter="searchInTable" />
          </div>
          <div class="data-stats">{{ tableData.total }} 行 · {{ tableData.columns.length }} 列</div>
          <div class="data-grid-wrapper">
            <table class="data-grid">
              <thead><tr><th v-for="col in tableData.columns" :key="col">{{ col }}</th></tr></thead>
              <tbody>
                <tr v-for="(row, ri) in tableData.rows" :key="ri">
                  <td v-for="col in tableData.columns" :key="col" @click="showCell(col, row)" :title="String(row[col] ?? '')">{{ truncate(row[col]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="tableData.total > tableData.pageSize" class="pagination">
            <button class="btn btn-sm btn-outline" :disabled="tableData.page <= 1" @click="loadTablePage(tableData.page - 1)">上一页</button>
            <span class="pagination-info">{{ tableData.page }} / {{ Math.ceil(tableData.total / tableData.pageSize) }}</span>
            <button class="btn btn-sm btn-outline" :disabled="tableData.page * tableData.pageSize >= tableData.total" @click="loadTablePage(tableData.page + 1)">下一页</button>
          </div>
        </div>
      </template>
    </template>

    <!-- Table list within active snapshot -->
    <template v-else-if="activeSnapshot">
      <div class="content">
        <div class="search-box">
          <svg class="search-box-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input v-model="tableSearch" placeholder="搜索表名、列名、数据..." @input="onSearchInput" />
        </div>

        <!-- Global search results -->
        <template v-if="globalSearchActive">
          <template v-if="searchResults.tableMatches.length > 0">
            <div class="search-section-title">匹配表名 ({{ searchResults.tableMatches.length }})</div>
            <div v-for="m in searchResults.tableMatches" :key="'t-'+m.tableName" class="table-item" @click="openTable(m.tableName)">
              <div class="table-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg></div>
              <div class="table-item-info"><div class="table-item-name">{{ m.tableName }}</div></div>
              <span class="table-item-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>
            </div>
          </template>
          <template v-if="searchResults.columnMatches.length > 0">
            <div class="search-section-title">匹配列名 ({{ searchResults.columnMatches.length }})</div>
            <div v-for="m in searchResults.columnMatches" :key="'c-'+m.tableName" class="table-item" @click="openTable(m.tableName)">
              <div class="table-item-icon" style="background:var(--accent-soft)"><svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg></div>
              <div class="table-item-info"><div class="table-item-name">{{ m.tableName }}</div><div class="table-item-meta">列: {{ m.columns.join(', ') }}</div></div>
              <span class="table-item-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>
            </div>
          </template>
          <template v-if="searchResults.dataMatches.length > 0">
            <div class="search-section-title">匹配数据值 ({{ searchResults.dataMatches.length }})</div>
            <div v-for="m in searchResults.dataMatches" :key="'d-'+m.tableName" class="table-item" @click="openTable(m.tableName)">
              <div class="table-item-icon" style="background:var(--success-soft)"><svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg></div>
              <div class="table-item-info"><div class="table-item-name">{{ m.tableName }}</div><div class="table-item-meta">{{ m.totalHits }} 条命中 · 列: {{ m.hitColumns.slice(0, 3).join(', ') }}{{ m.hitColumns.length > 3 ? '...' : '' }}</div></div>
              <span class="table-item-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>
            </div>
          </template>
          <div v-if="searchResults.tableMatches.length === 0 && searchResults.columnMatches.length === 0 && searchResults.dataMatches.length === 0" class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M8 11h6"/></svg>
            <div class="empty-state-title">没有匹配结果</div>
            <div class="empty-state-text">尝试换个关键词搜索</div>
          </div>
        </template>

        <!-- Normal table list -->
        <template v-if="!globalSearchActive">
          <div v-for="t in filteredTables" :key="t.name" class="table-item" @click="openTable(t.name)">
            <div class="table-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg></div>
            <div class="table-item-info"><div class="table-item-name">{{ t.name }}</div></div>
            <span class="table-item-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>
          </div>
          <div v-if="filteredTables.length === 0" class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M8 11h6"/></svg>
            <div class="empty-state-title">没有匹配的表</div>
            <div class="empty-state-text">尝试换个关键词搜索</div>
          </div>
        </template>
      </div>
    </template>

    <!-- Database list -->
    <template v-else>
      <div class="content">
        <template v-if="databaseCards.length > 0">
          <div v-for="card in databaseCards" :key="card.id" class="snapshot-card" @click="openDatabaseCard(card)">
            <div class="snapshot-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
            </div>
            <div class="snapshot-card-info">
              <div class="snapshot-card-name">
                {{ card.name }}
                <span v-if="card.snapshot?.testMode" class="badge badge-test" style="margin-left:6px;font-size:10px;padding:1px 6px">测试</span>
                <span v-else-if="card.hasSnapshot" class="badge badge-success" style="margin-left:6px;font-size:10px;padding:1px 6px">已快照</span>
                <span v-else class="badge badge-offline" style="margin-left:6px;font-size:10px;padding:1px 6px">需要快照</span>
              </div>
              <div class="snapshot-card-meta">
                <template v-if="card.host">{{ card.host }}:{{ card.port }} · </template>
                <template v-if="card.snapshot">{{ card.snapshot.tableCount }} 张表 · {{ formatTime(card.snapshot.time) }}</template>
                <template v-else>点击后只快照这个数据库</template>
              </div>
            </div>
            <span class="table-item-arrow">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            </span>
          </div>
        </template>
        <div v-else class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg>
          <div class="empty-state-title">还没有数据库列表</div>
          <div class="empty-state-text">请先在「连接」页读取数据库列表</div>
          <div class="empty-state-hint">提示：快速点击标题三下可开启测试模式</div>
        </div>
      </div>
    </template>
  </template>

  <!-- Connect tab -->
  <template v-if="currentTab === 'connect'">
    <div class="content">
      <div class="card">
        <div class="card-title">桌面端绑定</div>
        <div class="settings-info" style="margin-bottom:10px">
          <template v-if="proxyBinding.host">已绑定：<strong>{{ proxyBinding.host }}:{{ proxyBinding.port }}</strong></template>
          <template v-else>请先扫码绑定正在运行的桌面端</template>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-outline" style="flex:1" @click="scanProxyQr">扫码绑定</button>
          <button class="btn btn-sm btn-outline" style="flex:1" @click="showManualProxy = !showManualProxy">手动输入</button>
        </div>
        <div v-if="showManualProxy" style="margin-top:12px">
          <div class="form-group"><label>桌面端地址</label><input v-model="manualProxyText" placeholder="如 192.168.1.23:19527" /></div>
          <button class="btn btn-sm btn-primary" @click="bindManualProxy">保存绑定</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title">MySQL 模板</div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <button
            v-for="tpl in mysqlTemplates"
            :key="tpl.name"
            class="btn btn-sm btn-outline"
            style="flex:1"
            :style="selectedTemplateName === tpl.name ? 'border-color:var(--accent);color:var(--accent)' : ''"
            @click="applyTemplate(tpl.name)"
          >模板 {{ tpl.name }}</button>
        </div>
        <div class="form-group"><label>主机地址</label><input v-model="config.host" placeholder="如 10.0.0.50" /></div>
        <div class="form-group"><label>端口</label><input v-model="config.port" placeholder="3306" /></div>
        <div class="form-group"><label>用户名</label><input v-model="config.user" placeholder="root" /></div>
        <div class="form-group"><label>密码</label><input v-model="config.password" type="password" placeholder="密码" /></div>
      </div>
      <div v-if="error" class="error-msg">{{ error }}</div>
      <button class="btn btn-primary" @click="connectAndFetchDatabases" :disabled="loading">
        {{ loading ? '连接中...' : '连接并读取数据库列表' }}
      </button>
    </div>
  </template>

  <!-- Settings tab -->
  <template v-if="currentTab === 'settings'">
    <div class="content">
      <div class="card">
        <div class="card-title">快照管理</div>
        <template v-if="snapshots.length > 0">
          <div v-for="snap in snapshots" :key="snap.id" class="settings-snapshot-item">
            <div class="settings-snapshot-info">
              <div class="settings-snapshot-dbname">
                {{ snap.name }}
                <span v-if="snap.testMode" class="badge badge-test" style="margin-left:4px;font-size:10px;padding:1px 6px">测试</span>
              </div>
              <div class="settings-snapshot-detail">
                <template v-if="snap.host">{{ snap.host }}:{{ snap.port }}</template>
                · {{ snap.tableCount }} 张表 · {{ formatTime(snap.time) }}
              </div>
            </div>
            <div class="settings-snapshot-actions">
              <button v-if="!snap.testMode && snap.host" class="btn btn-sm btn-outline" @click="refreshSnapshot(snap)" style="margin-right:6px">刷新</button>
              <button class="btn btn-sm btn-danger" @click="deleteSnapshot(snap.id)">删除</button>
            </div>
          </div>
        </template>
        <div v-else class="settings-info">暂无快照数据</div>
      </div>

      <div class="card">
        <div class="card-title">使用说明</div>
        <ol class="settings-steps">
          <li>在「连接」页选择 MySQL 模板</li>
          <li>确认连接信息后点击「连接并读取数据库列表」</li>
          <li>回到「数据」页选择需要查看的数据库</li>
          <li>未快照的数据库会在点击时单独快照</li>
          <li>离开公司后仍可查看已保存快照</li>
        </ol>
      </div>

      <div class="card">
        <div class="card-title">外观</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-outline" style="flex:1" :style="!isDark ? 'border-color:var(--accent);color:var(--accent)' : ''" @click="applyTheme(false)">浅色</button>
          <button class="btn btn-sm btn-outline" style="flex:1" :style="isDark ? 'border-color:var(--accent);color:var(--accent)' : ''" @click="applyTheme(true)">深色</button>
        </div>
      </div>
    </div>
  </template>

  <!-- Tab bar -->
  <div v-if="!fullscreen" class="tab-bar">
    <button class="tab-item" :class="{ active: currentTab === 'tables' }" @click="switchTab('tables')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      <span>数据</span>
    </button>
    <button class="tab-item" :class="{ active: currentTab === 'connect' }" @click="switchTab('connect')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
      <span>连接</span>
    </button>
    <button class="tab-item" :class="{ active: currentTab === 'settings' }" @click="switchTab('settings')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      <span>设置</span>
    </button>
  </div>
</template>
