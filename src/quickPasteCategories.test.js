import test from "node:test";
import assert from "node:assert/strict";

import {
  getQuickPasteCategoryCount,
  getQuickPasteSnippetKind,
  isQuickPasteMixedSnippet,
  isQuickPasteTextLikeSnippet,
} from "./quickPasteCategories.js";

test("counts rich snippets as text category items", () => {
  const snippets = [
    { id: "1", category: "text" },
    { id: "2", category: "rich" },
    { id: "3", category: "image" },
  ];

  assert.equal(isQuickPasteTextLikeSnippet(snippets[1]), true);
  assert.equal(getQuickPasteCategoryCount(snippets, "text"), 2);
});

test("counts all, image, and favorite quick paste categories", () => {
  const snippets = [
    { id: "1", category: "text", favorite: true },
    { id: "2", category: "rich", favorite: false },
    { id: "3", category: "image", favorite: true },
  ];

  assert.equal(getQuickPasteCategoryCount(snippets, "all"), 3);
  assert.equal(getQuickPasteCategoryCount(snippets, "image"), 1);
  assert.equal(getQuickPasteCategoryCount(snippets, "favorite"), 2);
});

test("classifies rich snippets with both image and visible text as mixed", () => {
  const mixed = { id: "1", category: "rich", content: "<p><img src=\"a.png\"></p><p>说明文字</p>" };
  const imageOnly = { id: "2", category: "rich", content: "<p><img src=\"a.png\"></p><p><br></p>" };
  const textOnly = { id: "3", category: "rich", content: "<p>只有文字</p>" };

  assert.equal(getQuickPasteSnippetKind(mixed), "mixed");
  assert.equal(isQuickPasteMixedSnippet(mixed), true);
  assert.equal(getQuickPasteSnippetKind(imageOnly), "image");
  assert.equal(getQuickPasteSnippetKind(textOnly), "text");
});

test("counts mixed snippets in the mixed category without inflating text or image counts", () => {
  const snippets = [
    { id: "1", category: "rich", content: "<p><img src=\"a.png\"></p><p>说明文字</p>" },
    { id: "2", category: "rich", content: "<p>只有文字</p>" },
    { id: "3", category: "image", content: "a.png" },
  ];

  assert.equal(getQuickPasteCategoryCount(snippets, "mixed"), 1);
  assert.equal(getQuickPasteCategoryCount(snippets, "text"), 1);
  assert.equal(getQuickPasteCategoryCount(snippets, "image"), 1);
});
