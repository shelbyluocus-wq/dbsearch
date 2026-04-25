import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appVueSource = fs.readFileSync(new URL("./App.vue", import.meta.url), "utf8");
const dbMigrationWorkspaceSource = fs.readFileSync(
  new URL("./DbMigrationWorkspace.vue", import.meta.url),
  "utf8",
);
const tauriDefaultCapabilitySource = fs.readFileSync(
  new URL("../src-tauri/capabilities/default.json", import.meta.url),
  "utf8",
);

function slicePetMenuMarkup() {
  const start = appVueSource.indexOf('<div v-else-if="isMenuWindow" class="pet-menu-root">');
  const end = appVueSource.indexOf('<div v-if="resultZoomOpen"', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return appVueSource.slice(start, end);
}

function sliceSyncWorkspaceMarkup() {
  const start = appVueSource.indexOf('v-else-if="isSyncWorkspaceWindow"');
  const end = appVueSource.indexOf('<DbMigrationWorkspace v-else-if="isDbMigrationWorkspaceWindow"', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return appVueSource.slice(start, end);
}

test("pet menu exposes one sync center entry instead of separate sync entries", () => {
  const petMenuMarkup = slicePetMenuMarkup();

  assert.match(petMenuMarkup, /contextAction\('sync_center'\)/);
  assert.match(petMenuMarkup, />同步中心</);
  assert.doesNotMatch(petMenuMarkup, /contextAction\('file_sync'\)/);
  assert.doesNotMatch(petMenuMarkup, /contextAction\('db_sync'\)/);
  assert.doesNotMatch(petMenuMarkup, />文件同步</);
  assert.doesNotMatch(petMenuMarkup, />数据库同步</);
});

test("sync workspace switches modes only from the left sidebar", () => {
  const syncWorkspaceMarkup = sliceSyncWorkspaceMarkup();

  assert.doesNotMatch(syncWorkspaceMarkup, /sync-center-mode-tabs/);
  assert.doesNotMatch(syncWorkspaceMarkup, /sync-center-weather-switch/);
  assert.doesNotMatch(syncWorkspaceMarkup, />搜索任务</);
  assert.match(syncWorkspaceMarkup, /sync-center-sidebar-chrome[\s\S]*traffic-lights/);
  assert.match(syncWorkspaceMarkup, /toggleSyncCenterSection\('database'\)/);
  assert.match(syncWorkspaceMarkup, /toggleSyncCenterSection\('file'\)/);
  assert.match(syncWorkspaceMarkup, /sync-center-log-drawer/);
  assert.match(syncWorkspaceMarkup, /<DbMigrationWorkspace[\s\S]*?\bfile-sync-summary\b/);
  assert.doesNotMatch(syncWorkspaceMarkup, /<details[^>]+class="sw-log-details"/);
});

test("embedded database workspace offers the sync-config sidebar switch", () => {
  assert.match(dbMigrationWorkspaceSource, /defineEmits\(\[[^\]]*"switch-mode"/);
  assert.match(dbMigrationWorkspaceSource, /fileSyncSummary/);
  assert.match(dbMigrationWorkspaceSource, /sync-center-sidebar-chrome[\s\S]*traffic-lights/);
  assert.match(dbMigrationWorkspaceSource, /emit\(['"]switch-mode['"], ['"]file['"]\)/);
  assert.doesNotMatch(dbMigrationWorkspaceSource, />搜索任务</);
});
test("sync center sidebar exposes only the transfer and database sync sections with inline add actions", () => {
  const syncWorkspaceMarkup = sliceSyncWorkspaceMarkup();

  assert.match(syncWorkspaceMarkup, /'sync-center-sidebar-section', 'is-transfer'/);
  assert.match(syncWorkspaceMarkup, /'sync-center-sidebar-section', 'is-database-sync'/);
  assert.match(syncWorkspaceMarkup, /addDbMigrationProfileFromSyncCenter/);
  assert.match(syncWorkspaceMarkup, /addSyncProfileFromSyncCenter/);
});

test("sync center keeps logs in the right drawer and falls back to execution steps", () => {
  const syncWorkspaceMarkup = sliceSyncWorkspaceMarkup();

  assert.match(syncWorkspaceMarkup, /sync-center-log-drawer/);
  assert.match(syncWorkspaceMarkup, /syncCenterActiveFallbackSteps/);
  assert.match(syncWorkspaceMarkup, /sync-center-log-steps/);
  assert.doesNotMatch(syncWorkspaceMarkup, /class="sw-pipeline"/);
});

test("sync center frameless window has drag and resize hit areas", () => {
  const syncWorkspaceMarkup = sliceSyncWorkspaceMarkup();

  assert.match(syncWorkspaceMarkup, /sync-center-drag-strip/);
  assert.match(syncWorkspaceMarkup, /startSyncCenterResize/);
  assert.match(syncWorkspaceMarkup, /sync-center-resize-handle is-se/);
  assert.match(tauriDefaultCapabilitySource, /core:window:allow-start-resize-dragging/);
});

test("embedded database workspace can hide its own sidebar and report sidebar state", () => {
  assert.match(dbMigrationWorkspaceSource, /hideSidebar/);
  assert.match(dbMigrationWorkspaceSource, /"sidebar-state"/);
  assert.match(dbMigrationWorkspaceSource, /v-if="!hideSidebar"/);
  assert.match(dbMigrationWorkspaceSource, /defineExpose\(\{[\s\S]*activateProfile/);
});

test("sync center uses one stable resizable sidebar for both modes", () => {
  const syncWorkspaceMarkup = sliceSyncWorkspaceMarkup();

  assert.match(syncWorkspaceMarkup, /sync-center-sidebar-shell/);
  assert.match(syncWorkspaceMarkup, /sync-center-sidebar-resizer/);
  assert.match(syncWorkspaceMarkup, /startSyncCenterSidebarResize/);
  assert.match(syncWorkspaceMarkup, /--sync-center-sidebar-width/);
  assert.match(syncWorkspaceMarkup, /<DbMigrationWorkspace[\s\S]*?\bhide-sidebar\b/);
  assert.match(syncWorkspaceMarkup, /toggleSyncCenterSection\('database'\)/);
  assert.match(syncWorkspaceMarkup, /toggleSyncCenterSection\('file'\)/);
});

test("sync center background is a static wallpaper without weather animation layers", () => {
  const syncWorkspaceMarkup = sliceSyncWorkspaceMarkup();

  assert.doesNotMatch(syncWorkspaceMarkup, /data-sync-weather/);
  assert.doesNotMatch(syncWorkspaceMarkup, /sync-center-weather-flow/);
  assert.doesNotMatch(syncWorkspaceMarkup, /sync-center-weather-clouds/);
  assert.doesNotMatch(syncWorkspaceMarkup, /sync-center-weather-rain/);
  assert.doesNotMatch(syncWorkspaceMarkup, /sync-center-weather-snow/);
  assert.match(syncWorkspaceMarkup, /sync-center-wallpaper/);
});
