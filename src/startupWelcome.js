export const DEFAULT_STARTUP_WELCOME_TEXT = "Louis";
export const STARTUP_WELCOME_TEXT_MAX_LENGTH = 12;
export const DEFAULT_STARTUP_WELCOME_MODE = "handwriting";
export const STARTUP_WELCOME_MODES = Object.freeze([
  "handwriting",
  "stroke_order",
]);

export function normalizeStartupWelcomeText(
  value,
  maxLength = STARTUP_WELCOME_TEXT_MAX_LENGTH,
) {
  const normalized = typeof value === "string" ? value.trim() : "";
  const fallback = DEFAULT_STARTUP_WELCOME_TEXT;
  const text = normalized || fallback;
  const limit = Number.isFinite(maxLength) ? Math.max(1, Math.floor(maxLength)) : STARTUP_WELCOME_TEXT_MAX_LENGTH;
  return text.slice(0, limit);
}

export function normalizeStartupWelcomeMode(value) {
  return STARTUP_WELCOME_MODES.includes(value) ? value : DEFAULT_STARTUP_WELCOME_MODE;
}

export function buildStartupWelcomeStrokeOrderGlyphs(
  value,
  {
    centerX = 360,
    maxWidth = 560,
    delayStepMs = 180,
  } = {},
) {
  const chars = [...normalizeStartupWelcomeText(value)];
  const spacing = chars.length <= 1
    ? 0
    : Math.min(86, maxWidth / Math.max(1, chars.length - 1));
  const startX = centerX - (spacing * (chars.length - 1)) / 2;

  return chars.map((char, index) => ({
    id: `${index}-${char.codePointAt(0)}`,
    char,
    x: Math.round((startX + spacing * index) * 100) / 100,
    delayMs: index * delayStepMs,
  }));
}
