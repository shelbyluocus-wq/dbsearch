function normalizeFindText(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function matchTableFindEntry({
  query = "",
  exact = false,
  entryType = "data",
  text = "",
} = {}) {
  const normalizedQuery = normalizeFindText(query);
  const normalizedText = normalizeFindText(text);

  if (!normalizedQuery || !normalizedText) return false;
  if (exact && String(entryType || "").toLowerCase() === "data") {
    return normalizedText === normalizedQuery;
  }
  return normalizedText.includes(normalizedQuery);
}
