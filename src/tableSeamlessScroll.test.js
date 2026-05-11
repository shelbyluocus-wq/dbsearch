import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSeamlessRows,
  getSeamlessBlockNumber,
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
