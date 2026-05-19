# Mobile MySQL Templates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the mobile app connect through built-in MySQL templates, snapshot every database in the selected MySQL instance, and let users switch database snapshots from the main data screen.

**Architecture:** Keep the mobile frontend single-file-heavy by changing `mobile/src/App.vue` only, plus Vite JSON imports for the two checked-in template files. Remove user-facing proxy fields and use the existing API module with its default same-origin base URL. Treat template JSON as a connection preset: use `host`, `port`, `user`, `password`, and use `database` only to prioritize snapshot order and default active snapshot.

**Tech Stack:** Vue 3 Composition API, Vite JSON imports, Capacitor WebView, existing `mobile/src/api.js` fetch wrapper, existing `sql.js` snapshot storage in IndexedDB/localStorage.

---

### Task 1: Add built-in template state and selection

**Files:**
- Modify: `mobile/src/App.vue:1-30`
- Modify: `mobile/src/App.vue:102-111`

**Step 1: Add JSON imports and template list**

Add imports near the existing imports:

```js
import mysqlTemplate1 from '../mysql_model/1.json'
import mysqlTemplate2 from '../mysql_model/2.json'
```

Add a template list after the `config` reactive object:

```js
const mysqlTemplates = [
  { name: '1', config: mysqlTemplate1 },
  { name: '2', config: mysqlTemplate2 },
]
const selectedTemplateName = ref('1')
const preferredDatabase = ref(mysqlTemplate1.database || '')
```

Remove `proxyHost` and `proxyPort` from `config`. Keep only:

```js
const config = reactive({
  host: '',
  port: '3306',
  user: '',
  password: '',
})
```

**Step 2: Add selection function**

Add this function near config storage helpers:

```js
function applyTemplate(name) {
  const template = mysqlTemplates.find(t => t.name === name) || mysqlTemplates[0]
  selectedTemplateName.value = template.name
  config.host = template.config.host || ''
  config.port = String(template.config.port || '3306')
  config.user = template.config.user || ''
  config.password = template.config.password || ''
  preferredDatabase.value = template.config.database || ''
}
```

**Step 3: Update loadConfig initialization**

In `loadConfig()`, after loading any saved config, call `applyTemplate()` if no saved config exists. Preserve saved config if present, but initialize the selected template name from localStorage when available:

```js
function saveConfig() {
  try {
    localStorage.setItem('dbs-config', JSON.stringify(config))
    localStorage.setItem('dbs-template', selectedTemplateName.value)
  } catch {}
}
function loadConfig() {
  try {
    const savedTemplate = localStorage.getItem('dbs-template') || '1'
    const saved = JSON.parse(localStorage.getItem('dbs-config'))
    if (saved) {
      Object.assign(config, saved)
      selectedTemplateName.value = savedTemplate
      const template = mysqlTemplates.find(t => t.name === savedTemplate)
      preferredDatabase.value = template?.config?.database || ''
    } else {
      applyTemplate(savedTemplate)
    }
  } catch {
    applyTemplate('1')
  }
}
```

**Step 4: Manual check**

Run:

```bash
cd mobile && npm run build
```

Expected: Vite accepts JSON imports and the app builds.

---

### Task 2: Snapshot all databases after connecting

**Files:**
- Modify: `mobile/src/App.vue:286-356`

**Step 1: Replace connection guard and remove proxy base URL**

Update `connectAndFetchDatabases()` so it validates only MySQL fields:

```js
if (!config.host || !config.user) {
  error.value = '请选择模板或填写 MySQL 连接信息'
  return
}
```

Remove this line entirely:

