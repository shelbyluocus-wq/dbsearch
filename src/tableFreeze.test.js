import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeFreezeBoundary,
  buildFrozenColumnMeta,
  buildFrozenRowMeta,
} from './tableFreeze.js';

const APP_VUE_PATH = new URL('./App.vue', import.meta.url);
const STYLES_PATH = new URL('./styles.css', import.meta.url);

async function readAppVue() {
  return await import('node:fs/promises').then(({ readFile }) => readFile(APP_VUE_PATH, 'utf8'));
}

async function readStyles() {
  return await import('node:fs/promises').then(({ readFile }) => readFile(STYLES_PATH, 'utf8'));
}

test('normalizeFreezeBoundary toggles same boundary to null', () => {
  assert.equal(normalizeFreezeBoundary('name', 'name'), null);
});

test('normalizeFreezeBoundary changes current boundary to next boundary', () => {
  assert.equal(normalizeFreezeBoundary('id', 'name'), 'name');
});

test('normalizeFreezeBoundary changes null boundary to next boundary', () => {
  assert.equal(normalizeFreezeBoundary(null, 'id'), 'id');
});

test('buildFrozenColumnMeta returns sticky offsets up to frozen column including leadingWidth', () => {
  const meta = buildFrozenColumnMeta({
    columns: ['id', 'name', 'email'],
    columnWidths: { id: 40, name: 120, email: 180 },
    frozenColumnName: 'name',
    leadingWidth: 36,
  });

  assert.deepEqual(meta, {
    id: { frozen: true, left: 36, edge: false },
    name: { frozen: true, left: 76, edge: true },
    email: { frozen: false, left: null, edge: false },
  });
});

test('buildFrozenColumnMeta falls back to rendered widths so frozen columns do not overlap', () => {
  const meta = buildFrozenColumnMeta({
    columns: ['id', 'name', 'email', 'role'],
    columnWidths: {},
    measuredColumnWidths: { id: 48, name: 128, email: 220 },
    frozenColumnName: 'email',
    leadingWidth: 36,
    fallbackWidth: 120,
  });

  assert.deepEqual(meta, {
    id: { frozen: true, left: 36, edge: false },
    name: { frozen: true, left: 84, edge: false },
    email: { frozen: true, left: 212, edge: true },
    role: { frozen: false, left: null, edge: false },
  });
});

test('buildFrozenColumnMeta includes edit checkbox leading width', () => {
  const meta = buildFrozenColumnMeta({
    columns: ['selected', 'value'],
    columnWidths: { selected: 32, value: 100 },
    frozenColumnName: 'selected',
    leadingWidth: 68,
  });

  assert.deepEqual(meta, {
    selected: { frozen: true, left: 68, edge: true },
    value: { frozen: false, left: null, edge: false },
  });
});

test('buildFrozenColumnMeta ignores missing frozen column', () => {
  const meta = buildFrozenColumnMeta({
    columns: ['id', 'name'],
    columnWidths: { id: 40, name: 120 },
    frozenColumnName: 'missing',
    leadingWidth: 36,
  });

  assert.deepEqual(meta, {
    id: { frozen: false, left: null, edge: false },
    name: { frozen: false, left: null, edge: false },
  });
});

test('buildFrozenRowMeta returns sticky top offsets up to frozen row', () => {
  const meta = buildFrozenRowMeta({
    rowCount: 4,
    frozenRowIndex: 2,
    headerHeight: 36,
    rowHeight: 28,
  });

  assert.deepEqual(meta, [
    { frozen: true, top: 36, edge: false },
    { frozen: true, top: 64, edge: false },
    { frozen: true, top: 92, edge: true },
    { frozen: false, top: null, edge: false },
  ]);
});

test('buildFrozenRowMeta ignores invalid frozen row', () => {
  const meta = buildFrozenRowMeta({
    rowCount: 2,
    frozenRowIndex: 3,
    headerHeight: 36,
    rowHeight: 28,
  });

  assert.deepEqual(meta, [
    { frozen: false, top: null, edge: false },
    { frozen: false, top: null, edge: false },
  ]);
});

test('buildFrozenRowMeta treats null frozen row as no frozen rows', () => {
  const meta = buildFrozenRowMeta({
    rowCount: 2,
    frozenRowIndex: null,
    headerHeight: 36,
    rowHeight: 28,
  });

  assert.deepEqual(meta, [
    { frozen: false, top: null, edge: false },
    { frozen: false, top: null, edge: false },
  ]);
});

test('App.vue uses toolbar freeze mode instead of table-internal freeze buttons', async () => {
  const appVue = await readAppVue();

  assert.match(appVue, /freezePickMode/);
  assert.match(appVue, /toggleFreezePickMode/);
  assert.match(appVue, /确认冻结/);
  assert.doesNotMatch(appVue, /column-freeze-btn/);
  assert.doesNotMatch(appVue, /row-freeze-btn/);
});

