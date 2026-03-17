import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("json", json);

const SUPPORTED_LANGUAGES = new Set([
  "auto",
  "plaintext",
  "javascript",
  "typescript",
  "python",
  "json",
]);

export function normalizeCellViewerLanguage(language) {
  const normalized = String(language || "").trim().toLowerCase();
  if (normalized === "js") return "javascript";
  if (normalized === "ts") return "typescript";
  if (normalized === "py") return "python";
  if (SUPPORTED_LANGUAGES.has(normalized)) return normalized;
  return "auto";
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tryFormatJson(text) {
  const source = String(text || "");
  const trimmed = source.trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

export function detectCellViewerLanguage(text) {
  const source = String(text || "");
  const trimmed = source.trim();
  if (!trimmed) return "plaintext";

  if (tryFormatJson(trimmed) !== null) {
    return "json";
  }

  if (
    /(^|\n)\s*def\s+\w+\s*\(/.test(trimmed) ||
    /(^|\n)\s*class\s+\w+\s*[:(]/.test(trimmed) ||
    /\bimport\s+\w+/.test(trimmed) ||
    /\bfrom\s+\w+(?:\.\w+)*\s+import\b/.test(trimmed)
  ) {
    return "python";
  }

  if (
    /\binterface\s+\w+/.test(trimmed) ||
    /\btype\s+\w+\s*=/.test(trimmed) ||
    /\b(enum|implements)\b/.test(trimmed) ||
    /:\s*[A-Z_a-z][\w<>\[\]\s|&,?:]*(?=[=;,)])/m.test(trimmed)
  ) {
    return "typescript";
  }

  if (
    /\b(const|let|var|function|return|export|import)\b/.test(trimmed) ||
    /=>/.test(trimmed)
  ) {
    return "javascript";
  }

  return "plaintext";
}

export function buildCellViewerPreview({ text, manualLanguage = "auto" } = {}) {
  const source = String(text ?? "");
  const detectedLanguage = detectCellViewerLanguage(source);
  const normalizedManualLanguage = normalizeCellViewerLanguage(manualLanguage);
  const activeLanguage = normalizedManualLanguage === "auto"
    ? detectedLanguage
    : normalizedManualLanguage;
  const formattedJson = detectedLanguage === "json" ? tryFormatJson(source) : null;
  const previewText = formattedJson ?? source;

  let html = escapeHtml(previewText);
  if (activeLanguage !== "plaintext" && activeLanguage !== "auto") {
    try {
      html = hljs.highlight(previewText, { language: activeLanguage, ignoreIllegals: true }).value;
    } catch {
      html = escapeHtml(previewText);
    }
  }

  return {
    detectedLanguage,
    activeLanguage,
    previewText,
    html,
    isFormattedJson: formattedJson !== null,
  };
}