```js
api.setBaseUrl(`http://${config.proxyHost}:${config.proxyPort}`)
```

**Step 2: Replace database picker behavior with all-database snapshot flow**

Change `connectAndFetchDatabases()` to call `api.listDatabases(connConfig)`, assign `databases.value`, save config, then call a new helper that snapshots every database:

```js
const result = await api.listDatabases(connConfig)
databases.value = result.databases || []
if (databases.value.length === 0) throw new Error('没有可快照的数据库')
saveConfig()
await snapshotAllDatabases(databases.value)
```

Do not set `showDatabasePicker.value = true`.

**Step 3: Extract one-database snapshot helper**

Replace `takeSnapshot()` with a database-argument helper:

```js
async function takeSnapshot(databaseName, options = {}) {
  if (!databaseName) { error.value = '请先选择一个数据库'; return null }
  const connConfig = { host: config.host, port: parseInt(config.port), user: config.user, password: config.password, database: databaseName }
  loadingText.value = `正在获取 ${databaseName} 的表列表...`
  const tablesResult = await api.getTables(connConfig)
  const tableNames = tablesResult.tables || []
  loadingText.value = `正在快照 ${databaseName} (${tableNames.length} 张表)...`
  await db.openDatabase()
  let completed = 0
  for (const tbl of tableNames) {
    loadingText.value = `快照 ${databaseName} (${++completed}/${tableNames.length}): ${tbl}`
    const schemaResult = await api.getTableSchema(connConfig, tbl)
    if (schemaResult.sql) db.execRaw(schemaResult.sql)
    const rowsResult = await api.getTableRows(connConfig, tbl, 0, 100000)
    if (rowsResult.columns?.length && rowsResult.rows?.length) {
      const cols = rowsResult.columns.map(c => `"${c}"`).join(', ')
      const placeholders = rowsResult.columns.map(() => '?').join(', ')
      const insertSql = `INSERT INTO "${tbl}" (${cols}) VALUES (${placeholders})`
      for (const row of rowsResult.rows) {
        db.exec(insertSql, rowsResult.columns.map(c => row[c] ?? null))
      }
    }
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
```

**Step 4: Add all-database helper**

Add:

```js
async function snapshotAllDatabases(databaseNames) {
  const ordered = [...databaseNames].sort((a, b) => {
    if (a === preferredDatabase.value) return -1
    if (b === preferredDatabase.value) return 1
    return a.localeCompare(b)
  })
  let firstMeta = null
  for (let i = 0; i < ordered.length; i++) {
    loadingText.value = `正在快照数据库 (${i + 1}/${ordered.length}): ${ordered[i]}`
    const meta = await takeSnapshot(ordered[i], { activate: false })
    if (!firstMeta || meta?.database === preferredDatabase.value) firstMeta = meta
  }
  snapshots.value = loadSnapshotsMeta()
  if (firstMeta) await selectSnapshot(firstMeta)
  currentTab.value = 'tables'
}
```

**Step 5: Update database picker call sites**

The old modal click `@click="selectedDatabase = d; takeSnapshot()"` should become `@click="selectedDatabase = d; takeSnapshot(d)"` if keeping the modal for fallback, or the modal can be deleted in Task 3. Keep `selectedDatabase` state if it still supports fallback UI.

**Step 6: Manual check**

Run:

```bash
cd mobile && npm run build
```

Expected: no Vue compile errors; no references to removed `proxyHost`/`proxyPort`.

---

### Task 3: Update the mobile UI for templates and main-screen database switching

**Files:**
- Modify: `mobile/src/App.vue:688-739`
- Modify: `mobile/src/App.vue:768-778`
- Modify: `mobile/src/styles.css` if layout needs minor styling

**Step 1: Add template selector to connect tab**

Replace the old proxy card and MySQL card with one card:

```vue
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
```

Change the button text to:

```vue
{{ loading ? '快照中...' : '连接并快照全部数据库' }}
```

**Step 2: Ensure main data screen already acts as database switcher**

The existing snapshot list at `mobile/src/App.vue:688-717` already shows all snapshots and calls `selectSnapshot(snap)`. Keep this as the main database selection UI. If multiple snapshots from the same host exist, the current `snap.name` is the database name.

**Step 3: Update settings instructions**

Replace steps 1-7 with concise new steps:

```vue
<li>在「连接」页选择 MySQL 模板</li>
<li>确认连接信息后点击「连接并快照全部数据库」</li>
<li>应用会自动快照该 MySQL 下的所有数据库</li>
<li>回到「数据」页选择数据库快照查看</li>
<li>离开公司后仍可查看已保存快照</li>
```

**Step 4: Manual check**

Run:

```bash
cd mobile && npm run build
```

Expected: build passes and the connection page no longer mentions desktop IP or proxy.

---

### Task 4: Verify and review

**Files:**
- Inspect: `mobile/src/App.vue`
- Inspect: `mobile/src/api.js`

**Step 1: Search for removed user-facing proxy wording**

Run:

```bash
grep -R "桌面端\|代理地址\|proxyHost\|proxyPort" -n mobile/src mobile/mysql_model
```

Expected: no user-facing connection UI references remain. `api.js` can keep generic `setBaseUrl()` for future use if unused.

**Step 2: Build mobile app**

Run:

```bash
cd mobile && npm run build
```

Expected: successful Vite production build.

**Step 3: Optional browser smoke test**

Run:

```bash
cd mobile && npm run dev
```

Open the Vite URL, verify:

- The connect tab shows template buttons 1 and 2.
- Selecting each template fills host/port/user/password.
- No desktop IP/proxy fields appear.
- The main data tab still lists snapshots as database choices.

**Step 4: Code review**

Use `superpowers:requesting-code-review` or the available code-review agent to review the mobile changes before reporting completion.
