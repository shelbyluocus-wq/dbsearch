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

test("getVisibleFastGridRows keeps virtualization independent from frozen rows", () => {
  assert.deepEqual(
    getVisibleFastGridRows({ totalRows: 100, rowHeight: 31, scrollTop: 310, clientHeight: 93, overscan: 2, frozenRowIndex: 0 }),
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

test("getVisibleFastGridColumns keeps frozen columns fixed while virtualizing scrollable columns", () => {
  const columns = [
    { column_name: "id" },
    { column_name: "name" },
    { column_name: "email" },
    { column_name: "role" },
  ];

  assert.deepEqual(
    getVisibleFastGridColumns({
      columns,
      scrollLeft: 260,
      clientWidth: 220,
      rowNumberWidth: 52,
      getColumnWidth: (name) => ({ id: 80, name: 120, email: 180, role: 140 })[name],
      frozenColumnName: "name",
      overscan: 0,
    }),
    [
      { column: columns[0], index: 0, x: 52, width: 80, frozen: true, edge: false },
      { column: columns[1], index: 1, x: 132, width: 120, frozen: true, edge: true },
      { column: columns[2], index: 2, x: 252, width: 180, frozen: false },
      { column: columns[3], index: 3, x: 432, width: 140, frozen: false },
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

test("hitTestFastGrid maps fixed frozen columns before scrolled columns", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }, { column_name: "email" }];

  assert.deepEqual(
    hitTestFastGrid({
      x: 150,
      y: 70,
      scrollLeft: 240,
      scrollTop: 0,
      rowHeight: 31,
      headerHeight: 34,
      rowNumberWidth: 52,
      totalRows: 100,
      columns,
      getColumnWidth: (name) => ({ id: 80, name: 120, email: 180 })[name],
      frozenColumnName: "name",
    }),
    { region: "cell", rowIndex: 1, columnIndex: 1, columnName: "name", frozenColumn: true },
  );
});

test("hitTestFastGrid maps fixed frozen rows before scrolled rows", () => {
  const columns = [{ column_name: "id" }];

  assert.deepEqual(
    hitTestFastGrid({
      x: 70,
      y: 70,
      scrollLeft: 0,
      scrollTop: 310,
      rowHeight: 31,
      headerHeight: 34,
      rowNumberWidth: 52,
      totalRows: 100,
      columns,
      getColumnWidth: () => 80,
      frozenRowIndex: 1,
    }),
    { region: "cell", rowIndex: 1, columnIndex: 0, columnName: "id", frozenRow: true },
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

test("hitTestFastGridColumnResize detects frozen header edges without scroll offset", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }, { column_name: "email" }];

  assert.deepEqual(
    hitTestFastGridColumnResize({
      x: 250,
      y: 18,
      scrollLeft: 300,
      columns,
      rowNumberWidth: 52,
      headerHeight: 34,
      getColumnWidth: (name) => ({ id: 80, name: 120, email: 180 })[name],
      handleWidth: 6,
      frozenColumnName: "name",
    }),
    { columnIndex: 1, columnName: "name", edgeX: 252, frozenColumn: true },
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

test("buildFastGridDrawModel keeps frozen column cells fixed during horizontal scroll", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }, { column_name: "email" }];
  const rows = [{ id: "1", name: "Alice", email: "a@example.test" }];

  const model = buildFastGridDrawModel({
    rows,
    rowStartIndex: 0,
    visibleColumns: [
      { column: columns[0], index: 0, x: 52, width: 80, frozen: true, edge: false },
      { column: columns[1], index: 1, x: 132, width: 120, frozen: true, edge: true },
      { column: columns[2], index: 2, x: 252, width: 180, frozen: false },
    ],
    rowHeight: 31,
    headerHeight: 34,
    scrollTop: 0,
    scrollLeft: 200,
  });

  assert.deepEqual(model.cells, [
    { rowIndex: 0, columnName: "id", text: "1", x: 52, y: 34, width: 80, height: 31, frozenColumn: true, frozenColumnEdge: false },
    { rowIndex: 0, columnName: "name", text: "Alice", x: 132, y: 34, width: 120, height: 31, frozenColumn: true, frozenColumnEdge: true },
    { rowIndex: 0, columnName: "email", text: "a@example.test", x: 52, y: 34, width: 180, height: 31 },
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

test("buildFastGridDrawModel keeps frozen rows fixed during vertical scroll", () => {
  const columns = [{ column_name: "id" }];
  const rows = [{ id: "1" }, { id: "2" }, { id: "3" }];

  const model = buildFastGridDrawModel({
    rows,
    rowStartIndex: 0,
    visibleColumns: [{ column: columns[0], index: 0, x: 52, width: 80 }],
    rowHeight: 31,
    headerHeight: 34,
    scrollTop: 62,
    scrollLeft: 0,
    frozenRowIndex: 1,
  });

  assert.deepEqual(model.cells, [
    { rowIndex: 0, columnName: "id", text: "1", x: 52, y: 34, width: 80, height: 31, frozenRow: true, frozenRowEdge: false },
    { rowIndex: 1, columnName: "id", text: "2", x: 52, y: 65, width: 80, height: 31, frozenRow: true, frozenRowEdge: true },
    { rowIndex: 2, columnName: "id", text: "3", x: 52, y: 34, width: 80, height: 31 },
  ]);
});

test("buildFastGridDrawModel marks frozen row and column intersections during horizontal scroll", () => {
  const columns = [
    { column_name: "ID" },
    { column_name: "Name" },
    { column_name: "Email" },
  ];
  const rows = [
    { ID: "1", Name: "Alice", Email: "alice@example.test" },
    { ID: "2", Name: "Bob", Email: "bob@example.test" },
  ];
  const visibleColumns = getVisibleFastGridColumns({
    columns,
    scrollLeft: 200,
    clientWidth: 260,
    rowNumberWidth: 52,
    getColumnWidth: (name) => ({ ID: 80, Name: 120, Email: 180 })[name],
    frozenColumnName: "Name",
    overscan: 0,
  });
  const model = buildFastGridDrawModel({
    rows,
    visibleColumns,
    rowHeight: 31,
    headerHeight: 34,
    scrollTop: 0,
    scrollLeft: 200,
    frozenRowIndex: 1,
  });
  const cell = (rowIndex, columnName) => model.cells.find((item) => item.rowIndex === rowIndex && item.columnName === columnName);

  assert.equal(cell(0, "ID").frozenColumn, true);
  assert.equal(cell(0, "ID").frozenRow, true);
  assert.equal(cell(0, "Name").frozenColumn, true);
  assert.equal(cell(0, "Name").frozenRow, true);
  assert.equal(cell(1, "ID").frozenColumn, true);
  assert.equal(cell(1, "ID").frozenRow, true);
  assert.equal(cell(1, "Name").frozenColumn, true);
  assert.equal(cell(1, "Name").frozenRow, true);
  assert.equal(cell(0, "Email").frozenColumn, undefined);
  assert.equal(cell(0, "Email").frozenRow, true);
  assert.equal(cell(1, "Email").frozenColumn, undefined);
  assert.equal(cell(1, "Email").frozenRow, true);
  assert.equal(cell(0, "Email").x, cell(0, "ID").x);
  assert.equal(cell(0, "Email").y, cell(0, "ID").y);
});

test("buildFastGridDrawModel uses explicit global row indexes for sparse frozen row sets", () => {
  const columns = [{ column_name: "id" }];
  const rows = [{ id: "1" }, { id: "11" }, { id: "12" }];

  const model = buildFastGridDrawModel({
    rows,
    rowIndexes: [0, 10, 11],
    visibleColumns: [{ column: columns[0], index: 0, x: 52, width: 80 }],
    rowHeight: 31,
    headerHeight: 34,
    scrollTop: 310,
    scrollLeft: 0,
    frozenRowIndex: 0,
  });

  assert.deepEqual(model.cells, [
    { rowIndex: 0, columnName: "id", text: "1", x: 52, y: 34, width: 80, height: 31, frozenRow: true, frozenRowEdge: true },
    { rowIndex: 10, columnName: "id", text: "11", x: 52, y: 34, width: 80, height: 31 },
    { rowIndex: 11, columnName: "id", text: "12", x: 52, y: 65, width: 80, height: 31 },
  ]);
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

test("resolveFastGridCellScrollTarget does not scroll horizontally for frozen columns", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }, { column_name: "email" }];

  assert.deepEqual(
    resolveFastGridCellScrollTarget({
      rowIndex: 10,
      columnName: "name",
      rowHeight: 31,
      rowNumberWidth: 52,
      columns,
      getColumnWidth: (name) => ({ id: 80, name: 120, email: 180 })[name],
      frozenColumnName: "name",
      currentScrollLeft: 260,
    }),
    {
      rowIndex: 10,
      columnName: "name",
      scrollTop: 310,
      scrollLeft: 260,
    },
  );
});

test("resolveFastGridCellScrollTarget does not scroll vertically for frozen rows", () => {
  const columns = [{ column_name: "id" }];

  assert.deepEqual(
    resolveFastGridCellScrollTarget({
      rowIndex: 1,
      columnName: "id",
      rowHeight: 31,
      rowNumberWidth: 52,
      columns,
      getColumnWidth: () => 80,
      frozenRowIndex: 1,
      currentScrollTop: 620,
    }),
    {
      rowIndex: 1,
      columnName: "id",
      scrollTop: 620,
      scrollLeft: 0,
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
  assert.match(fastGridRule, /--table-header-bg:\s*#e8f1fb/);
  assert.match(fastGridRule, /--table-body-bg:/);
  assert.match(fastGridRule, /--table-freeze-cell-bg:\s*#eef3fa/);
  assert.match(fastGridRule, /--table-row-header-bg:\s*var\(--table-freeze-cell-bg\)/);
  assert.match(fastGridRule, /background:\s*var\(--table-body-bg\)/);
  assert.match(styles, /\.fast-table-grid__viewport\s*\{/);
  assert.match(styles, /\.fast-table-grid__viewport::-webkit-scrollbar\s*\{[\s\S]*width:\s*18px;[\s\S]*height:\s*18px;/);
  assert.match(styles, /\.fast-table-grid__viewport::-webkit-scrollbar-thumb\s*\{[\s\S]*min-height:\s*44px;[\s\S]*min-width:\s*44px;/);
  assert.match(styles, /\.fast-table-grid__canvas\s*\{/);
  assert.match(styles, /\.fast-table-grid__spacer\s*\{/);
  assert.doesNotMatch(fastGridRule, /--table-header-bg:\s*rgba\(226, 236, 248/);
  assert.doesNotMatch(fastGridRule, /background:\s*rgba\(248, 250, 252/);
  assert.doesNotMatch(fastGridCanvasRule, /transform:\s*translateY\(-100%\)/);
});

test("App.vue drawFastTableGrid uses visible ranges and draw model", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const drawStart = appVue.indexOf("function drawFastTableGrid()");
  const drawEnd = appVue.indexOf("function readFastTableGridCssValue", drawStart);
  const drawBody = appVue.slice(drawStart, drawEnd);

  assert.match(appVue, /getVisibleFastGridRows/);
  assert.match(appVue, /getVisibleFastGridColumns/);
  assert.match(appVue, /buildFastGridDrawModel/);
  assert.match(appVue, /fastTableGridFocus/);
  assert.match(appVue, /function getFastTableGridVisibleRows/);
  assert.match(appVue, /function getFastTableGridFrozenRowIndexes/);
  assert.match(drawBody, /const \{ rows, rowIndexes \} = getFastTableGridVisibleRows\(rowRange, getFastTableGridFrozenRowIndexes\(\)\)/);
  assert.match(drawBody, /rowIndexes,/);
  assert.match(appVue, /function drawFastTableGridHeaders/);
  assert.match(appVue, /function drawFastTableGridRows/);
  assert.match(appVue, /context\.fillText/);
  assert.match(appVue, /TABLE_ROW_HEIGHT/);
  assert.match(appVue, /TABLE_HEADER_HEIGHT/);
  assert.match(appVue, /canvas\.style\.marginBottom = `-\$\{height\}px`/);
  assert.match(appVue, /getFastTableGridTheme\(canvas\)/);
  assert.match(appVue, /getComputedStyle\(canvas\)/);
  assert.match(appVue, /headerBackground: readFastTableGridCssValue\(styles, "--table-header-bg", readFastTableGridCssValue\(styles, "--surface-card-strong"/);
  assert.match(appVue, /rowHeaderBackground: readFastTableGridCssValue\(styles, "--table-row-header-bg", readFastTableGridCssValue\(styles, "--table-freeze-cell-bg"/);
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

test("App.vue keeps frozen read-only browsing on the fast grid path", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const guardStart = appVue.indexOf("const shouldUseFastTableGrid = computed");
  const guardEnd = appVue.indexOf("const fastTableGridScrollSize = computed");
  const guard = appVue.slice(guardStart, guardEnd);

  assert.notEqual(guardStart, -1);
  assert.notEqual(guardEnd, -1);
  assert.match(guard, /!freezePickMode\.value/);
  assert.doesNotMatch(guard, /!frozenColumnName\.value/);
  assert.doesNotMatch(guard, /frozenRowIndex\.value === null/);
  assert.match(guard, /!editMode\.value/);
});

test("App.vue passes frozen boundaries into fast grid helpers", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const visibleStart = appVue.indexOf("function drawFastTableGrid()");
  const visibleEnd = appVue.indexOf("function readFastTableGridCssValue", visibleStart);
  const drawBody = appVue.slice(visibleStart, visibleEnd);
  const hitStart = appVue.indexOf("function resolveFastTableGridHit");
  const hitEnd = appVue.indexOf("function onFastTableGridPointerDown", hitStart);
  const hitBody = appVue.slice(hitStart, hitEnd);
  const focusStart = appVue.indexOf("async function focusTableFindMatch");
  const focusEnd = appVue.indexOf("async function runTableFind", focusStart);
  const focusBody = appVue.slice(focusStart, focusEnd);

  assert.match(drawBody, /frozenColumnName: frozenColumnName\.value/);
  assert.match(drawBody, /frozenRowIndex: frozenRowIndex\.value/);
  assert.match(hitBody, /frozenColumnName: frozenColumnName\.value/);
  assert.match(hitBody, /frozenRowIndex: frozenRowIndex\.value/);
  assert.match(focusBody, /frozenColumnName: frozenColumnName\.value/);
  assert.match(focusBody, /frozenRowIndex: frozenRowIndex\.value/);
  assert.match(focusBody, /currentScrollLeft: viewport instanceof HTMLElement \? viewport\.scrollLeft : fastTableGridScroll\.left/);
  assert.match(focusBody, /currentScrollTop: viewport instanceof HTMLElement \? viewport\.scrollTop : fastTableGridScroll\.top/);
});

test("App.vue redraws the fast grid when canceling freeze pick mode", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const helperStart = appVue.indexOf("function scheduleFastTableGridRefresh()");
  const helperEnd = appVue.indexOf("function clearFreezePreview", helperStart);
  const helperBody = appVue.slice(helperStart, helperEnd);
  const cancelStart = appVue.indexOf("function cancelFreezePickMode()");
  const cancelEnd = appVue.indexOf("async function applyFreezePreview", cancelStart);
  const cancelBody = appVue.slice(cancelStart, cancelEnd);

  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  assert.match(helperBody, /nextTick\(\(\) => \{/);
  assert.match(helperBody, /syncFastTableGridViewport\(\);[\s\S]*scheduleFastTableGridDraw\(\);/);
  assert.match(helperBody, /requestAnimationFrame\(\(\) => \{/);
  assert.match(cancelBody, /scheduleFastTableGridRefresh\(\)/);
});

test("App.vue redraws the fast grid after applying a freeze preview", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const applyStart = appVue.indexOf("async function applyFreezePreview()");
  const applyEnd = appVue.indexOf("async function toggleFreezePickMode", applyStart);
  const applyBody = appVue.slice(applyStart, applyEnd);

  assert.notEqual(applyStart, -1);
  assert.notEqual(applyEnd, -1);
  assert.match(applyBody, /frozenColumnName\.value = freezePreview\.columnName/);
  assert.match(applyBody, /frozenRowIndex\.value = freezePreview\.rowIndex/);
  assert.match(applyBody, /cancelFreezePickMode\(\)/);
  assert.match(applyBody, /scheduleFastTableGridRefresh\(\)/);
});

test("App.vue draws fixed fast grid headers and the row-number gutter", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const drawStart = appVue.indexOf("function drawFastTableGrid()");
  const drawEnd = appVue.indexOf("function readFastTableGridCssValue");
  const drawBody = appVue.slice(drawStart, drawEnd);

  assert.notEqual(drawStart, -1);
  assert.notEqual(drawEnd, -1);
  assert.match(drawBody, /drawFastTableGridRows\(context, model\.cells, theme\);[\s\S]*drawFastTableGridRowHeaders\(context, rowIndexes, height, theme\);[\s\S]*drawFastTableGridHeaders\(context, visibleColumns, width, theme\);/);
  assert.match(appVue, /function drawFastTableGridRowHeaders/);
  assert.match(appVue, /rowHeaderBackground: readFastTableGridCssValue\(styles, "--table-row-header-bg", readFastTableGridCssValue\(styles, "--table-freeze-cell-bg", "#eef3fa"\)\)/);
  assert.match(appVue, /TABLE_ROW_HANDLE_WIDTH/);
  assert.match(appVue, /String\(rowIndex \+ 1\)/);
});

test("App.vue keeps frozen fast-grid headers fixed and opaque during horizontal scroll", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const headerStart = appVue.indexOf("function drawFastTableGridHeaders");
  const headerEnd = appVue.indexOf("function drawFastTableGridRowHeaders", headerStart);
  const headerBody = appVue.slice(headerStart, headerEnd);

  assert.notEqual(headerStart, -1);
  assert.notEqual(headerEnd, -1);
  assert.match(headerBody, /const scrollableColumns = visibleColumns\.filter\(\(column\) => !column\.frozen\)/);
  assert.match(headerBody, /const frozenColumns = visibleColumns\.filter\(\(column\) => column\.frozen\)/);
  assert.ok(headerBody.indexOf("scrollableColumns.forEach") < headerBody.indexOf("frozenColumns.forEach"));
  assert.ok(headerBody.lastIndexOf("context.fillRect(0, 0, rowHandleWidth, headerHeight)") > headerBody.indexOf("frozenColumns.forEach"));
  assert.match(headerBody, /context\.fillStyle = frozen \? theme\.frozenHeaderBackground : theme\.headerBackground/);
  assert.match(headerBody, /context\.fillStyle = theme\.frozenHeaderBackground;[\s\S]*context\.fillRect\(0, 0, rowHandleWidth, headerHeight\)/);
  assert.match(headerBody, /const drawX = frozen \? x : x - fastTableGridScroll\.left/);
});

test("App.vue draws frozen fast-grid intersections above scrolling frozen panes", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const rowsStart = appVue.indexOf("function drawFastTableGridRows");
  const rowsEnd = appVue.indexOf("function onFastTableGridScroll", rowsStart);
  const rowsBody = appVue.slice(rowsStart, rowsEnd);

  assert.notEqual(rowsStart, -1);
  assert.notEqual(rowsEnd, -1);
  assert.match(rowsBody, /const scrollableCells = cells\.filter\(\(cell\) => !cell\.frozenColumn && !cell\.frozenRow\)/);
  assert.match(rowsBody, /const frozenColumnCells = cells\.filter\(\(cell\) => cell\.frozenColumn && !cell\.frozenRow\)/);
  assert.match(rowsBody, /const frozenRowCells = cells\.filter\(\(cell\) => cell\.frozenRow && !cell\.frozenColumn\)/);
  assert.match(rowsBody, /const frozenIntersectionCells = cells\.filter\(\(cell\) => cell\.frozenColumn && cell\.frozenRow\)/);
  assert.match(rowsBody, /scrollableCells\.forEach/);
  assert.match(rowsBody, /frozenColumnCells\.forEach/);
  assert.match(rowsBody, /frozenRowCells\.forEach/);
  assert.match(rowsBody, /frozenIntersectionCells\.forEach/);
  assert.ok(rowsBody.indexOf("scrollableCells.forEach") < rowsBody.indexOf("frozenColumnCells.forEach"));
  assert.ok(rowsBody.indexOf("frozenColumnCells.forEach") < rowsBody.indexOf("frozenRowCells.forEach"));
  assert.ok(rowsBody.indexOf("frozenRowCells.forEach") < rowsBody.indexOf("frozenIntersectionCells.forEach"));
  assert.match(rowsBody, /cell\.frozenColumnEdge/);
  assert.match(rowsBody, /cell\.frozenRowEdge/);
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
