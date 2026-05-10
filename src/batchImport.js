export function resolveBatchImportFileName(path = "") {
  const value = String(path || "");
  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || value;
}

export function resolveBatchImportTableName(path = "") {
  const fileName = resolveBatchImportFileName(path);
  return fileName.replace(/\.xlsx$/i, "");
}

export function buildBatchImportFileItems(paths = []) {
  return (Array.isArray(paths) ? paths : [])
    .filter((path) => String(path || "").trim().toLowerCase().endsWith(".xlsx"))
    .map((path) => {
      const filePath = String(path);
      return {
        id: filePath,
        path: filePath,
        fileName: resolveBatchImportFileName(filePath),
        tableName: resolveBatchImportTableName(filePath),
        selected: true,
        status: "pending",
        rowCount: 0,
        existingRows: null,
        sheetName: "",
        errors: [],
      };
    });
}

export function summarizeBatchImportSelection(items = []) {
  const selected = (Array.isArray(items) ? items : []).filter((item) => item?.selected);
  const ready = selected.filter((item) => item.status === "ready");
  const errors = selected.filter((item) => item.status === "error");
  const totalRows = ready.reduce((sum, item) => sum + Math.max(0, Number(item.rowCount) || 0), 0);

  return {
    selectedCount: selected.length,
    readyCount: ready.length,
    errorCount: errors.length,
    totalRows,
    canPreview: selected.length > 0,
    canImport: selected.length > 0 && ready.length === selected.length && errors.length === 0,
  };
}

export function toggleTableDefaultView(value) {
  return String(value || "").toLowerCase() === "full" ? "hits" : "full";
}

export function describeTableDefaultViewLabel(value) {
  return String(value || "").toLowerCase() === "full" ? "正常视图" : "TAP视图";
}
