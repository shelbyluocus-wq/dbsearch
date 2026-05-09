import { markRaw } from "vue";

export const UPDATE_CHECK_TIMEOUT_MS = 120000;
export const UPDATE_CHECK_MAX_ATTEMPTS = 10;

export async function checkForUpdateWithRetry(
  checkForUpdate,
  {
    timeout = UPDATE_CHECK_TIMEOUT_MS,
    maxAttempts = UPDATE_CHECK_MAX_ATTEMPTS,
  } = {},
) {
  const attempts = Number.isFinite(maxAttempts)
    ? Math.max(1, Math.floor(maxAttempts))
    : UPDATE_CHECK_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await checkForUpdate({ timeout });
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
    }
  }

  return null;
}

function normalizeIsoTimestamp(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;

  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;

  return new Date(timestamp).toISOString();
}

function normalizeNow(now = Date.now()) {
  if (typeof now === "string") {
    const parsed = Date.parse(now);
    if (Number.isFinite(parsed)) return new Date(parsed);
  }

  if (typeof now === "number" && Number.isFinite(now)) {
    return new Date(now);
  }

  return new Date();
}

export function normalizeUpdateSettings(personal = {}) {
  return {
    autoCheckUpdates: personal?.auto_check_updates !== false,
    lastUpdateCheckAt: normalizeIsoTimestamp(personal?.last_update_check_at),
  };
}

export function shouldAutoRunStartupUpdateCheck({
  isTauriWindow = false,
  windowLabel = "",
} = {}) {
  return Boolean(isTauriWindow && windowLabel === "main");
}

export function shouldOpenUpdateDialogForInstall({
  manual = false,
  isPanelWindow = false,
  userConfirmedInstall = false,
} = {}) {
  return Boolean(userConfirmedInstall && !manual && !isPanelWindow);
}

export function preserveOpaqueInstance(value) {
  if (value && typeof value === "object") {
    return markRaw(value);
  }

  return value;
}

export function normalizeUpdateVersion(value) {
  return String(value || "").trim().replace(/^[vV]/, "").trim();
}

function normalizeReleaseNotesText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function splitReleaseNotes(notes) {
  const lines = normalizeReleaseNotesText(notes)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length > 0 ? lines : ["本次更新未提供详细说明。"];
}

export function normalizeUpdateAnnouncement(value = {}) {
  const version = normalizeUpdateVersion(value?.version);
  if (!version) return null;

  return {
    version,
    notes: normalizeReleaseNotesText(value?.notes ?? value?.body ?? ""),
    pubDate: normalizeIsoTimestamp(value?.pubDate ?? value?.pub_date ?? value?.date),
  };
}

export function buildPendingUpdateAnnouncement(update = {}, fallbackNotes = "") {
  return normalizeUpdateAnnouncement({
    version: update?.version,
    notes: update?.body ?? update?.rawJson?.notes ?? fallbackNotes,
    pubDate: update?.date ?? update?.rawJson?.pub_date ?? update?.rawJson?.pubDate ?? update?.rawJson?.date,
  });
}

export function resolvePostUpdateAnnouncement({
  currentVersion = "",
  pendingAnnouncement = null,
  acknowledgedVersion = "",
} = {}) {
  const current = normalizeUpdateVersion(currentVersion);
  if (!current) return null;

  const pending = normalizeUpdateAnnouncement(pendingAnnouncement);
  if (!pending || pending.version !== current) return null;
  if (normalizeUpdateVersion(acknowledgedVersion) === current) return null;

  const notesLines = splitReleaseNotes(pending.notes);
  return {
    ...pending,
    notes: pending.notes || notesLines.join("\n"),
    notesLines,
  };
}

export function resolveUpdateCheckPlan({
  settings = normalizeUpdateSettings(),
  now = Date.now(),
  manual = false,
  intervalMs = 0,
} = {}) {
  const nowDate = normalizeNow(now);
  const checkedAt = nowDate.toISOString();

  if (manual) {
    return {
      shouldCheck: true,
      reason: "manual",
      checkedAt,
      intervalMs,
    };
  }

  if (settings?.autoCheckUpdates === false) {
    return {
      shouldCheck: false,
      reason: "startup-disabled",
      checkedAt: null,
      intervalMs,
    };
  }

  return {
    shouldCheck: true,
    reason: "startup-due",
    checkedAt,
    intervalMs,
  };
}

export function summarizeReleaseNotes(notes, maxLength = 220) {
  const normalized = String(notes || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  if (!normalized) {
    return "本次更新未提供详细说明。";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function reduceUpdateDownloadProgress(
  current = {
    status: "idle",
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  },
  event = {},
) {
  if (event?.event === "Started") {
    const totalBytes = Number(event?.data?.contentLength) || 0;
    return {
      status: "downloading",
      downloadedBytes: 0,
      totalBytes,
      percent: 0,
    };
  }

  if (event?.event === "Progress") {
    const downloadedBytes = current.downloadedBytes + (Number(event?.data?.chunkLength) || 0);
    const totalBytes = Number(current.totalBytes) || 0;
    const percent = totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      : 0;

    return {
      status: "downloading",
      downloadedBytes,
      totalBytes,
      percent,
    };
  }

  if (event?.event === "Finished") {
    return {
      status: "finished",
      downloadedBytes: current.downloadedBytes,
      totalBytes: current.totalBytes,
      percent: current.totalBytes > 0 ? 100 : current.percent,
    };
  }

  return { ...current };
}
