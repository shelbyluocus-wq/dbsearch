# Mobile QR Proxy Binding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users bind the mobile app to the current desktop proxy by scanning a desktop QR code, then use MySQL templates only for database credentials.

**Architecture:** Add a small desktop UI entry that shows the proxy address and a QR code payload. Add mobile proxy-binding state independent of MySQL templates; mobile connection calls use the saved proxy base URL plus template MySQL config. Keep manual proxy entry as a fallback for emulators and camera failures.

**Tech Stack:** Vue 3, Tauri 2, Capacitor Android, `@capacitor-mlkit/barcode-scanning` for QR scanning, existing `mobile_proxy` on port 9527, existing mobile `api.js` fetch wrapper.

---

### Task 1: Install mobile QR scanning dependency

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

**Step 1: Install dependency**

Run:

```bash
cd mobile && npm install @capacitor-mlkit/barcode-scanning
```

Expected: dependency added to `mobile/package.json` and `mobile/package-lock.json`.

**Step 2: Sync Android plugin**

Run:

```bash
cd mobile && npx cap sync android
```

Expected: Android plugin appears in sync output.

---

### Task 2: Add Android permissions and cleartext support

**Files:**
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`

**Step 1: Add application cleartext flag**

Ensure `<application>` contains:

```xml
android:usesCleartextTraffic="true"
```

**Step 2: Add camera permission**

Under existing permissions add:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

**Step 3: Build check**

Run:

```bash
cd mobile && npm run build
```

Expected: frontend build passes.

---

### Task 3: Clean local MySQL templates

**Files:**
- Modify local ignored files only: `mobile/mysql_model/1.json`, `mobile/mysql_model/2.json`

**Step 1: Remove proxy fields**

Remove `apiHost` and `apiPort` from both template JSON files. Templates should only include MySQL fields such as:

```json
{
  "host": "192.168.1.223",
  "port": 8306,
  "database": "edota_3cfg",
  "user": "root",
  "password": "...",
  "language": "cn"
}
```

**Step 2: Verify ignored status**

Run:

```bash
git -C E:/project/dbsearch status --short -- mobile/mysql_model
```

Expected: no output because `.gitignore` ignores template secrets.

---

### Task 4: Add mobile proxy binding state and UI

**Files:**
- Modify: `mobile/src/App.vue`

**Step 1: Add scanner imports**

Add:

```js
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning'
```

**Step 2: Add proxy binding state**

Add reactive state near config:

```js
const proxyBinding = reactive({ host: '', port: '9527' })
const manualProxyText = ref('')
const showManualProxy = ref(false)
```

Add helpers:

```js
function proxyBaseUrl() {
  return `http://${proxyBinding.host}:${proxyBinding.port || '9527'}`
}

function normalizeProxyInput(value) {
  const raw = String(value || '').trim().replace(/^https?:\/\//, '')
  const [host, port = '9527'] = raw.split(':')
  return { host: host.trim(), port: String(port || '9527').trim() }
}

function saveProxyBinding() {
  localStorage.setItem('dbs-proxy-binding', JSON.stringify(proxyBinding))
}

function loadProxyBinding() {
  try {
    const saved = JSON.parse(localStorage.getItem('dbs-proxy-binding'))
    if (saved?.host) Object.assign(proxyBinding, { host: saved.host, port: String(saved.port || '9527') })
  } catch {}
}

function bindProxyFromPayload(payload) {
  const parsed = typeof payload === 'string' && payload.trim().startsWith('{') ? JSON.parse(payload) : normalizeProxyInput(payload)
  const host = parsed.apiHost || parsed.host
  const port = parsed.apiPort || parsed.port || '9527'
  if (!host) throw new Error('二维码里没有桌面端地址')
  proxyBinding.host = String(host)
  proxyBinding.port = String(port)
  manualProxyText.value = `${proxyBinding.host}:${proxyBinding.port}`
  saveProxyBinding()
}
```

**Step 3: Add scan function**

Add:

```js
async function scanProxyQr() {
  error.value = ''
  try {
    const perm = await BarcodeScanner.requestPermissions()
    if (perm.camera !== 'granted') throw new Error('没有相机权限')
    const result = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] })
    const value = result.barcodes?.[0]?.rawValue
    if (!value) throw new Error('没有识别到二维码')
    bindProxyFromPayload(value)
  } catch (e) {
    error.value = e.message || '扫码失败，请手动输入桌面端地址'
    showManualProxy.value = true
  }
}
```

**Step 4: Add manual binding function**

Add:

```js
function bindManualProxy() {
  try {
    const normalized = normalizeProxyInput(manualProxyText.value)
    if (!normalized.host) throw new Error('请输入桌面端地址')
    proxyBinding.host = normalized.host
    proxyBinding.port = normalized.port
    manualProxyText.value = `${proxyBinding.host}:${proxyBinding.port}`
    saveProxyBinding()
    showManualProxy.value = false
    error.value = ''
  } catch (e) {
    error.value = e.message || '桌面端地址无效'
  }
}
```

**Step 5: Load binding on mount**

Call `loadProxyBinding()` in `onMounted()` before `loadConfig()`.

**Step 6: Update connection flow**

In `connectAndFetchDatabases()`, replace template `apiHost` guard with:

```js
if (!proxyBinding.host) {
  error.value = '请先扫码绑定桌面端'
  return
}
```

Set base URL with:

```js
api.setBaseUrl(proxyBaseUrl())
```

**Step 7: Update Connect tab UI**

Add a card above MySQL templates:

```vue
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
    <div class="form-group"><label>桌面端地址</label><input v-model="manualProxyText" placeholder="如 192.168.1.23:9527" /></div>
    <button class="btn btn-sm btn-primary" @click="bindManualProxy">保存绑定</button>
  </div>
