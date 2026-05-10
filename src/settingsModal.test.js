import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appVueSource = fs.readFileSync(new URL("./App.vue", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function getCssRuleBody(selector) {
  const marker = `${selector} {`;
  const start = stylesSource.indexOf(marker);
  assert.notEqual(start, -1, `Missing CSS rule: ${selector}`);
  const bodyStart = start + marker.length;
  const end = stylesSource.indexOf("\n}", bodyStart);
  assert.notEqual(end, -1, `Could not read CSS rule: ${selector}`);
  return stylesSource.slice(bodyStart, end);
}

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

test("typewrite dark demo shell uses denser surfaces for readability", () => {
  const themeVars = getCssRuleBody('[data-theme="typewrite_dark"] .widget--demo-shell[data-text-tone="light"]');
  const shellRule = getCssRuleBody('[data-theme="typewrite_dark"] .panel-shell .widget--demo-shell[data-text-tone="light"]');
  const resultsRule = getCssRuleBody('[data-theme="typewrite_dark"] .panel-shell .widget--demo-shell[data-text-tone="light"] .results-main');

  assert.match(themeVars, /--demo-shell-bg:\s*rgba\(42,\s*36,\s*32,\s*calc\(0\.88 \* var\(--panel-opacity\)\)\);/);
  assert.match(themeVars, /--demo-header-bg:\s*rgba\(42,\s*36,\s*32,\s*calc\(0\.92 \* var\(--panel-opacity\)\)\);/);
  assert.match(themeVars, /--demo-results-bg:\s*rgba\(42,\s*36,\s*32,\s*calc\(0\.88 \* var\(--panel-opacity\)\)\);/);
  assert.match(themeVars, /--demo-card-bg:\s*rgba\(50,\s*42,\s*36,\s*calc\(0\.86 \* var\(--panel-opacity\)\)\);/);
  assert.match(shellRule, /background:\s*var\(--demo-shell-bg\);/);
  assert.match(resultsRule, /background:\s*linear-gradient\(180deg,\s*var\(--demo-results-bg\),\s*var\(--demo-results-bg-end\)\);/);
});

test("footer template name opens the saved template menu", () => {
  assert.match(appVueSource, /const\s+templateMenuOpen\s*=\s*ref\(false\);/);
  assert.match(appVueSource, /function\s+toggleTemplateMenu\s*\(/);
  assert.match(appVueSource, /function\s+closeTemplateMenu\s*\(/);
  assert.match(
    appVueSource,
    /<button[\s\S]*class="template-current-name template-current-button"[\s\S]*@click="toggleTemplateMenu"/,
  );
  assert.match(appVueSource, /v-if="templateMenuOpen" class="database-menu-popover template-menu-popover"/);
  assert.match(appVueSource, /v-for="\(\s*tpl,\s*idx\s*\) in config\.shared\.db_templates"/);
  assert.match(appVueSource, /@click="selectTemplateFromMenu\(idx\)"/);
  assert.match(stylesSource, /\.template-menu-popover\s*\{[\s\S]*?width:\s*280px;[\s\S]*?\}/);
  assert.match(stylesSource, /\.template-current-button\s*\{[\s\S]*?cursor:\s*pointer;[\s\S]*?\}/);
});

test("settings modal does not render an outer drop shadow", () => {
  assert.match(
    stylesSource,
    /\.settings-modal-v2\s*\{[\s\S]*?box-shadow:\s*inset 0 1px 0 0 var\(--glass-highlight\);[\s\S]*?\}/,
  );
});
