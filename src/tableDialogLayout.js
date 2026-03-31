function toPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function resolveAdaptiveTablePageSize({
  visibleHeight,
  headerHeight,
  rowHeight,
  minRows = 1,
  maxRows = 200,
} = {}) {
  const visible = Math.round(toPositiveNumber(visibleHeight));
  const header = Math.round(toPositiveNumber(headerHeight));
  const row = Math.round(toPositiveNumber(rowHeight));
  const minimum = Math.max(1, Math.round(toPositiveNumber(minRows)) || 1);
  const maximum = Math.max(minimum, Math.round(toPositiveNumber(maxRows)) || minimum);

  if (visible <= 0 || row <= 0) return null;
  const bodyVisible = visible - header;
  if (bodyVisible <= 0) return null;

  const rows = Math.floor(bodyVisible / row);
  if (!Number.isFinite(rows) || rows <= 0) return null;

  return Math.max(minimum, Math.min(maximum, rows));
}
