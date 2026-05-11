# Seamless Table Scroll Design

## Goal

Make full table viewing feel like one continuous page for tables with a few thousand rows, without rendering all rows at once or abandoning system fullscreen.

## Scope

First version applies to non-edit viewing mode. Edit mode keeps the current paginated model because editing, row selection, rectangular range selection, insert rows, delete rows, and save semantics are tightly coupled to the current loaded page.

## Recommended approach

Use block-cached infinite scrolling:

1. Keep the existing backend `get_table_data(tableName, page, pageSize)` contract.
2. Treat each backend page as a scroll block, with a block size around 100-200 rows.
3. Display rows from a small loaded window around the current scroll position instead of rendering every row in the table.
4. When the user scrolls near the bottom, load the next block and append it to the visible window.
5. When the user scrolls near the top and previous blocks are available, load or restore the previous block.
6. Keep global row numbers based on `blockStart + localIndex + 1` so the user sees continuous rows.
7. Keep old pagination controls as a fallback and for edit mode until seamless scrolling is proven stable.

## Why not render all rows

A few thousand rows multiplied by many columns produces a large DOM. This table also has sticky headers, frozen rows/columns, dynamic cell classes, find highlights, hit highlights, row handles, and edit-mode affordances. Rendering all rows as one physical page would make scroll and fullscreen repaint costs visibly worse.

## Why not full virtualization now

Full virtual scrolling is the most scalable option, but it would require deeper changes to table layout, frozen columns, cell focus, selection, F4 text panel, find navigation, and edit mode. It is the right long-term architecture for tens or hundreds of thousands of rows, but it is too large for the first seamless-scroll iteration.

## Data model

Add a viewing-mode scroll state separate from `tableView.rows` pagination:

- `seamlessEnabled`: true when full table view is open and edit mode is off.
- `seamlessBlockSize`: initial target 150 rows.
- `seamlessBlocks`: map from block number to rows.
- `seamlessTotalRows`: total row count from backend response.
- `seamlessLoading`: prevents duplicate loads.
- `seamlessVisibleRows`: flattened rows from loaded blocks.
- `seamlessWindowStart`: global row index of first visible row.

The first implementation can keep a bounded loaded window, for example current block plus one previous and one next block. That keeps the DOM bounded while feeling continuous.

## Interaction rules

- In view mode, the user scrolls continuously and the footer pager becomes secondary or hidden.
- In edit mode, the app uses current pagination unchanged.
- Search/find may initially search only loaded rows unless the existing full-table index path is explicitly used.
- Freeze row/column still works within the rendered window; frozen row labels use global row numbers.
- Switching table tabs clears seamless cache for the old table through existing snapshot/restore boundaries.

## Performance expectation

For a few thousand rows, this should be smooth because only a bounded set of rows is mounted. Loading a block may be visible on slow databases, so the UI should preload before the user reaches the edge and show a small inline loading state only if needed.

## Testing

- Unit-test pure block-window helpers.
- Unit-test loading threshold decisions.
- Run `node --test src/*.test.js`.
- Manually verify: open a table, scroll down through multiple blocks, scroll back up, check row numbers are continuous, switch tabs, enter/exit system fullscreen, and confirm edit mode still uses current pagination.
