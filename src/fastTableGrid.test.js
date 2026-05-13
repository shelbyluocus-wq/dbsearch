import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFastGridDrawModel,
  buildFastGridScrollSize,
  getVisibleFastGridRows,
  getVisibleFastGridColumns,
  hitTestFastGrid,
  hitTestFastGridColumnResize,
  resolveFastGridCellScrollTarget,
  resolveFastGridColumnResizeCursor,
  truncateFastGridText,
} from "./fastTableGrid.js";

test("buildFastGridScrollSize returns full virtual table dimensions", () => {
  assert.deepEqual(
    buildFastGridScrollSize({
      totalRows: 2400,
      rowHeight: 31,
      columns: [{ column_name: "id" }, { column_name: "name" }],
      getColumnWidth: (name) => (name === "id" ? 80 : 160),
      headerHeight: 34,
      rowNumberWidth: 52,
    }),
    { width: 292, height: 74434 },
  );
});

test("getVisibleFastGridRows overscans the viewport and clamps to table bounds", () => {
  assert.deepEqual(
    getVisibleFastGridRows({ totalRows: 100, rowHeight: 31, scrollTop: 310, clientHeight: 93, overscan: 2 }),
    { start: 8, end: 15 },
  );
});

test("getVisibleFastGridColumns returns visible columns with x positions", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }, { column_name: "email" }];
  assert.deepEqual(
    getVisibleFastGridColumns({
      columns,
      scrollLeft: 70,
      clientWidth: 180,
      rowNumberWidth: 52,
      getColumnWidth: (name) => ({ id: 80, name: 120, email: 180 })[name],
      overscan: 0,
    }),
    [
      { column: columns[0], index: 0, x: 52, width: 80 },
      { column: columns[1], index: 1, x: 132, width: 120 },
    ],
  );
});

test("hitTestFastGrid maps viewport coordinates to row and column", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }];
  assert.deepEqual(
    hitTestFastGrid({
      x: 150,
      y: 70,
      scrollLeft: 0,
      scrollTop: 31,
      rowHeight: 31,
      headerHeight: 34,
      rowNumberWidth: 52,
      totalRows: 100,
      columns,
      getColumnWidth: (name) => (name === "id" ? 80 : 120),
    }),
    { region: "cell", rowIndex: 2, columnIndex: 1, columnName: "name" },
  );
});

test("hitTestFastGridColumnResize detects header resize handles", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }];

  assert.deepEqual(
    hitTestFastGridColumnResize({
      x: 130,
      y: 18,
      scrollLeft: 0,
      columns,
      rowNumberWidth: 52,
      headerHeight: 34,
      getColumnWidth: (name) => (name === "id" ? 80 : 120),
      handleWidth: 6,
    }),
    { columnIndex: 0, columnName: "id", edgeX: 132 },
  );
  assert.equal(
    hitTestFastGridColumnResize({
      x: 130,
      y: 40,
      scrollLeft: 0,
      columns,
      rowNumberWidth: 52,
      headerHeight: 34,
      getColumnWidth: (name) => (name === "id" ? 80 : 120),
      handleWidth: 6,
    }),
    null,
  );
});

test("resolveFastGridColumnResizeCursor returns col-resize on header edges", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }];

  assert.equal(
    resolveFastGridColumnResizeCursor({
      x: 130,
      y: 18,
      scrollLeft: 0,
      columns,
      rowNumberWidth: 52,
      headerHeight: 34,
      getColumnWidth: (name) => (name === "id" ? 80 : 120),
      handleWidth: 6,
    }),
    "col-resize",
  );
});

test("resolveFastGridColumnResizeCursor returns default outside header edges", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }];

  assert.equal(
    resolveFastGridColumnResizeCursor({
      x: 90,
      y: 18,
      scrollLeft: 0,
      columns,
      rowNumberWidth: 52,
      headerHeight: 34,
      getColumnWidth: (name) => (name === "id" ? 80 : 120),
      handleWidth: 6,
    }),
    "default",
  );
  assert.equal(
    resolveFastGridColumnResizeCursor({
      x: 130,
      y: 40,
      scrollLeft: 0,
      columns,
      rowNumberWidth: 52,
      headerHeight: 34,
      getColumnWidth: (name) => (name === "id" ? 80 : 120),
      handleWidth: 6,
    }),
    "default",
  );
});

