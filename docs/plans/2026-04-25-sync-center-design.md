# Sync Center Design

## Goal

Unify file sync and database sync behind one visible entry, then let users switch between the two existing workspaces inside a single page.

## Entry

The pet menu will expose one action named "同步中心". The old visible "文件同步" and "数据库同步" actions will be removed from the menu. Legacy backend commands can remain for compatibility, but the product surface should guide users through only the unified entry.

## Page Structure

The existing `sync_workspace` window becomes the sync center. Its toolbar keeps the traffic-light controls, adds a segmented switch for "文件同步" and "数据库同步", and exposes one log icon at the right. The file-sync page keeps its current profile sidebar and execution form. The database-sync workspace is embedded into the same shell without its standalone toolbar.

## Log Drawer

Logs are hidden by default. Clicking the log icon opens a right-side drawer. When the active workspace is running, the drawer opens automatically. The drawer occupies real layout width, so the active UI compresses left instead of being covered. Inline log details are hidden in the unified page.

## Weather Background

The sync center uses four visual themes: sunny, cloudy, rainy, and snowy. Weather motion is implemented as a separate background layer with conservative CSS animation and a reduced-motion fallback. During QA, dynamic motion should be kept only if it improves the interface without blur, distraction, or performance problems; otherwise the same theme art remains mostly static.

## Testing

Unit tests should cover the unified menu action, sync-center tab fallback, log-drawer visibility, and weather theme normalization. Build verification should confirm the Vue/Tauri bundle still compiles.
