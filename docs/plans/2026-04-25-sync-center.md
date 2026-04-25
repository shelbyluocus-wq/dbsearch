# Sync Center Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a single sync center entry and page that switches between file sync and database sync, with a right-side log drawer and quality-first weather background.

**Architecture:** Keep `sync_workspace` as the only visible entry window. Add small pure helpers for tab, drawer, and weather state, then wire `App.vue`, `DbMigrationWorkspace.vue`, and `petMenu.js` around those helpers. CSS owns the weather and drawer presentation so behavior stays testable.

**Tech Stack:** Vue 3, Vite, Tauri v2, Node test runner, Rust backend compatibility commands.

---

### Task 1: Sync Center State Helpers

**Files:**
- Create: `src/syncCenter.js`
- Create or modify: `src/syncCenter.test.js`

**Steps:**
1. Write failing tests for tab normalization, drawer visibility, and weather theme normalization.
2. Run `node --test src/syncCenter.test.js` and confirm failures reference missing exports.
3. Implement minimal helpers in `src/syncCenter.js`.
4. Re-run `node --test src/syncCenter.test.js`.

### Task 2: Single Menu Entry

**Files:**
- Modify: `src/petMenu.js`
- Modify: `src/petMenu.test.js`
- Modify: `src/App.vue`

**Steps:**
1. Update tests so `sync_center`, `file_sync`, and `db_sync` all invoke `toggle_sync_workspace_window`; visible template has only one sync-center button.
2. Run `node --test src/petMenu.test.js` and confirm the old database command expectation fails.
3. Update `runPetMenuAction` and the menu template.
4. Re-run `node --test src/petMenu.test.js`.

### Task 3: Embed Database Workspace

**Files:**
- Modify: `src/App.vue`
- Modify: `src/DbMigrationWorkspace.vue`

**Steps:**
1. Add an `embedded` prop to hide the database workspace toolbar and inline log details.
2. Emit database log state to the parent when embedded.
3. Add the sync-center segmented switch and render either the file sync surface or embedded database surface.
4. Keep standalone database rendering available for legacy backend calls.

### Task 4: Log Drawer

**Files:**
- Modify: `src/App.vue`
- Modify: `src/styles.css`

**Steps:**
1. Compute active log entries from the selected sync-center tab.
2. Show the drawer when manually opened or when the active workspace is running.
3. Hide inline file-sync logs in the unified page.
4. Style the drawer as a right-side layout column that compresses the main workspace.

### Task 5: Weather Visuals

**Files:**
- Modify: `src/App.vue`
- Modify: `src/styles.css`

**Steps:**
1. Add four weather theme buttons in the sync-center toolbar.
2. Implement a separate animated background layer with reduced-motion fallback.
3. Evaluate visually after build; if the motion looks noisy, disable animation while preserving the theme backgrounds.

### Task 6: Verification

**Files:**
- Test: `src/*.test.js`
- Build: project root

**Steps:**
1. Run focused Node tests for sync center, pet menu, file sync, and database sync helpers.
2. Run `npm run build`.
3. Start Vite if needed for visual QA and inspect the unified page.
