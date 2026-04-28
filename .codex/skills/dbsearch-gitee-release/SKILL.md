---
name: dbsearch-gitee-release
description: Use when publishing DBSearch/EagleJet/鹰捷 Windows desktop updates to Gitee, creating Tauri updater releases, bumping app versions, generating signed Windows installers, updating latest.json manifests, or verifying Gitee release download links.
---

# DBSearch Gitee Release

## Overview

Publish 鹰捷 desktop updates through the Tauri updater path: local version sync, signed Windows installer, Gitee release attachment, Gitee `latest.json`, then remote download verification.

## Preconditions

- Work from the DBSearch repo, normally `E:\project\dbsearch`.
- Confirm the Gitee release repo is `shelbylouis/dbsearch-release`.
- Confirm the signing private key is available at `C:\Users\Administrator\.tauri\dbsearch.key`, or `TAURI_SIGNING_PRIVATE_KEY` is set. If the key has a password, provide `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` or a `.password` sidecar.
- Use real Chrome / Chrome DevTools for Gitee UI when the user asks for Gitee publishing. Do not rely on an unauthenticated `git push` unless credentials are already working.

## Remote Publishing Constraint

- Remote Gitee publishing must be done through the authenticated Gitee website in real Chrome only.
- Do not use `git commit`, `git push`, temporary clones, Gitee API calls, or any CLI remote write path for the release repo.
- Do not run any command that may open a desktop credential/login prompt for Git, Gitee, or account passwords.
- Local CLI commands are allowed only for local version sync, building, signing, reading artifacts, and verification.
- If the Gitee web editor or release upload cannot complete through the browser, stop and ask the user to intervene in the webpage; do not fall back to Git.

## Release Flow

1. Inspect current state:
   - `git status --short --branch`
   - Read `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src/appVersion.js`, and the version section in `src/App.vue`.
   - Confirm settings version comes from `package.json -> src/appVersion.js -> APP_VERSION/VERSION_DISPLAY_LABEL -> settings version card`.

2. Bump the version:
   - Run `npm run release:prepare -- <version>`.
   - Verify `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` match.
   - If PowerShell rewrites JSON spacing noisily, reformat `package.json` with `JSON.stringify(data, null, 4)`.

3. Build signed artifacts:
   - Run `npm run build:signed`.
   - Expected artifacts live in `src-tauri/target/release/bundle/nsis/`:
     - `鹰捷_<version>_x64-setup.exe`
     - `鹰捷_<version>_x64-setup.exe.sig`
   - Read the `.sig` file; its exact trimmed content is the updater `signature`.

4. Create the Gitee release:
   - Open `https://gitee.com/shelbylouis/dbsearch-release/releases` in real Chrome.
   - Create tag `v<version>`, title `鹰捷 V<version>`.
   - Upload the `.exe` installer as the release attachment.
   - Publish and confirm the release page exposes a download link like:
     `https://gitee.com/shelbylouis/dbsearch-release/releases/download/v<version>/%E9%B9%B0%E6%8D%B7_<version>_x64-setup.exe`

5. Update `latest.json`:
   - Set `version` to `<version>`.
   - Set `platforms.windows-x86_64.url` to the Gitee release attachment URL.
   - Set `platforms.windows-x86_64.signature` to the `.sig` content.
   - Update `pub_date` with an ISO timestamp.
   - Publish it to Gitee `master` at repository root through the Gitee web editor only. Set Monaco via `window._editor.getModel().setValue(...)` and also update `#js-blob-content` before submitting.
   - Do not update `latest.json` through a temporary clone, `git commit`, `git push`, API call, or any non-browser remote write.

## Verification Gate

Before calling the release complete, run fresh checks and read the output:

- `npm run build`
- `node scripts/release-version-check.mjs v<version>`
- Version-related tests, at minimum:
  `node --test src/appVersion.test.js src/appIdentity.test.js src/settingsModal.test.js scripts/release-version-check.test.mjs scripts/sync-version.test.mjs scripts/release.test.mjs`
- Fetch `https://gitee.com/shelbylouis/dbsearch-release/raw/master/latest.json`, parse JSON, and assert:
  - `version` equals `<version>`
  - URL contains `/releases/download/v<version>/`
  - remote signature equals the local `.sig`
- Check the installer URL with `HEAD` or a ranged `GET`; require HTTP 200 and content length equal to the local `.exe` size.

## Common Mistakes

- Do not update `latest.json` before the release attachment is downloadable.
- Do not paste partial signatures; the signature must exactly match the `.sig` file content.
- Do not sign with a different private key unless the installed app already trusts the matching public key in `tauri.conf.json`.
- Do not trust a Gitee page view alone; verify raw `latest.json` and the final redirected download URL.
