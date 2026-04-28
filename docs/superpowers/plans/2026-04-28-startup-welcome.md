# Startup Welcome Handwriting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable center-screen handwriting welcome animation that appears on every fresh application launch.

**Architecture:** A new Tauri `welcome` window is created at startup and closes after the Vue welcome view finishes its animation. The Vue app branches on `windowLabel === "welcome"` and renders a focused SVG handwriting scene. A pure helper normalizes the configured welcome text for persistence and rendering.

**Tech Stack:** Tauri 2, Vue 3 Composition API, CSS/SVG animation, Node built-in test runner, Rust unit tests.

---

### Task 1: Welcome Text Normalization

**Files:**
- Create: `src/startupWelcome.js`
- Create: `src/startupWelcome.test.js`
- Modify: `src/App.vue`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing JS tests**

Create tests for default fallback, whitespace trimming, and max-length truncation:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STARTUP_WELCOME_TEXT,
  normalizeStartupWelcomeText,
} from "./startupWelcome.js";

test("normalizeStartupWelcomeText falls back to Louis for blank values", () => {
  assert.equal(DEFAULT_STARTUP_WELCOME_TEXT, "Louis");
  assert.equal(normalizeStartupWelcomeText(""), "Louis");
  assert.equal(normalizeStartupWelcomeText("   "), "Louis");
  assert.equal(normalizeStartupWelcomeText(null), "Louis");
});

test("normalizeStartupWelcomeText trims configured text", () => {
  assert.equal(normalizeStartupWelcomeText("  Shelby Louis  "), "Shelby Louis");
});

test("normalizeStartupWelcomeText truncates long welcome text", () => {
  assert.equal(normalizeStartupWelcomeText("abcdefghijklmnop"), "abcdefghijkl");
});
```

- [ ] **Step 2: Verify JS tests fail**

Run: `node --test src/startupWelcome.test.js`

Expected: fail because `src/startupWelcome.js` does not exist yet.

- [ ] **Step 3: Implement helper**

Export `DEFAULT_STARTUP_WELCOME_TEXT = "Louis"` and `normalizeStartupWelcomeText(value, maxLength = 12)`.

- [ ] **Step 4: Verify JS tests pass**

Run: `node --test src/startupWelcome.test.js`

Expected: all tests pass.

### Task 2: Rust Config and Startup Window

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add failing Rust test**

Add a unit test asserting `PersonalConfig::default().startup_welcome_text == "Louis"`.

- [ ] **Step 2: Verify Rust test fails**

Run: `cargo test startup_welcome --manifest-path src-tauri/Cargo.toml`

Expected: fail because the field does not exist.

- [ ] **Step 3: Add config field and default**

Add `startup_welcome_text: String` to `PersonalConfig` with `#[serde(default = "default_startup_welcome_text")]`, define `default_startup_welcome_text() -> String`, and set it in `Default`.

- [ ] **Step 4: Add the welcome window**

Add `WELCOME_WINDOW_LABEL`, welcome window dimensions, `ensure_welcome_window`, and call it during setup after config is loaded. The window should be centered, transparent, borderless, always on top, skipped from taskbar, and visible at startup.

- [ ] **Step 5: Verify Rust test passes**

Run: `cargo test startup_welcome --manifest-path src-tauri/Cargo.toml`

Expected: test passes.

### Task 3: Vue Welcome View and Settings

**Files:**
- Modify: `src/App.vue`
- Modify: `src/styles.css`

- [ ] **Step 1: Wire helper into config and settings draft**

Import `normalizeStartupWelcomeText`, add `startup_welcome_text` to the reactive config, add `startupWelcomeText` to `settingsDraft`, normalize after load, copy into draft on settings open, and save it in `saveSettings`.

- [ ] **Step 2: Render the welcome branch**

Add `isWelcomeWindow`, render a welcome root before panel/pet branches, and call `getCurrentWindow().close()` after the animation timeout.

- [ ] **Step 3: Add the settings input**

Add a "启动欢迎文字" input in the system settings area.

- [ ] **Step 4: Add CSS animation**

Style `.welcome-root`, `.welcome-word`, and SVG strokes with dash animation, soft glow, and fade-out.

- [ ] **Step 5: Verify full frontend behavior compiles**

Run: `npm run build`

Expected: build exits 0.

### Task 4: Final Verification

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run focused frontend tests**

Run: `node --test src/startupWelcome.test.js`

Expected: pass.

- [ ] **Step 2: Run Rust focused test**

Run: `cargo test startup_welcome --manifest-path src-tauri/Cargo.toml`

Expected: pass.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: pass.
