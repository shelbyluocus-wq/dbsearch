# Table Browsing Smoothness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make DB Scout table browsing feel smooth for normal local databases with thousands of rows and a dozen columns.

**Architecture:** Keep the existing table UI and avoid heavy virtualization. Reduce per-scroll reactive work, prevent small tables from entering seamless block loading, and optimize seamless viewport computation for cases where it is still used.

**Tech Stack:** Vue 3 Composition API, Tauri IPC, Node.js built-in test runner.

---

### Task 1: Optimize seamless viewport helpers

**Files:**
- Modify: `src/tableSeamlessScroll.js`
- Test: `src/tableSeamlessScroll.test.js`

**Steps:**
1. Add tests that `buildSeamlessViewport` returns only rows inside the render block window and does not depend on cached blocks outside that window.
2. Update `buildSeamlessViewport` to iterate only `renderFromBlock..renderToBlock` instead of sorting and flattening all cached blocks.
3. Run `node --test src/tableSeamlessScroll.test.js`.

### Task 2: Gate seamless table mode for small tables

**Files:**
- Modify: `src/tableSeamlessScroll.js`
- Modify: `src/App.vue`
- Test: `src/tableSeamlessScroll.test.js`

**Steps:**
1. Add an optional `totalRows` and `minRows` threshold to `shouldUseSeamlessTableView`.
2. Return false below the threshold so normal small tables avoid seamless-scroll computed/block-loading overhead.
3. Pass `tableView.totalRows` from `App.vue` and set the threshold to a conservative value.
4. Run `node --test src/tableSeamlessScroll.test.js`.

### Task 3: Throttle table scroll work to animation frames

**Files:**
- Modify: `src/App.vue`

**Steps:**
1. Replace direct async work in `onTableGridScroll` with a requestAnimationFrame scheduler.
2. Store only the latest scrollTop/clientHeight per frame.
3. Fire `loadVisibleSeamlessBlocks()` without awaiting inside the scroll event path.
4. Ensure pending animation frame is cancelled on unmount if the file already has cleanup hooks.

### Task 4: Verify

**Commands:**
- `node --test src/tableSeamlessScroll.test.js`
- `node --test src/*.test.js`
- If feasible, `npm run build`

**Manual check:**
- Open a normal table with several thousand rows and scroll.
- Confirm table browsing still loads rows and seamless mode still works for larger tables.
