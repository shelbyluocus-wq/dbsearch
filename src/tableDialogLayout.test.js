import test from "node:test";
import assert from "node:assert/strict";

import {
  clampFloatingSchemaWindow,
  resolveAdaptiveTablePageSize,
  resolveFloatingSchemaDrag,
  resolveFloatingSchemaResize,
  shouldApplyAdaptiveTablePageSize,
} from "./tableDialogLayout.js";

test("resolveAdaptiveTablePageSize computes rows from measurements in the same visual coordinate system", () => {
  assert.equal(
    resolveAdaptiveTablePageSize({
      visibleHeight: 360,
      headerHeight: 32,
      rowHeight: 41,
      minRows: 1,
      maxRows: 200,
    }),
    8,
  );
});

test("resolveAdaptiveTablePageSize clamps the result into the supported range", () => {
  assert.equal(
    resolveAdaptiveTablePageSize({
      visibleHeight: 5000,
      headerHeight: 32,
      rowHeight: 20,
      minRows: 1,
      maxRows: 200,
    }),
    200,
  );
});

test("resolveAdaptiveTablePageSize degrades safely for invalid or tiny measurements", () => {
  assert.equal(
    resolveAdaptiveTablePageSize({
      visibleHeight: 28,
      headerHeight: 32,
      rowHeight: 20,
      minRows: 1,
      maxRows: 200,
    }),
    null,
  );

  assert.equal(
    resolveAdaptiveTablePageSize({
      visibleHeight: 280,
      headerHeight: 32,
      rowHeight: 0,
      minRows: 1,
      maxRows: 200,
    }),
    null,
  );
});

test("clampFloatingSchemaWindow keeps the schema window inside the container", () => {
  assert.deepEqual(
    clampFloatingSchemaWindow({
      window: { left: -20, top: 900, width: 1200, height: 40 },
      container: { width: 900, height: 600 },
      minWidth: 320,
      minHeight: 180,
      margin: 8,
    }),
    { left: 8, top: 412, width: 884, height: 180 },
  );
});

test("resolveFloatingSchemaDrag clamps dragged coordinates", () => {
  assert.deepEqual(
    resolveFloatingSchemaDrag({
      startWindow: { left: 40, top: 60, width: 360, height: 220 },
      startPointer: { x: 100, y: 100 },
      pointer: { x: 2000, y: -200 },
      container: { width: 800, height: 500 },
      minWidth: 320,
      minHeight: 180,
      margin: 8,
    }),
    { left: 432, top: 8, width: 360, height: 220 },
  );
});

test("resolveFloatingSchemaResize clamps size without moving a valid top-left anchor", () => {
  assert.deepEqual(
    resolveFloatingSchemaResize({
      startWindow: { left: 560, top: 320, width: 260, height: 120 },
      startPointer: { x: 820, y: 440 },
      pointer: { x: 980, y: 640 },
      container: { width: 900, height: 560 },
      minWidth: 320,
      minHeight: 180,
      margin: 8,
    }),
    { left: 560, top: 320, width: 332, height: 232 },
  );
});

test("shouldApplyAdaptiveTablePageSize skips reload-prone resizing during fullscreen transitions", () => {
  assert.equal(
    shouldApplyAdaptiveTablePageSize({
      currentPageSize: 50,
      nextPageSize: 72,
      fullscreenTransitioning: true,
    }),
    false,
  );
});

test("shouldApplyAdaptiveTablePageSize skips reload-prone resizing during seamless scrolling", () => {
  assert.equal(
    shouldApplyAdaptiveTablePageSize({
      currentPageSize: 50,
      nextPageSize: 72,
      seamlessScrolling: true,
    }),
    false,
  );
});

test("shouldApplyAdaptiveTablePageSize applies stable page size changes only when needed", () => {
  assert.equal(
    shouldApplyAdaptiveTablePageSize({
      currentPageSize: 50,
      nextPageSize: 72,
      fullscreenTransitioning: false,
    }),
    true,
  );

  assert.equal(
    shouldApplyAdaptiveTablePageSize({
      currentPageSize: 50,
      nextPageSize: 50,
      fullscreenTransitioning: false,
    }),
    false,
  );
});

test("styles.css lets floating schema body fill the resized window height", async () => {
  const { readFile } = await import("node:fs/promises");
  const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
  const rule = styles.match(/^\.table-modal\.fullscreen\.fullscreen-schema-open \.schema-box\.schema-box--floating > \.section-body\s*\{[\s\S]*?\n\}/m)?.[0] || "";

  assert.match(rule, /flex:\s*1/);
  assert.match(rule, /min-height:\s*0/);
  assert.match(rule, /max-height:\s*none/);
  assert.match(rule, /overflow:\s*auto/);
});

test("styles.css scales table content via CSS variables so enlarged text stays crisp", async () => {
  const { readFile } = await import("node:fs/promises");
  const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
  const rule = styles.match(/^\.table-content-scale\s*\{[\s\S]*?\n\}/m)?.[0] || "";

  assert.match(rule, /width:\s*100%/);
  assert.match(rule, /height:\s*100%/);
  assert.match(rule, /--table-scale:\s*1/);
  assert.match(rule, /--table-row-height:\s*calc\(31px \* var\(--table-scale\)\)/);
  assert.doesNotMatch(rule, /\bzoom\s*:/);
  assert.doesNotMatch(rule, /transform:\s*scale\(var\(--content-scale\)\)/);
});
