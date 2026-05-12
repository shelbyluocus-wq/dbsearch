# Excel-style column resize cursor

## Goal

All table and grid column headers should show an Excel-like horizontal resize cursor when the pointer is near a field boundary. The cue should make it obvious that users can drag column edges to adjust widths.

## Scope

Apply the behavior to every field-header surface in the app that supports or should support column-width adjustment, including DOM-rendered tables and the fast virtual grid.

## Interaction

- When the pointer is within a narrow edge hit zone on either side of a field header, show `col-resize`.
- Use a 6-8px effective edge zone so the target is easy to discover without stealing normal header clicks.
- Prefer the column divider edge when adjacent header zones overlap.
- Outside the edge zone, restore the table or grid's normal cursor.
- Do not redesign drag resizing, sorting, selection, collapse badges, or other header actions.

## Implementation approach

DOM table headers should expose resize-edge cursor styling through their existing header/handle elements. Canvas or virtualized grids should reuse the same edge-hit concept in pointer movement code and set the canvas cursor dynamically.

## Testing

Add or update unit tests for edge hit detection where the behavior is implemented in pure JavaScript. Verify that edge coordinates return resize intent and non-edge coordinates do not. For CSS-only DOM handles, validate through browser interaction during implementation.
