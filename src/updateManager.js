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
