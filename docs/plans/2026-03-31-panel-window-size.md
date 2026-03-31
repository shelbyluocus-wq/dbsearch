# Panel Window Size Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Save the current main search panel size and use it as the default size the next time the panel window opens.

**Architecture:** Mirror the existing db migration window size flow in `src-tauri/src/lib.rs`. Store a config-backed optional panel size, sanitize it against minimum dimensions, debounce resize persistence, and restore the remembered logical size when building the panel window.

**Tech Stack:** Tauri 2, Rust, serde, tokio test support, cargo test

---

### Task 1: Add failing tests for panel size helpers

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Write the failing test**

Add unit tests for:
- panel size sanitization clamps to the panel minimum size
- panel size resolution reads the cached remembered size

**Step 2: Run test to verify it fails**

Run: `cargo test panel_window_size --manifest-path src-tauri/Cargo.toml`
Expected: FAIL because the helper types and functions do not exist yet.

**Step 3: Write minimal implementation**

Add the new type and helper functions required by the tests.

**Step 4: Run test to verify it passes**

Run: `cargo test panel_window_size --manifest-path src-tauri/Cargo.toml`
Expected: PASS

### Task 2: Wire panel size persistence into config and runtime state

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Write the failing test**

Covered by Task 1 helper tests.

**Step 2: Run test to verify it fails**

Use the Task 1 red step before adding persistence wiring.

**Step 3: Write minimal implementation**

Add:
- config field under `PersonalConfig`
- `AppState` cache and resize sequence fields
- startup config hydration for the new remembered size

**Step 4: Run test to verify it still passes**

Run: `cargo test panel_window_size --manifest-path src-tauri/Cargo.toml`
Expected: PASS

### Task 3: Persist and restore the main panel size

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Write the failing test**

Covered by the helper tests and restore helper expectations.

**Step 2: Run test to verify it fails**

Use the Task 1 red step before hooking the window builder and resize events.

**Step 3: Write minimal implementation**

Update panel window creation to:
- restore remembered size when creating the panel
- save normal resize events with debounce
- skip persistence while maximized

**Step 4: Run test to verify it passes**

Run: `cargo test panel_window_size --manifest-path src-tauri/Cargo.toml`
Expected: PASS

### Task 4: Final verification

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Run focused Rust verification**

Run: `cargo test panel_window_size --manifest-path src-tauri/Cargo.toml`
Expected: PASS

**Step 2: Run broader Rust verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

**Step 3: Run frontend build regression check**

Run: `npm run build`
Expected: PASS
