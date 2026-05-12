function clonePayload(value) {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeKeyPart(value) {
  return String(value ?? "").trim().toLowerCase();
}

function buildCacheKey({ connectionKey = "", tableName = "", page = 1, pageSize = 50 } = {}) {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.max(1, Math.floor(Number(pageSize) || 50));
  return [normalizeKeyPart(connectionKey), normalizeKeyPart(tableName), safePage, safePageSize].join("");
}

function buildTablePrefix({ connectionKey = "", tableName = "" } = {}) {
  return `${normalizeKeyPart(connectionKey)}${normalizeKeyPart(tableName)}`;
}

export function createTableDataCache({ maxEntries = 80 } = {}) {
  const limit = Math.max(1, Math.floor(Number(maxEntries) || 80));
  const entries = new Map();

  function touch(key, value) {
    entries.delete(key);
    entries.set(key, value);
  }

  function prune() {
    while (entries.size > limit) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
    }
  }

  return {
    get(keyParts) {
      const key = buildCacheKey(keyParts);
      if (!entries.has(key)) return null;
      const value = entries.get(key);
      touch(key, value);
      return clonePayload(value);
    },
    set(keyParts, payload) {
      touch(buildCacheKey(keyParts), clonePayload(payload));
      prune();
    },
    clear() {
      entries.clear();
    },
    clearTable(keyParts) {
      const prefix = buildTablePrefix(keyParts);
      [...entries.keys()].forEach((key) => {
        if (key.startsWith(prefix)) entries.delete(key);
      });
    },
    size() {
      return entries.size;
    },
  };
}