test("buildFastGridDrawModel includes only visible cells", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }];
  const rows = [
    { id: "1", name: "Alice" },
    { id: "2", name: "Bob" },
  ];

  const model = buildFastGridDrawModel({
    rows,
    rowStartIndex: 10,
    columns,
    visibleColumns: [
      { column: columns[1], index: 1, x: 132, width: 120 },
    ],
    rowHeight: 31,
    headerHeight: 34,
    scrollTop: 310,
    scrollLeft: 0,
    rowNumberWidth: 52,
  });

  assert.deepEqual(model.cells, [
    { rowIndex: 10, columnName: "name", text: "Alice", x: 132, y: 34, width: 120, height: 31 },
    { rowIndex: 11, columnName: "name", text: "Bob", x: 132, y: 65, width: 120, height: 31 },
  ]);
});

test("buildFastGridDrawModel marks focused and hit cells", () => {
  const columns = [{ column_name: "id" }];
  const model = buildFastGridDrawModel({
    rows: [{ id: "1" }],
    rowStartIndex: 0,
    columns,
    visibleColumns: [{ column: columns[0], index: 0, x: 52, width: 80 }],
    focusedCell: { rowIndex: 0, columnName: "id" },
    isCellHit: ({ rowIndex, columnName }) => rowIndex === 0 && columnName === "id",
  });

  assert.equal(model.cells[0].focused, true);
  assert.equal(model.cells[0].hit, true);
});

test("resolveFastGridCellScrollTarget maps a table-find match to viewport scroll and focus", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }, { column_name: "email" }];

  assert.deepEqual(
    resolveFastGridCellScrollTarget({
      rowIndex: 10,
      columnName: "email",
      rowHeight: 31,
      rowNumberWidth: 52,
      columns,
      getColumnWidth: (name) => ({ id: 80, name: 120, email: 180 })[name],
    }),
    {
      rowIndex: 10,
      columnName: "email",
      scrollTop: 310,
      scrollLeft: 200,
    },
  );
});

test("truncateFastGridText clips long CJK text instead of letting canvas horizontally compress it", () => {
  assert.equal(truncateFastGridText("神话降临高级资源宝箱", 68, { measureText: (text) => ({ width: text.length * 12 }) }), "神话降临…");
  assert.equal(truncateFastGridText("金币", 68, { measureText: (text) => ({ width: text.length * 12 }) }), "金币");
});

test("App.vue wires fast table grid only for read-only full-table browsing", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /fastTableGridCanvasRef/);
  assert.match(appVue, /shouldUseFastTableGrid/);
  assert.match(appVue, /!editMode\.value/);
  assert.match(appVue, /drawFastTableGrid/);
  assert.match(appVue, /hitTestFastGrid/);
  assert.match(appVue, /v-if="shouldUseFastTableGrid"/);
  assert.match(appVue, /v-else[\s\S]*<table class="data-table">/);
});

test("App.vue enables complete fast table grid behind the read-only full-table guard", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /const FAST_TABLE_GRID_ENABLED = true;/);
  assert.match(appVue, /FAST_TABLE_GRID_ENABLED &&[\s\S]*tableOpen\.value/);
});

test("App.vue renders the fast grid viewport before the DOM table fallback", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /class="fast-table-grid"/);
  assert.match(appVue, /ref="fastTableGridViewportRef"/);
  assert.match(appVue, /@scroll="onFastTableGridScroll"/);
  assert.match(appVue, /ref="fastTableGridCanvasRef"/);
  assert.match(appVue, /@dblclick="onFastTableGridDoubleClick"/);
  assert.match(appVue, /<canvas ref="fastTableGridCanvasRef"[\s\S]*<div class="fast-table-grid__spacer"/);
});

