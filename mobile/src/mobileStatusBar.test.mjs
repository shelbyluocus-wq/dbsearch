import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appVue = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
const stylesCss = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const mainActivity = readFileSync(new URL('../android/app/src/main/java/com/dbsearch/mobile/MainActivity.java', import.meta.url), 'utf8')

test('applyTheme syncs native status bar background for light and dark themes', () => {
  assert.match(appVue, /StatusBar\.setBackgroundColor/)
  assert.match(appVue, /statusBarThemeColor\(dark\)/)
  assert.match(appVue, /dark\s*\?\s*'#18181b'\s*:\s*'#ffffff'/)
})

test('mobile header paints behind Android edge-to-edge status bar', () => {
  assert.match(appVue, /StatusBar\.setOverlaysWebView\(\{\s*overlay:\s*true\s*\}\)/)
  assert.match(appVue, /StatusBar\.getInfo\(\)/)
  assert.match(appVue, /--safe-top/)
  assert.match(stylesCss, /--safe-top:\s*0px/)
  assert.match(stylesCss, /--status-bar-height:\s*max\(env\(safe-area-inset-top,\s*0px\),\s*var\(--safe-top\)\)/)
  assert.match(stylesCss, /\.header\s*\{[\s\S]*height:\s*calc\(52px \+ var\(--status-bar-height\)\)/)
})

test('android activity starts with transparent status bar for page-painted header', () => {
  assert.match(mainActivity, /WindowCompat\.setDecorFitsSystemWindows\(getWindow\(\),\s*false\)/)
  assert.match(mainActivity, /getWindow\(\)\.setStatusBarColor\(Color\.TRANSPARENT\)/)
  assert.match(mainActivity, /setAppearanceLightStatusBars\(true\)/)
})
