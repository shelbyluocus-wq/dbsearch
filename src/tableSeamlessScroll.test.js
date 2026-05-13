import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSeamlessViewport,
  buildSeamlessRows,
  getSeamlessBlockNumber,
  shouldUseSeamlessTableView,
  shouldLoadNextSeamlessBlock,
  shouldLoadPreviousSeamlessBlock,
  pruneSeamlessBlocks,
} from "./tableSeamlessScroll.js";

test("getSeamlessBlockNumber maps global row indexes to one-based blocks", () => {
  assert.equal(getSeamlessBlockNumber({ rowIndex: 0, blockSize: 150 }), 1);
  assert.equal(getSeamlessBlockNumber({ rowIndex: 149, blockSize: 150 }), 1);
  assert.equal(getSeamlessBlockNumber({ rowIndex: 150, blockSize: 150 }), 2);
});

test("buildSeamlessRows flattens loaded blocks with global row numbers", () => {
  const rows = buildSeamlessRows({
    blocks: new Map([
      [2, [{ id: "b" }, { id: "c" }]],
      [1, [{ id: "a" }]],
    ]),
    blockSize: 2,
  });

  assert.deepEqual(rows, [
    { row: { id: "a" }, globalIndex: 1, block: 1, localIndex: 0 },
    { row: { id: "b" }, globalIndex: 3, block: 2, localIndex: 0 },
    { row: { id: "c" }, globalIndex: 4, block: 2, localIndex: 1 },
  ]);
});

test("buildSeamlessViewport preserves full-table height with top and bottom spacers", () => {
  const blockRows = Array.from({ length: 2 }, (_, index) => ({ id: `row-${index}` }));
  const viewport = buildSeamlessViewport({
    blocks: new Map([[3, blockRows]]),
    blockSize: 2,
    totalRows: 10,
    rowHeight: 31,
    scrollTop: 0,
    clientHeight: 120,
  });

  assert.equal(viewport.topSpacerRows, 4);
  assert.equal(viewport.topSpacerHeight, 124);
  assert.equal(viewport.bottomSpacerRows, 4);
  assert.equal(viewport.bottomSpacerHeight, 124);
  assert.deepEqual(viewport.rows.map((item) => item.globalIndex), [5, 6]);
});

test("buildSeamlessViewport chooses target and adjacent blocks from scroll position", () => {
  const viewport = buildSeamlessViewport({
    blocks: new Map(),
    blockSize: 150,
    totalRows: 1000,
    rowHeight: 31,
    scrollTop: 610 * 31,
    clientHeight: 400,
    cacheRadius: 1,
  });

  assert.equal(viewport.targetBlock, 5);
  assert.deepEqual(viewport.blocksToLoad, [4, 5, 6]);
});

test("buildSeamlessViewport clamps adjacent preload blocks near table end", () => {
  const viewport = buildSeamlessViewport({
    blocks: new Map(),
    blockSize: 150,
    totalRows: 320,
    rowHeight: 31,
    scrollTop: 319 * 31,
    clientHeight: 400,
    cacheRadius: 1,
  });

  assert.equal(viewport.targetBlock, 3);
  assert.deepEqual(viewport.blocksToLoad, [2, 3]);
});

test("buildSeamlessViewport ignores stale blocks outside the current scroll window", () => {
  const viewport = buildSeamlessViewport({
    blocks: new Map([
      [1, [{ id: "stale-1" }]],
      [5, [{ id: "target-1" }, { id: "target-2" }]],
    ]),
    blockSize: 2,
    totalRows: 12,
    rowHeight: 31,
    scrollTop: 8 * 31,
    clientHeight: 31,
    cacheRadius: 0,
  });

  assert.equal(viewport.targetBlock, 5);
  assert.deepEqual(viewport.blocksToLoad, [5]);
  assert.deepEqual(viewport.rows.map((item) => item.row.id), ["target-1", "target-2"]);
  assert.equal(viewport.topSpacerRows, 8);
  assert.equal(viewport.bottomSpacerRows, 2);
});

test("buildSeamlessViewport keeps scroll height stable while the target block is loading", () => {
  const viewport = buildSeamlessViewport({
    blocks: new Map([[1, [{ id: "stale" }]]]),
    blockSize: 2,
    totalRows: 12,
    rowHeight: 31,
    scrollTop: 8 * 31,
    clientHeight: 31,
    cacheRadius: 0,
  });

  assert.deepEqual(viewport.rows, []);
  assert.equal(viewport.topSpacerRows, 8);
  assert.equal(viewport.bottomSpacerRows, 4);
  assert.equal(viewport.topSpacerHeight + viewport.bottomSpacerHeight, 12 * 31);
});

