# Stable Install Name Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the Windows install directory and shortcut name stable as `鹰捷` while still showing a versioned window title like `鹰捷V4.5.0`.

**Architecture:** Split app identity into two concepts: a stable install name used by Tauri `productName`, and a versioned display title used by the app window UI. Update the release script so `release:prepare` only refreshes the display title, not the installer identity.

**Tech Stack:** PowerShell release tooling, Tauri config JSON, Vue app title helpers, Node test runner.

---

### Task 1: Lock behavior with failing tests

**Files:**
- Modify: `E:\project\dbsearch\src\appIdentity.test.js`
- Modify: `E:\project\dbsearch\scripts\release.test.mjs`

**Step 1: Write the failing test**

Add tests that require:
- `APP_INSTALL_NAME` to stay `鹰捷`
- `formatAppDisplayTitle("4.5.0")` to return `鹰捷V4.5.0`
- `release.ps1` to write `productName = 鹰捷` while updating window titles to `鹰捷Vx.y.z`

**Step 2: Run test to verify it fails**

Run: `node --test src/appIdentity.test.js scripts/release.test.mjs`

Expected: FAIL because the current implementation still versions `productName`.

### Task 2: Implement stable installer identity

**Files:**
- Modify: `E:\project\dbsearch\src\appIdentity.js`
- Modify: `E:\project\dbsearch\scripts\release.ps1`
- Modify: `E:\project\dbsearch\src-tauri\tauri.conf.json`

**Step 1: Write minimal implementation**

Update the identity helpers and release script so:
- `productName` is always the stable install name
- window titles stay versioned

**Step 2: Run targeted tests**

Run: `node --test src/appIdentity.test.js scripts/release.test.mjs`

Expected: PASS

### Task 3: Verify and document

**Files:**
- Modify: `E:\project\dbsearch\README.md`

**Step 1: Update docs**

Document that `release:prepare` keeps the install name stable and only updates the visible version title.

**Step 2: Run verification**

Run:
- `node --test src/appIdentity.test.js scripts/release.test.mjs`
- `npm run build`

Expected: PASS
