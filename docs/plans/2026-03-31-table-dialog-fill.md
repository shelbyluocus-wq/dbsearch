# Table Dialog Fill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the table dialog fill the panel window, remove the visible corner shadow, and keep the layout responsive to host window resizing.

**Architecture:** Add a small presentation helper in `panelChrome.js` to describe whether the table dialog should fill the host window and whether the backdrop should be muted. Wire that helper into `App.vue` so the template emits explicit classes, then update `styles.css` to apply the host-fill surface treatment without changing the inner table layout logic.

**Tech Stack:** Vue 3, Vite, Tauri, node:test

---

### Task 1: Add a failing regression test for table dialog presentation

**Files:**
- Modify: `src/panelChrome.test.js`
- Modify: `src/panelChrome.js`

**Step 1: Write the failing test**

Add tests for a new helper that returns host-fill and backdrop behavior for panel vs non-panel contexts.

**Step 2: Run test to verify it fails**

Run: `node --test src/panelChrome.test.js`
Expected: FAIL because the new helper is not exported yet.

**Step 3: Write minimal implementation**

Add the helper to `src/panelChrome.js` and export it.

**Step 4: Run test to verify it passes**

Run: `node --test src/panelChrome.test.js`
Expected: PASS

### Task 2: Apply host-fill classes in the table dialog template

**Files:**
- Modify: `src/App.vue`

**Step 1: Write the failing test**

Covered by Task 1 helper test.

**Step 2: Run test to verify it fails**

Use the Task 1 failure as the red step before wiring the template.

**Step 3: Write minimal implementation**

Import the helper, create a computed presentation state, and apply dialog mask/surface classes from that state.

**Step 4: Run test to verify it still passes**

Run: `node --test src/panelChrome.test.js`
Expected: PASS

### Task 3: Update CSS for host-fill presentation

**Files:**
- Modify: `src/styles.css`

**Step 1: Write the failing test**

Covered by Task 1 helper test because the CSS classes depend on the new helper behavior.

**Step 2: Run test to verify it fails**

Use the Task 1 failure as the red step before adding CSS.

**Step 3: Write minimal implementation**

Add host-fill dialog mask and table modal rules that:
- remove the backdrop
- stretch the dialog to the full host window
- remove the outer shadow that leaks through the rounded corners
- keep the existing inner table content layout intact

**Step 4: Run test to verify it passes**

Run: `node --test src/panelChrome.test.js`
Expected: PASS

### Task 4: Final verification

**Files:**
- Modify: `src/panelChrome.test.js`
- Modify: `src/panelChrome.js`
- Modify: `src/App.vue`
- Modify: `src/styles.css`

**Step 1: Run focused verification**

Run: `node --test src/panelChrome.test.js`
Expected: PASS with 0 failures.

**Step 2: Review diff**

Run: `git diff -- src/panelChrome.js src/panelChrome.test.js src/App.vue src/styles.css`
Expected: Only the helper, template wiring, and host-fill CSS changes.
