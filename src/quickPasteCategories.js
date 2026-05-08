export const QUICK_PASTE_CATEGORIES = [
  { key: "all", label: "全部", icon: "⌘" },
  { key: "text", label: "文本", icon: "▤" },
  { key: "mixed", label: "图文", icon: "◫" },
  { key: "image", label: "图片", icon: "▧" },
  { key: "favorite", label: "常用", icon: "★" },
];

function stripHtmlToVisibleText(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getQuickPasteSnippetKind(snippet) {
  const category = snippet?.category || "text";
  if (category === "image") return "image";
  if (category !== "rich") return "text";
  const html = String(snippet?.content || "");
  const hasImage = /<img\b/i.test(html);
  const hasText = stripHtmlToVisibleText(html).length > 0;
  if (hasImage && hasText) return "mixed";
  if (hasImage) return "image";
  return "text";
}

export function isQuickPasteImageSnippet(snippet) {
  return getQuickPasteSnippetKind(snippet) === "image";
}

export function isQuickPasteMixedSnippet(snippet) {
  return getQuickPasteSnippetKind(snippet) === "mixed";
}

export function isQuickPasteTextLikeSnippet(snippet) {
  return getQuickPasteSnippetKind(snippet) === "text";
}

export function getQuickPasteCategoryCount(snippets, category) {
  const items = Array.isArray(snippets) ? snippets : [];
  if (category === "all") return items.length;
  if (category === "favorite") return items.filter((snippet) => snippet.favorite).length;
  if (category === "text") return items.filter(isQuickPasteTextLikeSnippet).length;
  if (category === "mixed") return items.filter(isQuickPasteMixedSnippet).length;
  if (category === "image") return items.filter(isQuickPasteImageSnippet).length;
  return items.filter((snippet) => snippet.category === category).length;
}