</div>
```

**Step 8: Build check**

Run:

```bash
cd mobile && npm run build
```

Expected: build passes.

---

### Task 5: Add desktop QR code UI

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/App.vue`

**Step 1: Install desktop QR library**

Run:

```bash
npm install qrcode
```

Expected: dependency added.

**Step 2: Add import**

In `src/App.vue`, add:

```js
import QRCode from 'qrcode'
```

**Step 3: Add proxy QR state/helpers**

Add state in `App.vue` near settings/menu state:

```js
const showMobileProxyQr = ref(false)
const mobileProxyQrDataUrl = ref('')
const mobileProxyAddress = ref('')
```

Add function:

```js
async function openMobileProxyQr() {
  const host = await invoke('get_local_ip_address')
  const payload = { type: 'dbscout-mobile-proxy', apiHost: host, apiPort: 9527 }
  mobileProxyAddress.value = `${host}:9527`
  mobileProxyQrDataUrl.value = await QRCode.toDataURL(JSON.stringify(payload), { margin: 1, width: 220 })
  showMobileProxyQr.value = true
}
```

If no existing `get_local_ip_address` command exists, add a Tauri command in Task 6.

**Step 4: Add visible desktop entry**

Add a button in an existing settings/menu area labelled `手机扫码连接`, calling `openMobileProxyQr()`.

**Step 5: Add modal**

Add modal markup:

```vue
<div v-if="showMobileProxyQr" class="modal-overlay" @click="showMobileProxyQr = false">
  <div class="modal-content" @click.stop>
    <h3>手机扫码连接</h3>
    <img :src="mobileProxyQrDataUrl" alt="手机连接二维码" />
    <p>备用地址：{{ mobileProxyAddress }}</p>
    <button @click="showMobileProxyQr = false">关闭</button>
  </div>
</div>
```

Use existing project modal/button classes rather than inventing a new design system.

**Step 6: Desktop build check**

Run:

```bash
npm run build
```

Expected: desktop frontend build passes.

---

### Task 6: Add local IP Tauri command if needed

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json` if command permissions are needed

**Step 1: Check for existing command**

Search:

```bash
grep -R "local_ip\|get_local_ip\|ip_address" -n src-tauri/src src
```

If a suitable command exists, use it and skip this task.

**Step 2: Add command**

Add:

```rust
#[tauri::command]
fn get_local_ip_address() -> Result<String, String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.connect("8.8.8.8:80").map_err(|e| e.to_string())?;
    let addr = socket.local_addr().map_err(|e| e.to_string())?;
    Ok(addr.ip().to_string())
}
```

Register in `tauri::generate_handler![...]`.

**Step 3: Rust check**

Run:

```bash
cd src-tauri && cargo check
```

Expected: command compiles.

---

### Task 7: Rebuild APK

**Files:**
- Output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

**Step 1: Build and sync mobile**

Run:

```bash
cd mobile && npm run build && npx cap sync android
```

Expected: mobile build and Capacitor sync pass.

**Step 2: Build debug APK**

Run:

```bash
cd mobile/android && JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ANDROID_HOME="C:/Users/Administrator/AppData/Local/Android/Sdk" ./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`.

**Step 3: Verify APK exists**

Run:

```bash
ls -lh mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Expected: APK file exists.

---

### Task 8: Final verification

**Files:**
- Inspect: `mobile/src/App.vue`
- Inspect: `src/App.vue`
- Inspect: `src-tauri/src/lib.rs`

**Step 1: Verify no template proxy secrets are tracked**

Run:

```bash
git status --short -- mobile/mysql_model
```

Expected: no output.

**Step 2: Verify builds**

Run:

```bash
cd mobile && npm run build
npm run build
```

Expected: both frontend builds pass.

**Step 3: Manual smoke checklist**

- Desktop shows `手机扫码连接` and a QR code.
- QR payload contains `type`, `apiHost`, and `apiPort`.
- Mobile connection page shows `桌面端绑定` card.
- Scan button opens scanner or fails into manual input.
- Manual input accepts `host:port` and saves binding.
- Without binding, connection shows `请先扫码绑定桌面端`.
- With binding, connection uses saved proxy and template MySQL fields.