test("styles.css includes fast table grid viewport styles", async () => {
  const { readFile } = await import("node:fs/promises");
  const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
  const fastGridRule = styles.match(/\.fast-table-grid\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const fastGridCanvasRule = styles.match(/\.fast-table-grid__canvas\s*\{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(styles, /\.fast-table-grid\s*\{/);
  assert.match(fastGridRule, /--table-header-bg:\s*var\(--surface-card-strong\)/);
  assert.match(fastGridRule, /--table-body-bg:/);
  assert.match(fastGridRule, /--table-row-header-bg:\s*var\(--table-body-bg\)/);
  assert.match(fastGridRule, /background:\s*var\(--table-body-bg\)/);
  assert.match(styles, /\.fast-table-grid__viewport\s*\{/);
  assert.match(styles, /\.fast-table-grid__canvas\s*\{/);
  assert.match(styles, /\.fast-table-grid__spacer\s*\{/);
  assert.doesNotMatch(fastGridRule, /--table-header-bg:\s*rgba\(226, 236, 248/);
  assert.doesNotMatch(fastGridRule, /background:\s*rgba\(248, 250, 252/);
  assert.doesNotMatch(fastGridCanvasRule, /transform:\s*translateY\(-100%\)/);
});

test("App.vue drawFastTableGrid uses visible ranges and draw model", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /getVisibleFastGridRows/);
  assert.match(appVue, /getVisibleFastGridColumns/);
  assert.match(appVue, /buildFastGridDrawModel/);
  assert.match(appVue, /fastTableGridFocus/);
  assert.match(appVue, /function getFastTableGridVisibleRows/);
  assert.match(appVue, /function drawFastTableGridHeaders/);
  assert.match(appVue, /function drawFastTableGridRows/);
  assert.match(appVue, /context\.fillText/);
  assert.match(appVue, /TABLE_ROW_HEIGHT/);
  assert.match(appVue, /TABLE_HEADER_HEIGHT/);
  assert.match(appVue, /canvas\.style\.marginBottom = `-\$\{height\}px`/);
  assert.match(appVue, /getFastTableGridTheme\(canvas\)/);
  assert.match(appVue, /getComputedStyle\(canvas\)/);
  assert.match(appVue, /headerBackground: readFastTableGridCssValue\(styles, "--table-header-bg", readFastTableGridCssValue\(styles, "--surface-card-strong"/);
  assert.match(appVue, /rowHeaderBackground: readFastTableGridCssValue\(styles, "--table-row-header-bg", readFastTableGridCssValue\(styles, "--bg-panel"/);
  assert.match(appVue, /cellBackground: readFastTableGridCssValue\(styles, "--table-body-bg", readFastTableGridCssValue\(styles, "--bg-panel"/);
  assert.match(appVue, /truncateFastGridText/);
  assert.doesNotMatch(appVue, /context\.fillText\([^\n]+, [^\n]+, [^\n]+, Math\.max/);
  assert.doesNotMatch(appVue, /fillStyle = "#ffffff"|fillStyle = "#0f172a"|fillStyle = "#f1f5f9"/);
});

test("App.vue lets table zoom change real layout metrics instead of CSS zooming pixels", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
  const tableScaleStyleStart = appVue.indexOf("const tableContentScaleStyle = computed");
  const tableScaleStyleEnd = appVue.indexOf("const hitOnlySchemaColumns", tableScaleStyleStart);
  const tableScaleStyleBody = appVue.slice(tableScaleStyleStart, tableScaleStyleEnd);
  const tableContentScaleRule = styles.match(/\.table-content-scale\s*\{[\s\S]*?\n\}/)?.[0] || "";

  assert.notEqual(tableScaleStyleStart, -1);
  assert.notEqual(tableScaleStyleEnd, -1);
  assert.match(tableScaleStyleBody, /"--table-scale": String\(tableVisualScale\.value\)/);
  assert.doesNotMatch(tableContentScaleRule, /\bzoom\s*:/);
});

test("App.vue draws the fast grid at scaled layout size without double-applying table zoom", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const drawStart = appVue.indexOf("function drawFastTableGrid()");
  const drawEnd = appVue.indexOf("function readFastTableGridCssValue");
  const drawBody = appVue.slice(drawStart, drawEnd);
  const scrollSizeStart = appVue.indexOf("const fastTableGridScrollSize = computed");
  const scrollSizeEnd = appVue.indexOf("const fastTableGridSpacerStyle", scrollSizeStart);
  const scrollSizeBody = appVue.slice(scrollSizeStart, scrollSizeEnd);
  const hitStart = appVue.indexOf("function resolveFastTableGridHit");
  const hitEnd = appVue.indexOf("function onFastTableGridPointerDown", hitStart);
  const hitBody = appVue.slice(hitStart, hitEnd);
  const pointerStart = appVue.indexOf("function onFastTableGridPointerDown");
  const pointerEnd = appVue.indexOf("function onFastTableGridClick", pointerStart);
  const pointerBody = appVue.slice(pointerStart, pointerEnd);

  assert.notEqual(drawStart, -1);
  assert.notEqual(drawEnd, -1);
  assert.match(appVue, /const scaledTableHeaderHeight = computed\(\(\) => Math\.round\(TABLE_HEADER_HEIGHT \* tableVisualScale\.value\)\)/);
  assert.match(appVue, /const scaledTableRowHeight = computed\(\(\) => Math\.round\(TABLE_ROW_HEIGHT \* tableVisualScale\.value\)\)/);
  assert.match(appVue, /const scaledTableRowHandleWidth = computed\(\(\) => Math\.round\(TABLE_ROW_HANDLE_WIDTH \* tableVisualScale\.value\)\)/);
  assert.match(drawBody, /const ratio = window\.devicePixelRatio \|\| 1/);
  assert.doesNotMatch(drawBody, /devicePixelRatio \|\| 1\) \* visualScale/);
  assert.match(scrollSizeBody, /rowHeight: scaledTableRowHeight\.value/);
  assert.match(scrollSizeBody, /headerHeight: scaledTableHeaderHeight\.value/);
  assert.match(scrollSizeBody, /rowNumberWidth: scaledTableRowHandleWidth\.value/);
  assert.match(scrollSizeBody, /fallbackColumnWidth: Math\.round\(TABLE_COLUMN_WIDTH_FALLBACK \* tableVisualScale\.value\)/);
  assert.match(scrollSizeBody, /getColumnWidth: getScaledTableColumnWidth/);
  assert.doesNotMatch(scrollSizeBody, /getColumnWidth,\s*\n\s*fallbackColumnWidth: Math\.round\(TABLE_COLUMN_WIDTH_FALLBACK \* tableVisualScale\.value\)/);
  assert.match(drawBody, /rowHeight: scaledTableRowHeight\.value/);
  assert.match(drawBody, /headerHeight: scaledTableHeaderHeight\.value/);
  assert.match(drawBody, /rowNumberWidth: scaledTableRowHandleWidth\.value/);
  assert.match(drawBody, /fallbackColumnWidth: Math\.round\(TABLE_COLUMN_WIDTH_FALLBACK \* tableVisualScale\.value\)/);
  assert.match(drawBody, /getColumnWidth: getScaledTableColumnWidth/);
  assert.doesNotMatch(drawBody, /getColumnWidth,\s*\n\s*fallbackColumnWidth: Math\.round\(TABLE_COLUMN_WIDTH_FALLBACK \* tableVisualScale\.value\)/);
  assert.match(hitBody, /rowHeight: scaledTableRowHeight\.value/);
  assert.match(hitBody, /headerHeight: scaledTableHeaderHeight\.value/);
  assert.match(hitBody, /rowNumberWidth: scaledTableRowHandleWidth\.value/);
  assert.match(hitBody, /fallbackColumnWidth: Math\.round\(TABLE_COLUMN_WIDTH_FALLBACK \* tableVisualScale\.value\)/);
  assert.match(hitBody, /getColumnWidth: getScaledTableColumnWidth/);
  assert.doesNotMatch(hitBody, /getColumnWidth,\s*\n\s*fallbackColumnWidth: Math\.round\(TABLE_COLUMN_WIDTH_FALLBACK \* tableVisualScale\.value\)/);
  assert.match(pointerBody, /rowNumberWidth: scaledTableRowHandleWidth\.value/);
  assert.match(pointerBody, /headerHeight: scaledTableHeaderHeight\.value/);
  assert.match(pointerBody, /fallbackColumnWidth: Math\.round\(TABLE_COLUMN_WIDTH_FALLBACK \* tableVisualScale\.value\)/);
  assert.match(pointerBody, /getColumnWidth: getScaledTableColumnWidth/);
  assert.doesNotMatch(pointerBody, /getColumnWidth,\s*\n\s*fallbackColumnWidth: Math\.round\(TABLE_COLUMN_WIDTH_FALLBACK \* tableVisualScale\.value\)/);
});

test("App.vue table-find and seamless fast grid paths use scaled layout metrics", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const focusStart = appVue.indexOf("async function focusTableFindMatch");
  const focusEnd = appVue.indexOf("async function runTableFind", focusStart);
  const focusBody = appVue.slice(focusStart, focusEnd);
  const seamlessViewportStart = appVue.indexOf("const seamlessViewport = computed");
  const seamlessViewportEnd = appVue.indexOf("const seamlessTotalBlocks", seamlessViewportStart);
  const seamlessViewportBody = appVue.slice(seamlessViewportStart, seamlessViewportEnd);
  const enableStart = appVue.indexOf("async function enableSeamlessTableFromCurrentPage");
  const enableEnd = appVue.indexOf("function syncFastTableGridViewport", enableStart);
  const enableBody = appVue.slice(enableStart, enableEnd);

  assert.notEqual(focusStart, -1);
  assert.notEqual(focusEnd, -1);
  assert.match(focusBody, /rowHeight: scaledTableRowHeight\.value/);
  assert.match(focusBody, /rowNumberWidth: scaledTableRowHandleWidth\.value/);
  assert.match(focusBody, /getColumnWidth: getScaledTableColumnWidth/);
  assert.match(focusBody, /fallbackColumnWidth: Math\.round\(TABLE_COLUMN_WIDTH_FALLBACK \* tableVisualScale\.value\)/);
  assert.doesNotMatch(focusBody, /rowHeight: TABLE_ROW_HEIGHT/);
  assert.doesNotMatch(focusBody, /rowNumberWidth: TABLE_ROW_HANDLE_WIDTH/);
  assert.doesNotMatch(focusBody, /getColumnWidth,\s*\n\s*fallbackColumnWidth: TABLE_COLUMN_WIDTH_FALLBACK/);

  assert.match(seamlessViewportBody, /rowHeight: shouldUseFastTableGrid\.value \? scaledTableRowHeight\.value : TABLE_ROW_HEIGHT/);
  assert.match(enableBody, /const anchorRowHeight = shouldUseFastTableGrid\.value \? scaledTableRowHeight\.value : TABLE_ROW_HEIGHT/);
  assert.match(enableBody, /const anchorScrollTop = anchorRowIndex \* anchorRowHeight/);
  assert.doesNotMatch(enableBody, /const anchorScrollTop = anchorRowIndex \* TABLE_ROW_HEIGHT/);
});

test("App.vue fast grid pointer handlers reuse existing cell viewer and row copy", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /function getFastTableGridRow/);
  assert.match(appVue, /function resolveFastTableGridHit/);
  assert.match(appVue, /function onFastTableGridClick/);
  assert.match(appVue, /function onFastTableGridDoubleClick/);
  assert.match(appVue, /function onFastTableGridContextMenu/);
  assert.match(appVue, /openPageCellViewer/);
  assert.match(appVue, /copyRow/);
});

test("App.vue fast grid supports resizing columns with existing widths", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  const resizeMoveStart = appVue.indexOf("function onColumnResizeMove");
  const resizeMoveEnd = appVue.indexOf("function onSchemaColumnResizeMove");
  const resizeMove = appVue.slice(resizeMoveStart, resizeMoveEnd);

  assert.match(appVue, /hitTestFastGridColumnResize/);
  assert.match(appVue, /function startFastTableGridColumnResize/);
  assert.match(appVue, /function onFastTableGridPointerDown/);
  assert.match(appVue, /@pointerdown="onFastTableGridPointerDown"/);
  assert.match(appVue, /startColumnResize\(event, columnName\)/);
  assert.match(resizeMove, /columnWidthMap\[columnResizeState\.columnName\] = width;[\s\S]*scheduleFastTableGridDraw\(\)/);
});

test("App.vue seeds fast grid widths from field names without rendered DOM headers", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /getHeaderContentWidth\(columnName, \{ rendered = true \} = \{\}\)/);
  assert.match(appVue, /computeAutoTableColumnWidth\(columnName, \{ rendered = true \} = \{\}\)/);
  assert.match(appVue, /seedAutoColumnWidths\(tableView\.columns, \{ rendered: false \}\)/);
});

test("App.vue keeps edit mode on the DOM table path", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /const shouldUseFastTableGrid = computed/);
  assert.match(appVue, /!editMode\.value/);
  assert.match(appVue, /<div v-else ref="tableGridWrapRef" class="grid-wrap"/);
  assert.match(appVue, /<input v-if="editingCell\.active/);
  assert.match(appVue, /v-if="editMode" class="edit-bottom-stack"/);
});

test("App.vue keeps freeze states on the DOM table path while allowing fullscreen fast grid", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const guardStart = appVue.indexOf("const shouldUseFastTableGrid = computed");
  const guardEnd = appVue.indexOf("const fastTableGridScrollSize = computed");
  const guard = appVue.slice(guardStart, guardEnd);

  assert.notEqual(guardStart, -1);
  assert.notEqual(guardEnd, -1);
  assert.match(guard, /!freezePickMode\.value/);
  assert.match(guard, /!frozenColumnName\.value/);
  assert.match(guard, /frozenRowIndex\.value === null/);
  assert.doesNotMatch(guard, /!tableFullscreen\.value/);
});

test("App.vue draws fixed fast grid headers and the row-number gutter", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const drawStart = appVue.indexOf("function drawFastTableGrid()");
  const drawEnd = appVue.indexOf("function readFastTableGridCssValue");
  const drawBody = appVue.slice(drawStart, drawEnd);

  assert.notEqual(drawStart, -1);
  assert.notEqual(drawEnd, -1);
  assert.match(drawBody, /drawFastTableGridRows\(context, model\.cells, theme\);[\s\S]*drawFastTableGridRowHeaders\(context, rowRange, height, theme\);[\s\S]*drawFastTableGridHeaders\(context, visibleColumns, width, theme\);/);
  assert.match(appVue, /function drawFastTableGridRowHeaders/);
  assert.match(appVue, /TABLE_ROW_HANDLE_WIDTH/);
  assert.match(appVue, /String\(rowIndex \+ 1\)/);
});

test("App.vue keeps seamless loading available for fast grid scrolling", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /pendingTableGridScroll\.scrollTop = target\.scrollTop/);
  assert.match(appVue, /requestAnimationFrame\(flushTableGridScroll/);
  assert.match(appVue, /loadVisibleSeamlessBlocks/);
});

test("App.vue redraws the fast grid when seamless blocks change", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const blockStart = appVue.indexOf("async function loadSeamlessTableBlock");
  const enablerStart = appVue.indexOf("async function enableSeamlessTableFromCurrentPage");
  const drawStart = appVue.indexOf("function scheduleFastTableGridDraw");
  const blockLoader = appVue.slice(blockStart, enablerStart);
  const seamlessEnabler = appVue.slice(enablerStart, drawStart);

  assert.notEqual(blockStart, -1);
  assert.notEqual(enablerStart, -1);
  assert.notEqual(drawStart, -1);
  assert.match(blockLoader, /seamlessTable\.blocks = pruneSeamlessBlocks\([\s\S]*scheduleFastTableGridDraw\(\)/);
  assert.match(seamlessEnabler, /seamlessTable\.blocks = new Map\(\[\[currentBlock, cloneRows\(tableView\.rows\)\]\]\);[\s\S]*scheduleFastTableGridDraw\(\)/);
});

test("App.vue initializes seamless scrolling from the active fast grid viewport", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const enablerStart = appVue.indexOf("async function enableSeamlessTableFromCurrentPage");
  const drawStart = appVue.indexOf("function scheduleFastTableGridDraw");
  const seamlessEnabler = appVue.slice(enablerStart, drawStart);

  assert.match(seamlessEnabler, /const wrap = shouldUseFastTableGrid\.value \? fastTableGridViewportRef\.value : tableGridWrapRef\.value/);
  assert.match(seamlessEnabler, /fastTableGridScroll\.top = anchorScrollTop/);
  assert.match(seamlessEnabler, /fastTableGridScroll\.height = wrap\.clientHeight/);
});

