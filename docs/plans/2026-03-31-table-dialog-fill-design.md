# Table Dialog Fill Design

**Date:** 2026-03-31

**Goal:** Remove the visible corner shadow around the table dialog and make the table dialog fill the panel window as the host window resizes.

## Context

The table dialog is rendered as a sibling overlay above the main panel surface in `src/App.vue`. Its current CSS in `src/styles.css` intentionally leaves a 12px viewport gap and uses a dimmed backdrop, which exposes the rounded panel corners and makes the dialog feel smaller than the host window.

## Decisions

1. Keep the existing floating modal treatment for non-panel contexts.
2. Switch the table dialog to a host-fill presentation when it is rendered inside the main panel window.
3. Remove the dimmed backdrop for the host-fill presentation so the corners no longer show through.
4. Keep the existing content layout and resize observers so the inner table content continues to adapt with the host window.

## Implementation Notes

- Add a small presentation helper in `src/panelChrome.js` so the fill/backdrop behavior is testable.
- Use that helper in `src/App.vue` to apply explicit mask/surface classes for the table dialog.
- Add CSS overrides in `src/styles.css` for the host-fill mode:
  - stretch the mask instead of centering the modal
  - remove the backdrop dim/blur
  - let the table surface occupy the full host window
  - remove the outer drop shadow that currently leaks into the rounded corners

## Verification

- Unit-test the new presentation helper with `node --test src/panelChrome.test.js`.
- Re-run the same test after implementation to confirm green.
