# Tauri Dev Cleanup Wrapper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep `npm run tauri dev` unchanged for the user while automatically terminating stale `tauri-app.exe` processes from this project before launching Tauri.

**Architecture:** Replace the direct `tauri` npm script with a small Node wrapper that forwards all CLI arguments to the local Tauri binary. When the forwarded command is `dev`, the wrapper will inspect running Windows processes, stop only the ones whose executable path matches this workspace's `src-tauri\target\debug\tauri-app.exe`, then continue startup.

**Tech Stack:** Node.js ESM, built-in `node:test`, PowerShell process inspection, npm scripts, Tauri CLI.

---

### Task 1: Lock expected behavior with tests

**Files:**
- Create: `scripts/tauri-wrapper.test.mjs`
- Create: `scripts/tauri-wrapper-utils.mjs`

**Step 1: Write the failing test**

Create tests for:
- detecting when cleanup should run (`dev` only)
- building the expected target exe path from the repo root
- filtering process records so only this project's `tauri-app.exe` instances are terminated

**Step 2: Run test to verify it fails**

Run: `node --test scripts/tauri-wrapper.test.mjs`
Expected: FAIL because `scripts/tauri-wrapper-utils.mjs` does not exist yet.

**Step 3: Write minimal implementation**

Add utility functions that:
- detect `dev` invocation
- normalize Windows paths case-insensitively
- identify matching process records

**Step 4: Run test to verify it passes**

Run: `node --test scripts/tauri-wrapper.test.mjs`
Expected: PASS

### Task 2: Add runtime wrapper and wire npm

**Files:**
- Create: `scripts/run-tauri.mjs`
- Modify: `package.json`

**Step 1: Write the failing runtime verification**

Run the wrapper in a harmless mode such as `info` or `--help` after wiring it, and confirm the command path/argument forwarding works.

**Step 2: Write minimal implementation**

Implement a wrapper that:
- reads forwarded npm args
- runs cleanup only for `dev`
- spawns `node_modules/.bin/tauri.cmd` on Windows with inherited stdio
- exits with the child process status

**Step 3: Run verification**

Run:
- `node --test scripts/tauri-wrapper.test.mjs`
- `node scripts/run-tauri.mjs --help`

Expected:
- tests PASS
- help command exits successfully

### Task 3: Verify real project behavior

**Files:**
- Modify: `package.json`

**Step 1: Verify build/start path still works**

Run: `npm run tauri -- --help`
Expected: Tauri CLI help output and exit code 0.

**Step 2: Verify dev cleanup path**

Run: `npm run tauri dev`
Expected: if a stale `tauri-app.exe` exists for this repo, it is terminated before Tauri starts; otherwise startup proceeds without error.
