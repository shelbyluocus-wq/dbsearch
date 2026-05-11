# Fullscreen Table Smoothness Design

## Goal

Make the table fullscreen experience feel smoother when entering/exiting fullscreen and when scrolling, while matching the row-number/freeze-handle column color to adjacent table cells.

## Current issue

The fullscreen toggle currently changes the table modal state, calls the Tauri window fullscreen/maximize APIs, and schedules adaptive page-size measurement in the same user action. That can force layout measurement, repaint, and possible data reload while the window is resizing. The table also uses translucent glass surfaces, sticky headers, frozen handles, and frozen shadows, which can increase repaint cost during scroll.

The row-number column in the screenshot is visually brighter than adjacent cells because the row freeze handle has its own clipped background behavior and can inherit frozen/handle styling instead of matching the normal body-cell surface.

## Recommended approach

1. Add a short fullscreen transition flag around table fullscreen enter/exit.
2. During that transition, suppress table modal animation and reduce expensive visual effects in the table body.
3. Defer adaptive page-size recalculation until after the window state settles and the browser has completed at least one paint.
4. Make the row-number/freeze-handle column use the same body-cell background by default, while allowing freeze preview/applied freeze styles to override it.

## Alternatives considered

- **Virtualize rows now:** better long-term for very large row counts, but too large for this bug fix and likely to disturb editing, selection, find, freeze, copy/paste, and text-panel behavior.
- **Only change CSS:** safer but does not address the resize/layout/data-load contention during fullscreen toggles.
- **Disable adaptive page sizing:** would avoid one source of jank but removes an existing useful behavior.

## Future compatibility

This fix should not block a later move to larger pages or a single-page seamless scrolling model. The implementation should keep scroll-performance styles local to the table viewport and avoid assumptions that only ~50 rows are rendered.

## Testing

- Unit-test any new pure timing/state helper if introduced.
- Run `node --test src/*.test.js`.
- Start the frontend/Tauri UI and manually test:
  - open table data;
  - enter fullscreen;
  - scroll vertically/horizontally;
  - exit fullscreen;
  - verify the row-number column color matches neighboring cells;
  - verify freeze preview/applied freeze still remains visible.
