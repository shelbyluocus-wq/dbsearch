import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appVueSource = fs.readFileSync(new URL("./App.vue", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("settings overview cards only render icon and title", () => {
  const overviewStart = appVueSource.indexOf('<div v-if="settingsTab === -1" class="settings-entry-grid">');
  const overviewEnd = appVueSource.indexOf("<!-- Tab Content -->", overviewStart);

  assert.notEqual(overviewStart, -1);
  assert.notEqual(overviewEnd, -1);

  const overviewMarkup = appVueSource.slice(overviewStart, overviewEnd);

  assert.match(overviewMarkup, /entry-icon/);
  assert.match(overviewMarkup, /entry-title/);
  assert.match(overviewMarkup, /settings-entry-card/);
});

test("dark themes define readable glass select option colors", () => {
  assert.match(stylesSource, /\[data-theme="midnight"\]\s+\.glass-select option/);
  assert.match(stylesSource, /\[data-theme="midnight"\]\s+\.glass-select optgroup/);
  assert.match(stylesSource, /\[data-theme="typewrite_dark"\]\s+\.glass-select option/);
  assert.match(stylesSource, /\[data-theme="typewrite_dark"\]\s+\.glass-select optgroup/);
});

test("settings version card renders the raw package version label", () => {
  assert.match(appVueSource, /version-card-value">\{\{\s*VERSION_DISPLAY_LABEL\s*\}\}<\/div>/);
});

test("demo footer spacing matches the titlebar tab strip rhythm", () => {
  assert.match(
    stylesSource,
    /\.widget--demo-shell\s+\.panel-tab-strip--demo\s*\{[\s\S]*?padding:\s*6px 16px;[\s\S]*?\}/,
  );
  assert.match(
    stylesSource,
    /\.widget--demo-shell\s+\.panel-footer--demo\s*\{[\s\S]*?min-height:\s*42px;[\s\S]*?padding:\s*6px 16px;[\s\S]*?\}/,
  );
});

test("demo titlebar height matches the footer bar height", () => {
  assert.match(
    stylesSource,
    /\.widget--demo-shell\s+\.widget-header--demo\s*\{[^}]*min-height:\s*42px;[^}]*padding:\s*6px 16px;[^}]*\}/,
  );
});

test("panel shell keeps a continuous rounded perimeter stroke", () => {
  assert.match(
    stylesSource,
    /\.panel-shell::after\s*\{[\s\S]*?content:\s*"";[\s\S]*?inset:\s*0;[\s\S]*?border-radius:\s*var\(--panel-shell-radius\);[\s\S]*?box-shadow:\s*inset 0 0 0 1px [^;]+;[\s\S]*?\}/,
  );
});

test("panel shell widget does not draw its own perimeter shadow or border", () => {
  assert.match(
    stylesSource,
    /\.panel-shell\s+\.widget\s*\{[^}]*border:\s*none;[^}]*box-shadow:\s*none;[^}]*\}/,
  );
  assert.match(
    stylesSource,
    /\.panel-shell\.reduced-transparency\s+\.widget--demo-shell,\s*\.panel-shell\s+\.widget--demo-shell\.reduced-transparency\s*\{[^}]*box-shadow:\s*none;[^}]*\}/,
  );
});

test("settings modal does not render an outer drop shadow", () => {
  assert.match(
    stylesSource,
    /\.settings-modal-v2\s*\{[\s\S]*?box-shadow:\s*inset 0 1px 0 0 var\(--glass-highlight\);[\s\S]*?\}/,
  );
});
