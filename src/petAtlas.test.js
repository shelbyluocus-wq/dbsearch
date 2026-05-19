import test from "node:test";
import assert from "node:assert/strict";

import {
  CODEX_PET_ATLAS,
  CODEX_PET_STATES,
  JIEDI_PET,
  normalizePetSkin,
  resolvePetState,
} from "./petAtlas.js";

test("jiedi uses the Codex 8x9 atlas geometry", () => {
  assert.equal(JIEDI_PET.id, "jiedi");
  assert.equal(CODEX_PET_ATLAS.width, 1536);
  assert.equal(CODEX_PET_ATLAS.height, 1872);
  assert.equal(CODEX_PET_ATLAS.cellWidth, 192);
  assert.equal(CODEX_PET_ATLAS.cellHeight, 208);
  assert.equal(CODEX_PET_ATLAS.columns, 8);
  assert.equal(CODEX_PET_ATLAS.rows, 9);
  assert.deepEqual(
    CODEX_PET_STATES.map((state) => [state.id, state.row, state.frames]),
    [
      ["idle", 0, 6],
      ["running-right", 1, 8],
      ["running-left", 2, 8],
      ["waving", 3, 4],
      ["jumping", 4, 5],
      ["failed", 5, 8],
      ["waiting", 6, 6],
      ["running", 7, 6],
      ["review", 8, 6],
    ],
  );
});

test("resolvePetState maps app activity to Codex pet states", () => {
  assert.equal(resolvePetState({ searching: true }), "running");
  assert.equal(resolvePetState({ failed: true }), "failed");
  assert.equal(resolvePetState({ found: true }), "waving");
  assert.equal(resolvePetState({ idleActive: true, idleKind: "review" }), "review");
  assert.equal(resolvePetState({ idleActive: true, idleKind: "waiting" }), "waiting");
  assert.equal(resolvePetState({ dragging: true, dragDirection: "left" }), "running-left");
  assert.equal(resolvePetState({ dragging: true, dragDirection: "right" }), "running-right");
  assert.equal(resolvePetState({ dragging: true, fallbackDragDirection: "left" }), "running-left");
  assert.equal(resolvePetState({ dragging: true }), "running-right");
  assert.equal(resolvePetState({}), "idle");
});

test("normalizePetSkin migrates legacy pets to jiedi", () => {
  assert.equal(normalizePetSkin("jiedi"), "jiedi");
  assert.equal(normalizePetSkin("eagle"), "jiedi");
  assert.equal(normalizePetSkin("knight"), "jiedi");
  assert.equal(normalizePetSkin("custom:old"), "jiedi");
  assert.equal(normalizePetSkin(""), "jiedi");
});
