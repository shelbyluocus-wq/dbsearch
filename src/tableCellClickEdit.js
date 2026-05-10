// tableCellClickEdit.js
//
// Decision helper for the edit-mode single-click flow:
// first click focuses a cell, second click on the same focused cell enters
// text selection/editing.

export function shouldStartCellTextEdit({
  editMode = false,
  startedFocused = false,
  movedDuringPointer = false,
  shiftKey = false,
  targetIsInput = false,
} = {}) {
  return !!editMode
    && !!startedFocused
    && !movedDuringPointer
    && !shiftKey
    && !targetIsInput;
}
