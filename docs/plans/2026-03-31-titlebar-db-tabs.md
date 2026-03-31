# Titlebar DB Tabs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move database template switching and connection status into the titlebar tab area, and restyle the titlebar tabs to use a text-first hover-reveal interaction.

**Architecture:** Keep the tab data model unchanged and limit behavior changes to presentation and placement. Extract a small pure helper into `panelChrome.js` for titlebar database controls visibility so we can cover the relocation with TDD before changing the Vue template and CSS.

**Tech Stack:** Vue 3, plain CSS, node:test

---

### Task 1: Add a pure visibility helper for titlebar DB controls

**Files:**
- Modify: `src/panelChrome.js`
- Test: `src/panelChrome.test.js`

**Step 1: Write the failing test**

Add tests that assert the titlebar database control group shows when:
- there is a live DB connection
- there are saved DB templates even if disconnected

Add a test that asserts it hides when disconnected and no templates exist.

**Step 2: Run test to verify it fails**

Run: `node --test src/panelChrome.test.js`
Expected: FAIL because the new helper does not exist yet.

**Step 3: Write minimal implementation**

Export a helper such as `shouldShowTitlebarDbSwitcher({ dbConnected, templateCount })` from `src/panelChrome.js`.

**Step 4: Run test to verify it passes**

Run: `node --test src/panelChrome.test.js`
Expected: PASS for the new helper and existing tests.

### Task 2: Move the DB switcher and connection status into the titlebar

**Files:**
- Modify: `src/App.vue`

**Step 1: Update computed usage**

Use the new helper in `App.vue` to compute whether the titlebar DB control group should render.

**Step 2: Update the titlebar template**

Insert a compact DB control group beside the titlebar tab strip, containing:
- previous template button
- current template name
- next template button
- connection status dot
- current DB name

**Step 3: Remove the footer quick-switch block**

Delete the old footer template switcher markup so the feature exists in only one place.

### Task 3: Restyle titlebar tabs to text-first hover-reveal

**Files:**
- Modify: `src/styles.css`

**Step 1: Update base titlebar tab chip styling**

Reduce the default visual weight so tabs read like spaced text instead of rounded chips.

**Step 2: Update hover behavior**

Show background, border, and close affordance only on hover/focus-visible.

**Step 3: Update active state**

Keep the active tab slightly emphasized without returning to the previous bubble style.

**Step 4: Style the new DB control group**

Add layout and button styles that visually align with the titlebar controls and leave the connection state directly beside the DB switcher.

### Task 4: Verify behavior

**Files:**
- Test: `src/panelChrome.test.js`

**Step 1: Run unit tests**

Run: `node --test src/panelChrome.test.js`
Expected: PASS

**Step 2: Run build**

Run: `npm run build`
Expected: successful Vite build
