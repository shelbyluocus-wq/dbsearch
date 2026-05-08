# Update Download Progress Design

## Goal

When startup auto-update finds a new version and the user chooses “立即更新”, show the existing update dialog so the download progress bar is visible during `downloadAndInstall()`.

## Current behavior

Manual update checks and panel-window update checks open the existing “发现新版本” dialog. That dialog already renders `updateProgress` with percent and byte counts while `updateInstalling` is true. Startup auto-update uses a system confirmation dialog and then calls `installAvailableUpdate()` directly, so the download happens without visible progress.

## Design

Keep the startup confirmation prompt unchanged. If the user confirms, open the existing update dialog before starting installation:

- Set `updateDialogOpen` to true after confirmation.
- Reset `updateProgress` before installation begins.
- Call `installAvailableUpdate()` so the existing `downloadAndInstall()` callback continues to update `updateProgress`.
- Keep the dialog non-closable during installation through the existing `updateInstalling` guards.
- On failure, leave the dialog open with the existing error text and manual-download button.
- On success, keep the existing completion toast and relaunch behavior.

## Testing

Run the existing update manager unit tests to cover progress reduction behavior:

```bash
node --test src/updateManager.test.js
```

For UI verification, start the desktop app and exercise an update path or simulate an available update enough to confirm the existing dialog opens and the progress card appears after confirming startup auto-update.
