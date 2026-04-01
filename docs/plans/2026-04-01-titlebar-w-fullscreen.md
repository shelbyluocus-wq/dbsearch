# Titlebar W Fullscreen Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `W` fullscreen work again after clicking the panel titlebar while a table is open.

**Architecture:** Keep the existing `W` shortcut logic intact and fix the root cause by transferring focus away from editable inputs when the user clicks non-interactive titlebar surfaces. Centralize the pointer intent in `panelChrome.js` so the behavior is regression-tested without mounting the full Vue app.

**Tech Stack:** Vue 3, Node test runner, Tauri panel window shell

---

### Task 1: Add a failing regression test

**Files:**
- Modify: `src/panelChrome.test.js`
- Test: `src/panelChrome.test.js`

**Step 1: Write the failing test**

Add a focused unit test for a new helper that returns `true` when a primary-button titlebar click lands on a non-interactive target, and `false` for interactive targets or non-primary buttons.

**Step 2: Run test to verify it fails**

Run: `node --test src/panelChrome.test.js`
Expected: FAIL because the helper is not exported yet.

### Task 2: Implement the minimal focus-transfer fix

**Files:**
- Modify: `src/panelChrome.js`
- Modify: `src/App.vue`
- Test: `src/panelChrome.test.js`

**Step 1: Add the helper**

Export a small pure function from `src/panelChrome.js` that decides whether a titlebar pointerdown should move focus back to the panel shell.

**Step 2: Wire it into the titlebar handlers**

In `src/App.vue`, add a tiny helper that focuses `#appShell`, call it from `panelHeaderPointerDown` and `onPanelTabPointerDown`, and make `#appShell` programmatically focusable with `tabindex="-1"`.

**Step 3: Run tests to verify the fix**

Run: `node --test src/panelChrome.test.js`
Expected: PASS

**Step 4: Run targeted verification**

Run: `git diff -- src/panelChrome.js src/panelChrome.test.js src/App.vue`
Expected: only the titlebar focus fix and test additions are present.
