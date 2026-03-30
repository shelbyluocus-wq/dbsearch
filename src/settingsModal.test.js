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
  assert.match(overviewMarkup, /entry-summary/);
});

test("dark themes define readable glass select option colors", () => {
  assert.match(stylesSource, /\[data-theme="midnight"\]\s+\.glass-select option/);
  assert.match(stylesSource, /\[data-theme="midnight"\]\s+\.glass-select optgroup/);
  assert.match(stylesSource, /\[data-theme="typewrite_dark"\]\s+\.glass-select option/);
  assert.match(stylesSource, /\[data-theme="typewrite_dark"\]\s+\.glass-select optgroup/);
});
