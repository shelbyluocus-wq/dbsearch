export const APP_INSTALL_NAME = "鹰捷";

export function resolveSettingsVersionLabel(version) {
  return typeof version === "string" ? version.trim() : "";
}

export function formatAppDisplayTitle(version) {
  const normalizedVersion = resolveSettingsVersionLabel(version);
  return normalizedVersion ? `${APP_INSTALL_NAME}V${normalizedVersion}` : APP_INSTALL_NAME;
}