test('App.vue keeps column collapse badge without a neighboring freeze button', async () => {
  const appVue = await readAppVue();
  const headerStart = appVue.indexOf('<span class="th-label" v-html="renderTableColumnHeader(col.column_name)"></span>');
  const resizeHandle = appVue.indexOf('<span class="col-resize-handle"', headerStart);
  const headerMarkup = appVue.slice(headerStart, resizeHandle);

  assert.match(headerMarkup, /column-collapse-badge/);
  assert.doesNotMatch(headerMarkup, /column-freeze-btn/);
  assert.match(headerMarkup, /overflowingColumnMap\[col\.column_name\] \|\| collapsedColumnMap\[col\.column_name\]/);
  assert.match(headerMarkup, /@dblclick\.stop\.prevent="handleColumnCollapseToggle\(col\.column_name\)"/);
});

test('App.vue selects freeze preview from header, row handle, and data cells', async () => {
  const appVue = await readAppVue();

  assert.match(appVue, /selectFreezeColumn\(col\.column_name\)/);
  assert.match(appVue, /selectFreezeRow\(idx\)/);
  assert.match(appVue, /selectFreezeCell\(idx, col\.column_name\)/);
});

test('styles.css uses pick-mode preview styles instead of table-internal freeze buttons', async () => {
  const { readFile } = await import('node:fs/promises');
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

  assert.doesNotMatch(styles, /\.column-freeze-btn/);
  assert.doesNotMatch(styles, /\.row-freeze-btn/);
  assert.match(styles, /\.freeze-pick-mode/);
  assert.match(styles, /\.freeze-preview-column/);
  assert.match(styles, /\.freeze-preview-row/);
});

test('styles.css gives frozen panes a solid Excel-like surface while row numbers match data cells', async () => {
  const { readFile } = await import('node:fs/promises');
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  const tableRule = styles.match(/\.data-table\s*\{[^}]*\}/s)?.[0] || '';
  const rowHandleRule = styles.match(/\.data-table \.row-freeze-handle-col\s*\{[^}]*\}/s)?.[0] || '';
  const frozenRule = styles.match(/\.data-table th\.frozen-column,[\s\S]*?\.data-table \.edit-checkbox-col\s*\{[^}]*\}/)?.[0] || '';

  assert.match(tableRule, /border-collapse:\s*separate/);
  assert.match(tableRule, /border-spacing:\s*0/);
  assert.doesNotMatch(rowHandleRule, /background:\s*inherit/);
  assert.match(rowHandleRule, /background:\s*transparent/);
  assert.match(frozenRule, /--table-freeze-cell-bg/);
});

test('App.vue uses a higher z-index helper for frozen header columns', async () => {
  const appVue = await readAppVue();
  const helperStart = appVue.indexOf('function getFrozenHeaderColumnStyle(columnName)');
  const helperEnd = appVue.indexOf('function getFrozenRowStyle', helperStart);
  const helperCode = appVue.slice(helperStart, helperEnd);
  const headerColumnStart = appVue.indexOf(':style="getFrozenHeaderColumnStyle(col.column_name)"');

  assert.notEqual(helperStart, -1, 'getFrozenHeaderColumnStyle helper should exist');
  assert.notEqual(headerColumnStart, -1, 'header data columns should use getFrozenHeaderColumnStyle');
  assert.match(helperCode, /getColumnStyle\(columnName\)/);
  assert.match(helperCode, /frozenColumnMeta\.value\[columnName\]/);
  assert.match(helperCode, /zIndex: 11/);
});

test('App.vue routes insert row frozen column cells through a dedicated helper', async () => {
  const appVue = await readAppVue();
  const helperStart = appVue.indexOf('function getFrozenInsertCellStyle(columnName)');
  const helperEnd = appVue.indexOf('function clearFreezePreview', helperStart);
  const helperCode = appVue.slice(helperStart, helperEnd);
  const insertCellStart = appVue.indexOf(':style="getFrozenInsertCellStyle(col.column_name)"');

  assert.notEqual(helperStart, -1, 'getFrozenInsertCellStyle helper should exist');
  assert.notEqual(insertCellStart, -1, 'insert row cells should use getFrozenInsertCellStyle');
  assert.match(helperCode, /getFrozenColumnStyle\(columnName\)/);
  assert.doesNotMatch(helperCode, /frozenRowMeta/);
});

test('App.vue routes insert row handle sticky style through a helper', async () => {
  const appVue = await readAppVue();

  assert.match(appVue, /function getFrozenInsertRowHandleStyle\(\)/);
  assert.match(appVue, /:style="getFrozenInsertRowHandleStyle\(\)"/);
  assert.doesNotMatch(
    appVue,
    /<td class="edit-row-handle-col row-freeze-handle-col" style="position: sticky; left: 0px; z-index: 5;">/,
  );
});

