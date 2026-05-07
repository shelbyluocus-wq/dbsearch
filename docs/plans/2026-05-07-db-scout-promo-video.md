# DB Scout Promo Video Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a 15-second 1920×1080 Apple Keynote-style promotional video for DB Scout focused on MySQL search capability.

**Architecture:** Create a self-contained HTML motion piece under `promo/db-scout-search-video/`, capture real product UI if possible, otherwise use a faithful product-frame recreation informed by current UI text and assets. Export an MP4 with BGM/SFX and no Huashu watermark per user instruction.

**Tech Stack:** HTML/CSS/vanilla JavaScript animation, Chrome/Playwright-style browser verification, ffmpeg for audio/video muxing if available.

---

### Task 1: Prepare assets and references

**Files:**
- Create: `promo/db-scout-search-video/`
- Read/use: `src-tauri/icons/icon.png`
- Read/use: `public/spirit_ref_px.png`, `public/lion_ref_px.png`
- Read/use: `src/App.vue`

**Steps:**
1. Create the promo directory.
2. Copy only the needed project assets into `promo/db-scout-search-video/assets/`.
3. Inspect UI strings around search, result tabs, and panel layout in `src/App.vue`.
4. If the app can run quickly, start `npm run dev` or `npm run tauri dev` and capture real UI screenshots; if not, use a faithful HTML product-frame recreation.

### Task 2: Build animation HTML

**Files:**
- Create: `promo/db-scout-search-video/index.html`

**Steps:**
1. Implement a 1920×1080 fixed stage with automatic scale for browser preview.
2. Use Apple-style restrained motion: black/silver background, large typography, slow depth transforms, no clutter.
3. Timeline:
   - 0–3s: icon/pet reveal and English tagline.
   - 3–7s: product panel reveal and keyword typing.
   - 7–11s: table/column/data result layers slide in.
   - 11–15s: final product card and Chinese/English product title.
4. Add `window.__ready = true` after the first render tick and honor `window.__recording === true` by disabling looping.
5. Do not include watermark.

### Task 3: Verify in browser

**Files:**
- Verify: `promo/db-scout-search-video/index.html`

**Steps:**
1. Open the HTML in Chrome DevTools.
2. Check console errors.
3. Capture a screenshot around the most information-dense moment.
4. Adjust layout if text overflows or UI is illegible.

### Task 4: Export video with audio

**Files:**
- Create: `promo/db-scout-search-video/render-video.js` if needed
- Create: `promo/db-scout-search-video/db-scout-search-promo.mp4`

**Steps:**
1. Use Playwright/Chrome frame capture or available project scripts to render a 15s MP4.
2. Add minimal Apple-style BGM and soft SFX if local audio assets/tools are available.
3. Confirm the final MP4 exists and has an audio stream when audio tools are available.
4. If video export tooling is unavailable, leave the verified HTML animation and explain the exact command needed to export.

### Task 5: Final verification

**Files:**
- Verify: `promo/db-scout-search-video/index.html`
- Verify: `promo/db-scout-search-video/db-scout-search-promo.mp4` if exported

**Steps:**
1. Reopen the final HTML and inspect the final timeline.
2. Confirm no watermark is present.
3. Confirm the output path and caveats.
