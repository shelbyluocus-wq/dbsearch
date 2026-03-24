export const APP_BASE_NAME = "鹰捷";

export function formatAppDisplayTitle(version) {
  const normalizedVersion = typeof version === "string" ? version.trim() : "";
  return normalizedVersion ? `${APP_BASE_NAME}V${normalizedVersion}` : APP_BASE_NAME;
}