test('App.vue keeps edit-mode leading action cells sticky between row handle and frozen data columns', async () => {
  const appVue = await readAppVue();
  const helperStart = appVue.indexOf('function getFrozenEditActionStyle()');
  const helperEnd = appVue.indexOf('function getFrozenCellStyle', helperStart);
  const helperCode = appVue.slice(helperStart, helperEnd);
  const insertHelperStart = appVue.indexOf('function getFrozenInsertActionStyle()');
  const insertHelperEnd = appVue.indexOf('function getFrozenCellStyle', insertHelperStart);
  const insertHelperCode = appVue.slice(insertHelperStart, insertHelperEnd);
  const headerHelperStart = appVue.indexOf('function getFrozenHeaderActionStyle()');
  const headerHelperEnd = appVue.indexOf('function getFrozenCellStyle', headerHelperStart);
  const headerHelperCode = appVue.slice(headerHelperStart, headerHelperEnd);
  const headerCheckboxStart = appVue.indexOf('<th v-if="editMode" class="edit-checkbox-col"');
  const existingRowCheckboxStart = appVue.indexOf('<td v-if="editMode" class="edit-checkbox-col"');
  const insertRowActionStart = appVue.indexOf('<td class="edit-checkbox-col"');

  assert.notEqual(helperStart, -1, 'shared edit action sticky helper should exist');
  assert.match(helperCode, /left: `\$\{TABLE_ROW_HANDLE_WIDTH\}px`/);
  assert.match(helperCode, /zIndex: 5/);
  assert.notEqual(insertHelperStart, -1, 'insert row action sticky helper should exist');
  assert.match(insertHelperCode, /getFrozenEditActionStyle\(\)/);
  const rowActionHelperStart = appVue.indexOf('function getFrozenRowActionStyle(rowIndex)');
  const rowActionHelperEnd = appVue.indexOf('function getFrozenHeaderHandleStyle', rowActionHelperStart);
  const rowActionHelperCode = appVue.slice(rowActionHelperStart, rowActionHelperEnd);

  assert.notEqual(headerHelperStart, -1, 'header action sticky helper should exist');
  assert.match(headerHelperCode, /getFrozenEditActionStyle\(\)/);
  assert.match(headerHelperCode, /zIndex: 12/);
  assert.notEqual(rowActionHelperStart, -1, 'existing row action sticky helper should exist');
  assert.match(rowActionHelperCode, /getFrozenRowStyle\(rowIndex\)/);
  assert.match(rowActionHelperCode, /getFrozenEditActionStyle\(\)/);
  assert.notEqual(headerCheckboxStart, -1, 'header checkbox cell should exist');
  assert.notEqual(existingRowCheckboxStart, -1, 'existing row checkbox cell should exist');
  assert.notEqual(insertRowActionStart, -1, 'insert row action cell should exist');
  assert.match(appVue.slice(headerCheckboxStart, headerCheckboxStart + 140), /:style="getFrozenHeaderActionStyle\(\)"/);
  assert.match(appVue.slice(existingRowCheckboxStart, existingRowCheckboxStart + 140), /:style="getFrozenRowActionStyle\(idx\)"/);
  assert.match(appVue.slice(insertRowActionStart, insertRowActionStart + 140), /:style="getFrozenInsertActionStyle\(\)"/);
});

test('App.vue keeps row-handle header sticky at the leading intersection', async () => {
  const appVue = await readAppVue();
  const helperStart = appVue.indexOf('function getFrozenHeaderHandleStyle()');
  const helperEnd = appVue.indexOf('function getFrozenHeaderActionStyle', helperStart);
  const helperCode = appVue.slice(helperStart, helperEnd);
  const headerHandleStart = appVue.indexOf('<th class="edit-row-handle-col row-freeze-handle-col"');

  assert.notEqual(helperStart, -1, 'row-handle header sticky helper should exist');
  assert.match(helperCode, /position: "sticky"/);
  assert.match(helperCode, /left: "0px"/);
  assert.match(helperCode, /zIndex: 13/);
  assert.notEqual(headerHandleStart, -1, 'row-handle header cell should exist');
  assert.match(appVue.slice(headerHandleStart, headerHandleStart + 140), /:style="getFrozenHeaderHandleStyle\(\)"/);
});

test('styles.css keeps row-number cells visually aligned with normal table cells', async () => {
  const styles = await readStyles();
  const rowHandleRule = styles.match(/\.data-table \.row-freeze-handle-col\s*\{[^}]*\}/s)?.[0] || '';
  const editRowHandleRule = styles.match(/\.data-table \.edit-row-handle-col\s*\{[^}]*\}/s)?.[0] || '';

  assert.match(rowHandleRule, /background:\s*transparent/);
  assert.match(rowHandleRule, /color:\s*inherit/);
  assert.match(editRowHandleRule, /background:\s*transparent/);
  assert.match(editRowHandleRule, /color:\s*inherit/);
});