test("App.vue routes table-find matches through the fast grid viewport", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const focusStart = appVue.indexOf("async function focusTableFindMatch");
  const focusEnd = appVue.indexOf("async function runTableFind");
  const focusBody = appVue.slice(focusStart, focusEnd);

  assert.match(appVue, /resolveFastGridCellScrollTarget/);
  assert.match(focusBody, /shouldUseFastTableGrid\.value/);
  assert.match(focusBody, /await nextTick\(\);[\s\S]*const viewport = fastTableGridViewportRef\.value/);
  assert.match(focusBody, /fastTableGridViewportRef\.value/);
  assert.match(focusBody, /resolveFastGridCellScrollTarget\(/);
  assert.match(focusBody, /fastTableGridFocus\.rowIndex = target\.rowIndex/);
  assert.match(focusBody, /fastTableGridFocus\.columnName = target\.columnName/);
  assert.match(focusBody, /scheduleFastTableGridDraw\(\)/);
});

test("App.vue resizes and redraws the fast grid after layout changes", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /function syncFastTableGridViewport/);
  assert.match(appVue, /fastTableGridScroll\.width = viewport\.clientWidth/);
  assert.match(appVue, /fastTableGridScroll\.height = viewport\.clientHeight/);
  assert.match(appVue, /syncFastTableGridViewport\(\);[\s\S]*scheduleFastTableGridDraw\(\)/);
  assert.match(appVue, /tableLayoutObserver = new ResizeObserver\(\(\) => \{[\s\S]*syncFastTableGridViewport\(\);[\s\S]*scheduleFastTableGridDraw\(\)/);
});