test("shouldUseSeamlessTableView treats full read and edit tables as seamless before blocks load", () => {
  assert.equal(
    shouldUseSeamlessTableView({
      tableOpen: true,
      tableDetailView: "full",
      editMode: false,
      dataCollapsed: false,
    }),
    true,
  );

  assert.equal(
    shouldUseSeamlessTableView({
      tableOpen: true,
      tableDetailView: "full",
      editMode: true,
      dataCollapsed: false,
    }),
    true,
  );

  assert.equal(
    shouldUseSeamlessTableView({
      tableOpen: true,
      tableDetailView: "full",
      editMode: true,
      dataCollapsed: true,
    }),
    false,
  );
});

test("shouldUseSeamlessTableView keeps seamless mode for small known full-table views", () => {
  assert.equal(
    shouldUseSeamlessTableView({
      tableOpen: true,
      tableDetailView: "full",
      editMode: false,
      dataCollapsed: false,
      totalRows: 2400,
    }),
    true,
  );
});

test("shouldLoadNextSeamlessBlock triggers near the bottom", () => {
  assert.equal(
    shouldLoadNextSeamlessBlock({
      scrollTop: 760,
      clientHeight: 300,
      scrollHeight: 1100,
      thresholdPx: 80,
      loading: false,
      highestLoadedBlock: 1,
      totalBlocks: 3,
    }),
    true,
  );
});

test("shouldLoadPreviousSeamlessBlock triggers near the top", () => {
  assert.equal(
    shouldLoadPreviousSeamlessBlock({
      scrollTop: 40,
      thresholdPx: 80,
      loading: false,
      lowestLoadedBlock: 2,
    }),
    true,
  );
});

test("pruneSeamlessBlocks keeps only nearby blocks", () => {
  const pruned = pruneSeamlessBlocks({
    blocks: new Map([[1, [1]], [2, [2]], [3, [3]], [4, [4]], [5, [5]]]),
    centerBlock: 3,
    radius: 1,
  });

  assert.deepEqual([...pruned.keys()], [2, 3, 4]);
});

test("App.vue renders seamless spacer rows and protects seamless cell values", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /shouldUseSeamlessTableView/);
  assert.match(appVue, /const SEAMLESS_TABLE_BLOCK_SIZE = 80;/);
  assert.doesNotMatch(appVue, /tableDetailView\.value === "full" &&\s*!\s*editMode\.value &&\s*!\s*dataCollapsed\.value &&\s*seamlessTable\.enabled/);
  assert.match(appVue, /seamlessViewport\.topSpacerHeight/);
  assert.match(appVue, /seamlessViewport\.bottomSpacerHeight/);
  assert.match(appVue, /getSeamlessSpacerStyle/);
  assert.match(appVue, /getDisplayedEditRowContext/);
  assert.match(appVue, /requestAnimationFrame\(flushTableGridScroll/);
  assert.doesNotMatch(appVue, /SEAMLESS_TABLE_MIN_ROWS/);
  assert.doesNotMatch(appVue, /async function onTableGridScroll/);
  assert.doesNotMatch(appVue, /v-if="editMode" class="pager"/);
  assert.doesNotMatch(appVue, /@click="prevPage"/);
  assert.doesNotMatch(appVue, /@click="nextPage"/);
  assert.doesNotMatch(appVue, /<span>\{\{ tableView\.page \}\} \/ \{\{ totalPages \}\}<\/span>/);
});

test("styles.css exposes modern native scrollbars for the table grid", async () => {
  const { readFile } = await import("node:fs/promises");
  const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
  const gridStyles = styles.match(/^\.grid-wrap\s*\{[^}]*\}/m)?.[0] || "";

  assert.match(gridStyles, /overflow: auto/);
  assert.match(gridStyles, /scrollbar-width: auto/);
  assert.match(styles, /\.grid-wrap::-webkit-scrollbar/);
  assert.doesNotMatch(gridStyles, /scrollbar-width: none/);
  assert.doesNotMatch(styles, /\.grid-wrap::-webkit-scrollbar\s*\{\s*display:\s*none/);
});
