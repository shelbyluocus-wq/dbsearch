# Pet Drag Run Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the floating Jiedi pet play Codex-style running animations for the full drag gesture.

**Architecture:** Keep state resolution in `src/petAtlas.js` and UI gesture memory in `src/App.vue`. The atlas resolver will always map dragging to a run row, while the Vue window-move listener records the last horizontal direction so brief pauses do not fall back to jump.

**Tech Stack:** Vue 3, Vite, Tauri v2 JavaScript APIs, Node `node:test`.

---

### Task 1: Add the drag-run regression test

**Files:**
- Modify: `src/petAtlas.test.js`

**Step 1: Write the failing test**

Add assertions that `resolvePetState({ dragging: true })` returns `running-right`, and that `resolvePetState({ dragging: true, fallbackDragDirection: "left" })` returns `running-left`.

**Step 2: Run test to verify it fails**

Run: `node --test src/petAtlas.test.js`

Expected: FAIL because dragging without active direction currently resolves to `jumping`.

### Task 2: Implement atlas drag direction fallback

**Files:**
- Modify: `src/petAtlas.js`

**Step 1: Write minimal implementation**

Update `resolvePetState()` to accept `fallbackDragDirection`. During dragging, use `dragDirection` when it is `left` or `right`, then `fallbackDragDirection` when valid, then default to `running-right`.

**Step 2: Run focused test**

Run: `node --test src/petAtlas.test.js`

Expected: PASS.

### Task 3: Keep last drag facing in the pet window

**Files:**
- Modify: `src/App.vue`

**Step 1: Wire fallback direction**

Add a `petDragFacing` ref initialized to `right`. Pass it to `resolvePetState()` as `fallbackDragDirection` while dragging.

**Step 2: Update facing on movement**

When `onMoved` detects horizontal movement, set both `petDragDirection` and `petDragFacing` to `left` or `right`. On drag end, clear the transient direction but keep the facing for the next drag.

### Task 4: Verify

Run:

```bash
node --test src/petAtlas.test.js
npm run build
```

Expected: both commands exit successfully.
