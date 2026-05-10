import test from "node:test";
import assert from "node:assert/strict";
import { shouldStartCellTextEdit } from "./tableCellClickEdit.js";

test("shouldStartCellTextEdit starts editing on the second click of a focused cell", () => {
  assert.equal(shouldStartCellTextEdit({
    editMode: true,
    startedFocused: true,
  }), true);
});

test("shouldStartCellTextEdit keeps the first click as focus-only", () => {
  assert.equal(shouldStartCellTextEdit({
    editMode: true,
    startedFocused: false,
  }), false);
});

test("shouldStartCellTextEdit ignores drag, shift range, and input clicks", () => {
  assert.equal(shouldStartCellTextEdit({
    editMode: true,
    startedFocused: true,
    movedDuringPointer: true,
  }), false);
  assert.equal(shouldStartCellTextEdit({
    editMode: true,
    startedFocused: true,
    shiftKey: true,
  }), false);
  assert.equal(shouldStartCellTextEdit({
    editMode: true,
    startedFocused: true,
    targetIsInput: true,
  }), false);
});
