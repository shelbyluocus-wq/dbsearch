function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function decodeHtml(value) {
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function getAttribute(markup, name) {
  const match = String(markup).match(new RegExp(`${name}=["']([^"']*)["']`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function normalizeSelection(text, selectionStart, selectionEnd) {
  const length = text.length;
  const start = Math.max(0, Math.min(length, Number(selectionStart) || 0));
  const end = Math.max(start, Math.min(length, Number(selectionEnd) || start));
  return { start, end };
}

function plainTextToEditorHtml(text) {
  const lines = String(text || "").split(/\r?\n/);
  if (lines.length === 0) return "<p><br></p>";
  return lines
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>"))
    .join("") || "<p><br></p>";
}

function normalizeEditorImageMarkup(markup, resolveImageSrc) {
  const path = getAttribute(markup, "data-path") || getAttribute(markup, "src");
  const alt = getAttribute(markup, "alt") || "图片";
  if (!path) return "";
  return `<img src="${escapeAttribute(resolveImageSrc(path))}" data-path="${escapeAttribute(path)}" alt="${escapeAttribute(alt)}">`;
}

function isEmptyEditorHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?\s*>/gi, "")
    .replace(/&nbsp;/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim().length === 0 && !/<img\b/i.test(String(html || ""));
}

function normalizeRichImagesForEditorHtml(content, resolveImageSrc) {
  const html = String(content || "");
  const normalized = html.replace(/<img\b[^>]*>/gi, (markup) => normalizeEditorImageMarkup(markup, resolveImageSrc));
  return normalized || "<p><br></p>";
}

function ensureTrailingEditableParagraph(html) {
  if (/<img\b[^>]*>\s*(?:<\/p>)?\s*$/i.test(String(html || "").trim())) {
    return `${html}<p><br></p>`;
  }
  return html;
}

function serializeEditorImageMarkup(markup) {
  const path = getAttribute(markup, "data-path") || getAttribute(markup, "src");
  const alt = getAttribute(markup, "alt") || "图片";
  if (!path) return "";
  return `<img src="${escapeAttribute(path)}" alt="${escapeAttribute(alt)}">`;
}

function trimTrailingEmptyParagraphs(html) {
  const trimmed = String(html || "").replace(/(?:<p>(?:\s|&nbsp;|<br\s*\/?\s*>)*<\/p>\s*)+$/gi, "");
  return trimmed || "<p><br></p>";
}

export function normalizeQuickPasteEditorHtml(snippet, options = {}) {
  const resolveImageSrc = typeof options.resolveImageSrc === "function" ? options.resolveImageSrc : (src) => src;
  const content = String(snippet?.content || "");

  if (snippet?.category === "image") {
    if (!content) return "<p><br></p>";
    const alt = String(snippet?.title || "图片");
    return `<p><img src="${escapeAttribute(resolveImageSrc(content))}" data-path="${escapeAttribute(content)}" alt="${escapeAttribute(alt)}"></p><p><br></p>`;
  }

  if (snippet?.category !== "rich") {
    return plainTextToEditorHtml(content);
  }

  if (isEmptyEditorHtml(content)) return "";

  return ensureTrailingEditableParagraph(normalizeRichImagesForEditorHtml(content, resolveImageSrc));
}

export function serializeQuickPasteEditorHtml(html) {
  const withoutInlineStyles = String(html || "").replace(/\sstyle=["'][^"']*["']/gi, "");
  const normalized = withoutInlineStyles.replace(/<img\b[^>]*>/gi, serializeEditorImageMarkup);
  return trimTrailingEmptyParagraphs(normalized);
}

function appendTrailingTextBlockAfterImage(blocks, snippetId) {
  const last = blocks[blocks.length - 1];
  if (last?.type === "image") {
    blocks.push({ id: `${snippetId}-text-after-${last.id.split(`${snippetId}-`).pop()}`, type: "text", text: "" });
  }
  return blocks;
}

export function insertImageBlockAtTextSelection(blocks, textBlockId, selectionStart, selectionEnd, imageBlock) {
  const result = [];
  let focusBlockId = "";
  let inserted = false;

  for (const block of blocks) {
    if (!inserted && block?.type === "text" && block.id === textBlockId) {
      const text = String(block.text || "");
      const { start, end } = normalizeSelection(text, selectionStart, selectionEnd);
      const afterBlockId = `${block.id}-after-${imageBlock.id}`;

      result.push({ ...block, text: text.slice(0, start) });
      result.push({ ...imageBlock, type: "image" });
      result.push({ id: afterBlockId, type: "text", text: text.slice(end) });
      focusBlockId = afterBlockId;
      inserted = true;
    } else {
      result.push(block);
    }
  }

  if (!inserted) {
    result.push({ ...imageBlock, type: "image" });
    focusBlockId = "";
  }

  return { blocks: result, focusBlockId };
}

export function serializeQuickPasteEditorBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .map((block) => {
      if (block?.type === "image") {
        const src = block.path || block.src || "";
        if (!src) return "";
        return `<p><img src="${escapeAttribute(src)}" alt="${escapeAttribute(block.alt || "图片")}"></p>`;
      }

      const text = String(block?.text || "");
      if (!text) return "";
      return text
        .split(/\r?\n/)
        .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>"))
        .join("");
    })
    .join("");
}

export function normalizeQuickPasteEditorBlocks(snippet, options = {}) {
  const resolveImageSrc = typeof options.resolveImageSrc === "function" ? options.resolveImageSrc : (src) => src;
  const snippetId = String(snippet?.id || "snippet");
  const content = String(snippet?.content || "");
  const blocks = [];
  const paragraphRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  let index = 0;

  if (snippet?.category === "image") {
    const path = content;
    return appendTrailingTextBlockAfterImage([
      { id: `${snippetId}-image-0`, type: "image", path, src: resolveImageSrc(path), alt: String(snippet?.title || "图片") },
    ], snippetId);
  }

  if (snippet?.category !== "rich") {
    return [{ id: `${snippetId}-text-0`, type: "text", text: content }];
  }

  while ((match = paragraphRe.exec(content))) {
    const body = match[1];
    const imageMatch = body.match(/<img\b[^>]*>/i);

    if (imageMatch) {
      const imageMarkup = imageMatch[0];
      const path = getAttribute(imageMarkup, "data-path") || getAttribute(imageMarkup, "src");
      blocks.push({
        id: `${snippetId}-image-${index}`,
        type: "image",
        path,
        src: resolveImageSrc(path),
        alt: getAttribute(imageMarkup, "alt") || "图片",
      });
    } else {
      blocks.push({
        id: `${snippetId}-text-${index}`,
        type: "text",
        text: decodeHtml(body),
      });
    }

    index += 1;
  }

  if (blocks.length === 0) {
    const imageMatch = content.match(/<img\b[^>]*>/i);
    if (imageMatch) {
      const path = getAttribute(imageMatch[0], "data-path") || getAttribute(imageMatch[0], "src");
      return appendTrailingTextBlockAfterImage([
        { id: `${snippetId}-image-0`, type: "image", path, src: resolveImageSrc(path), alt: getAttribute(imageMatch[0], "alt") || "图片" },
      ], snippetId);
    }
    return [{ id: `${snippetId}-text-0`, type: "text", text: decodeHtml(content) }];
  }

  return appendTrailingTextBlockAfterImage(blocks, snippetId);
}
