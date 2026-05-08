import test from "node:test";
import assert from "node:assert/strict";
import {
  insertImageBlockAtTextSelection,
  normalizeQuickPasteEditorBlocks,
  normalizeQuickPasteEditorHtml,
  serializeQuickPasteEditorBlocks,
  serializeQuickPasteEditorHtml,
} from "./quickPasteEditor.js";

test("normalizes empty rich placeholders into a truly empty editor", () => {
  const html = normalizeQuickPasteEditorHtml({
    id: "snippet-empty-rich",
    title: "新内容",
    category: "rich",
    content: "<p><br></p>",
  });

  assert.equal(html, "");
});

test("normalizes plain text into one rich editor html surface", () => {
  const html = normalizeQuickPasteEditorHtml({
    id: "snippet-text",
    title: "文本",
    category: "text",
    content: "上方文字\n下方文字",
  });

  assert.equal(html, "<p>上方文字</p><p>下方文字</p>");
});

test("normalizes image snippets into the same rich editor surface with trailing writing space", () => {
  const html = normalizeQuickPasteEditorHtml(
    {
      id: "snippet-image",
      title: "截图",
      category: "image",
      content: "E:/tmp/screenshot.png",
    },
    { resolveImageSrc: (src) => `resolved:${src}` },
  );

  assert.equal(
    html,
    '<p><img src="resolved:E:/tmp/screenshot.png" data-path="E:/tmp/screenshot.png" alt="截图"></p><p><br></p>',
  );
});

test("normalizes rich html images for display while preserving local paths", () => {
  const html = normalizeQuickPasteEditorHtml(
    {
      id: "snippet-rich",
      title: "图文",
      category: "rich",
      content: '<p>上方文字</p><p><img src="E:/tmp/pasted.png" alt="图片"></p><p>下方文字</p>',
    },
    { resolveImageSrc: (src) => `resolved:${src}` },
  );

  assert.equal(
    html,
    '<p>上方文字</p><p><img src="resolved:E:/tmp/pasted.png" data-path="E:/tmp/pasted.png" alt="图片"></p><p>下方文字</p>',
  );
});

test("serializes pasted styled text without keeping inline colors", () => {
  const html = serializeQuickPasteEditorHtml('<p><span style="color: rgb(180, 180, 180);">粘贴文本</span></p>');

  assert.equal(html, "<p><span>粘贴文本</span></p>");
});

test("serializes rich editor html back to stored paths for F8 output", () => {
  const html = serializeQuickPasteEditorHtml(
    '<p>上方文字</p><p><img src="asset://image" data-path="E:/tmp/pasted.png" alt="图片"></p><p>下方文字</p>',
  );

  assert.equal(html, '<p>上方文字</p><p><img src="E:/tmp/pasted.png" alt="图片"></p><p>下方文字</p>');
});

test("inserts a pasted image at the textarea cursor and keeps text below it editable", () => {
  const blocks = [{ id: "text-1", type: "text", text: "上方文字下方文字" }];

  const result = insertImageBlockAtTextSelection(blocks, "text-1", 4, 4, {
    id: "image-1",
    type: "image",
    path: "E:/tmp/pasted.png",
    src: "asset://pasted.png",
    alt: "图片",
  });

  assert.deepEqual(result.blocks, [
    { id: "text-1", type: "text", text: "上方文字" },
    { id: "image-1", type: "image", path: "E:/tmp/pasted.png", src: "asset://pasted.png", alt: "图片" },
    { id: "text-1-after-image-1", type: "text", text: "下方文字" },
  ]);
  assert.equal(result.focusBlockId, "text-1-after-image-1");
});

test("serializes mixed editor blocks into rich HTML for F8 output", () => {
  const html = serializeQuickPasteEditorBlocks([
    { id: "text-1", type: "text", text: "上方文字" },
    { id: "image-1", type: "image", path: "E:/tmp/pasted.png", src: "asset://pasted.png", alt: "图片" },
    { id: "text-2", type: "text", text: "下方文字" },
  ]);

  assert.equal(html, '<p>上方文字</p><p><img src="E:/tmp/pasted.png" alt="图片"></p><p>下方文字</p>');
});

test("normalizes rich HTML back into text and image blocks", () => {
  const blocks = normalizeQuickPasteEditorBlocks(
    {
      id: "snippet-1",
      title: "图文",
      category: "rich",
      content: '<p>上方文字</p><p><img src="E:/tmp/pasted.png" alt="图片"></p><p>下方文字</p>',
    },
    { resolveImageSrc: (src) => `resolved:${src}` },
  );

  assert.deepEqual(blocks, [
    { id: "snippet-1-text-0", type: "text", text: "上方文字" },
    { id: "snippet-1-image-1", type: "image", path: "E:/tmp/pasted.png", src: "resolved:E:/tmp/pasted.png", alt: "图片" },
    { id: "snippet-1-text-2", type: "text", text: "下方文字" },
  ]);
});

test("normalizes image snippets with editable text below the image", () => {
  const blocks = normalizeQuickPasteEditorBlocks(
    {
      id: "snippet-image",
      title: "截图",
      category: "image",
      content: "E:/tmp/screenshot.png",
    },
    { resolveImageSrc: (src) => `resolved:${src}` },
  );

  assert.deepEqual(blocks, [
    { id: "snippet-image-image-0", type: "image", path: "E:/tmp/screenshot.png", src: "resolved:E:/tmp/screenshot.png", alt: "截图" },
    { id: "snippet-image-text-after-image-0", type: "text", text: "" },
  ]);
});

test("normalizes rich HTML ending with an image with editable text below it", () => {
  const blocks = normalizeQuickPasteEditorBlocks(
    {
      id: "snippet-rich-image-end",
      title: "图文",
      category: "rich",
      content: '<p>上方文字</p><p><img src="E:/tmp/pasted.png" alt="图片"></p>',
    },
    { resolveImageSrc: (src) => `resolved:${src}` },
  );

  assert.deepEqual(blocks, [
    { id: "snippet-rich-image-end-text-0", type: "text", text: "上方文字" },
    { id: "snippet-rich-image-end-image-1", type: "image", path: "E:/tmp/pasted.png", src: "resolved:E:/tmp/pasted.png", alt: "图片" },
    { id: "snippet-rich-image-end-text-after-image-1", type: "text", text: "" },
  ]);
});
