import packageJson from "../package.json" with { type: "json" };

export const APP_PACKAGE_VERSION = typeof packageJson?.version === "string"
  ? packageJson.version.trim()
  : "";
