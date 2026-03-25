export const APP_INSTALL_NAME = "鹰捷";

export function formatAppDisplayTitle(version) {
  const normalizedVersion = typeof version === "string" ? version.trim() : "";
  return normalizedVersion ? `${APP_INSTALL_NAME}V${normalizedVersion}` : APP_INSTALL_NAME;
}
