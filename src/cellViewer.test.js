import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCellViewerPreview,
  detectCellViewerLanguage,
  normalizeCellViewerLanguage,
} from "./cellViewer.js";

test("buildCellViewerPreview auto-formats valid JSON and highlights it as json", () => {
  const preview = buildCellViewerPreview({
    text: '{"b":2,"a":{"x":1}}',
  });

  assert.equal(preview.detectedLanguage, "json");
  assert.equal(preview.activeLanguage, "json");
  assert.equal(preview.isFormattedJson, true);
  assert.match(preview.previewText, /\n  "b": 2,/);
  assert.match(preview.html, /hljs-attr/);
});

test("buildCellViewerPreview keeps invalid JSON readable without throwing", () => {
  const preview = buildCellViewerPreview({
    text: '{"broken": true,,}',
  });

  assert.equal(preview.isFormattedJson, false);
  assert.equal(preview.previewText, '{"broken": true,,}');
  assert.match(preview.html, /&quot;broken&quot;/);
});

test("detectCellViewerLanguage recognizes javascript, typescript, python, and json", () => {
  assert.equal(detectCellViewerLanguage("const total = items.map((item) => item.id);"), "javascript");
  assert.equal(detectCellViewerLanguage("type Row = { id: string }\nconst row: Row = { id: '1' }"), "typescript");
  assert.equal(detectCellViewerLanguage("def render_row(value):\n    return value\n"), "python");
  assert.equal(detectCellViewerLanguage('{"ok": true}'), "json");
});

test("normalizeCellViewerLanguage keeps only supported manual overrides", () => {
  assert.equal(normalizeCellViewerLanguage("python"), "python");
  assert.equal(normalizeCellViewerLanguage("ts"), "typescript");
  assert.equal(normalizeCellViewerLanguage("unknown"), "auto");
});

test("buildCellViewerPreview prefers manual language override for highlighting only", () => {
  const preview = buildCellViewerPreview({
    text: "const answer: number = 42",
    manualLanguage: "javascript",
  });

  assert.equal(preview.detectedLanguage, "typescript");
  assert.equal(preview.activeLanguage, "javascript");
  assert.equal(preview.previewText, "const answer: number = 42");
});

test("buildCellViewerPreview escapes unsafe html when no code grammar applies", () => {
  const preview = buildCellViewerPreview({
    text: "<script>alert('xss')</script>",
  });

  assert.equal(preview.activeLanguage, "plaintext");
  assert.match(preview.html, /&lt;script&gt;/);
  assert.doesNotMatch(preview.html, /<script>/);
});
