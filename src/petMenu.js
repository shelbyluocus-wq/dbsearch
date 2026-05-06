export async function runPetMenuAction(action, deps) {
  const {
    isTauriWindow,
    invoke,
    getWindowByLabel,
    setPetHiddenForSession,
  } = deps;

  try {
    if (action === "open") {
      await invoke("show_panel_window", { openSettings: false });
    } else if (action === "sync" || action === "sync_center" || action === "file_sync" || action === "db_sync") {
      await invoke("toggle_sync_workspace_window");
    } else if (action === "art_text_search") {
      await invoke("toggle_art_text_search_window");
    } else if (action === "settings") {
      await invoke("show_panel_window", { openSettings: true });
    } else if (action === "hide_pet") {
      setPetHiddenForSession?.(true);

      try {
        await invoke("hide_pet_window");
      } catch {
        // Fall through to the direct window-hide fallback below.
      }

      const mainWindow = await getWindowByLabel?.("main").catch(() => null);
      await mainWindow?.hide().catch(() => {});
    } else if (action === "exit") {
      await invoke("quit_app");
      return;
    }
  } catch {
    // Keep the pet menu responsive if any single action errors.
  } finally {
    if (isTauriWindow) {
      await invoke("hide_pet_menu").catch(() => {});
    }
  }
}
