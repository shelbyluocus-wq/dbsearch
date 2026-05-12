# Table Block Cache Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reuse table page/block data already loaded in the current app session to reduce repeated Tauri IPC and database reads during table browsing.

**Architecture:** Add a small frontend-only in-memory cache keyed by connection identity, table name, page, and page size. `App.vue` reads from the cache before invoking `get_table_data`, stores successful payloads after loading, and clears cache on schema refresh, disconnect/connect reloads, edit saves, and explicit table reloads.

**Tech Stack:** Vue 3 Composition API, Tauri IPC, Node.js built-in test runner.

---

### Task 1: Create table cache helper

**Files:**
- Create: `src/tableDataCache.js`
- Test: `src/tableDataCache.test.js`

**Step 1: Write failing tests**

Cover:
- Builds stable cache keys from connection id, table name, page, page size.
- Returns cloned payloads so callers cannot mutate cached rows.
- Evicts all entries for a connection/table.
- Enforces a small max-entry LRU limit.

**Step 2: Run test to verify it fails**

Run: `node --test src/tableDataCache.test.js`
Expected: fails because `src/tableDataCache.js` does not exist.

**Step 3: Implement minimal helper**

Export:
- `createTableDataCache({ maxEntries = 80 } = {})`
- methods: `get(keyParts)`, `set(keyParts, payload)`, `clear()`, `clearTable(keyParts)`, `size()`
- use `structuredClone` when available, JSON clone fallback otherwise.

**Step 4: Run test to verify it passes**

Run: `node --test src/tableDataCache.test.js`
Expected: all tests pass.

### Task 2: Wire cache into table loading

**Files:**
- Modify: `src/App.vue`
- Test: `src/tableDataCache.test.js`

**Step 1: Write App.vue integration assertions**

Add tests that `App.vue` imports `createTableDataCache`, reads cache before `invoke("get_table_data")`, stores loaded payloads, and clears cache around `save_table_changes`/schema refresh paths.

**Step 2: Run test to verify it fails**

Run: `node --test src/tableDataCache.test.js`
Expected: App.vue assertions fail.

**Step 3: Implement minimal integration**

- Create a module-scope cache instance in `App.vue`.
- Add helper `getTableCacheConnectionKey()` using current DB template/host/database info available in config/runtime state; fallback to `"offline-demo"`.
- In `loadTablePage`, check cache before invoking backend; store fresh payload after invoke.
- In `loadSeamlessTableBlock`, check/cache blocks with `pageSize: SEAMLESS_TABLE_BLOCK_SIZE`.
- Clear cache after `save_table_changes`, `refresh_schema`, connect/disconnect, and explicit table close/reload paths if easily identifiable.

**Step 4: Run tests**

Run: `node --test src/tableDataCache.test.js src/tableSeamlessScroll.test.js`
Expected: pass.

### Task 3: Verify full frontend

**Commands:**
- `node --test src/*.test.js`
- `npm run build`

**Manual check:**
- Open a 2000-row table.
- Scroll down, then back up; previously loaded regions should feel more responsive.
- Switch away and back to the same table; loaded pages should reuse cache until refresh/edit/connect changes.
