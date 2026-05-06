# Art Text Search (美术字搜索) — Design Document

## Context

The user has thousands of art-text (美术字) image files (PNG/JPG) across multiple directories in their art project. Files are named by numeric IDs, not by the text content they contain. Finding a specific art-text image requires manually browsing through folders — this feature adds OCR-powered text search over these images.

## Approach

Use `oar-ocr` (PaddleOCR v5, ONNX Runtime) for local, offline Chinese text recognition. Build an index on first use, then search against the cached index for instant results.

## Architecture

### Storage

- **Index file**: `art_text_index.json` in Tauri app data directory (same level as `config.json`)
  - Structure: `{ version: 1, entries: [{ text, path, fileName, lastModified }], errors: [{ path, reason }], builtAt }`
- **Scan directories**: Stored in `AppConfig.personal.artTextSearchDirs: string[]`

### New Tauri Window

- Label: `art_text_search`
- Size: 620×520
- Created dynamically from pet menu (same pattern as sync_workspace)

### New Tauri Commands (in `lib.rs`)

| Command | Description |
|---|---|
| `get_art_text_search_dirs` | Read configured scan directories |
| `save_art_text_search_dirs` | Save scan directories to config |
| `build_art_text_index` | Scan directories, OCR images, build/update index. Emits `art-text-index-progress` events |
| `search_art_text` | Fuzzy-match input text against index, return results |
| `open_file_in_explorer` | Open Explorer and select a specific file (not just directory) |

### New Rust Dependency

```toml
# src-tauri/Cargo.toml
oar-ocr = { version = "0.6", features = ["directml"] }
```

- Models: PaddleOCR v5 mobile det + rec (~20 MB), downloaded on first launch or bundled
- GPU: DirectML on Windows (no CUDA required)

### Pet Menu Integration

- New action string: `"art_text_search"`
- New button in pet menu template (between "设置" and "隐藏宠物")
- Icon: magnifier + text SVG
- Label: "美术字搜索"
- `PET_MENU_HEIGHT`: 332 → 376

## Frontend UI (Liquid Glass Style)

Uses existing glass design system classes: `glass-card`, `glass-input`, `glass-btn-primary`, `glass-form-grid`, `glass-form-label`. Window frame follows `sync-center-root` pattern (traffic lights, draggable title bar, resize handles).

### Layout

```
┌─ traffic lights ──────────────────────┐
│         美术字搜索                      │
├────────────────────────────────────────┤
│  ┌─ glass-card ─────────────────────┐  │
│  │  扫描目录                         │  │
│  │  [dir1] [×]  [dir2] [×]          │  │
│  │  [+ 添加目录]                     │  │
│  │  [开始构建索引]  上次更新: date    │  │
│  │  ████████████░░░░ 75%            │  │
│  └───────────────────────────────────┘  │
│  [🔍 输入搜索文本...              ]     │
│  结果 (N):                              │
│  ┌─ glass-card result ──────────────┐  │
│  │  📄 filename.png                  │  │
│  │  识别: "文本内容"                  │  │
│  │  full\path  [打开]                │  │
│  └───────────────────────────────────┘  │
└────────────────────────────────────────┘
```

### Interactions

- Search: real-time filter with 300ms debounce
- Click "打开": calls `open_file_in_explorer` to open Explorer and select the file
- Index building: button disabled, progress bar shown via `art-text-index-progress` event
- Empty search: no results shown
- No matches: friendly "无结果" message

## Index Building Logic

1. Iterate all configured directories recursively
2. Filter for `.png`, `.jpg`, `.jpeg`, `.bmp`, `.webp` files
3. For each file: compare `lastModified` against cached entry; skip if unchanged
4. Run `oar-ocr` on new/changed images
5. Store `text → path` mapping in index JSON
6. Emit progress events: `{ current, total, currentFile }`
7. Record OCR failures in `errors` array (don't block the build)

## Edge Cases

- **Missing directories**: skip, mark red in UI
- **Permission denied**: skip, mark red in UI
- **OCR failure on single image**: skip, log in errors, don't block build
- **Empty search box**: don't trigger search
- **Unsupported file formats**: ignored (only png/jpg/jpeg/bmp/webp)
- **Incremental update**: compare file timestamps, only re-OCR changed files

## Files to Modify

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add `oar-ocr` dependency |
| `src-tauri/src/lib.rs` | Add 5 new Tauri commands, register in invoke_handler |
| `src/petMenu.js` | Add `"art_text_search"` action branch |
| `src/App.vue` | Add pet menu button + art text search window UI |
| `src-tauri/capabilities/default.json` | Add permissions for new window/commands |

## Verification

1. `npm run tauri dev` — app launches without errors
2. Right-click pet → "美术字搜索" button visible and opens the search window
3. Add a scan directory containing test images
4. Click "开始构建索引" — progress bar updates, index file created
5. Search for known text — matching results appear
6. Click "打开" — Explorer opens and selects the file
7. Close and reopen app — index persists, search still works
