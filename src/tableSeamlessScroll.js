function toPositiveInteger(value, fallback = 1) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function toNonNegativeInteger(value, fallback = 0) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

export function getSeamlessBlockNumber({ rowIndex = 0, blockSize = 150 } = {}) {
  const size = toPositiveInteger(blockSize, 150);
  const index = Math.max(0, Math.floor(Number(rowIndex) || 0));
  return Math.floor(index / size) + 1;
}

export function shouldUseSeamlessTableView({
  tableOpen = false,
  tableDetailView = "hits",
  editMode = false,
  dataCollapsed = false,
} = {}) {
  return !!tableOpen && tableDetailView === "full" && !dataCollapsed;
}

export function buildSeamlessRows({ blocks = new Map(), blockSize = 150 } = {}) {
  const size = toPositiveInteger(blockSize, 150);
  return [...blocks.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .flatMap(([block, rows]) => {
      const blockNumber = toPositiveInteger(block, 1);
      const blockStart = (blockNumber - 1) * size;
      return (Array.isArray(rows) ? rows : []).map((row, localIndex) => ({
        row,
        globalIndex: blockStart + localIndex + 1,
        block: blockNumber,
        localIndex,
      }));
    });
}

export function buildSeamlessViewport({
  blocks = new Map(),
  blockSize = 150,
  totalRows = 0,
  rowHeight = 31,
  scrollTop = 0,
  clientHeight = 0,
  cacheRadius = 1,
} = {}) {
  const size = toPositiveInteger(blockSize, 150);
  const total = toNonNegativeInteger(totalRows, 0);
  const rowPx = toPositiveInteger(rowHeight, 31);
  const totalBlocks = total > 0 ? Math.ceil(total / size) : 0;
  const maxRowIndex = Math.max(0, total - 1);
  const visibleStartIndex = Math.min(
    maxRowIndex,
    Math.max(0, Math.floor((Number(scrollTop) || 0) / rowPx)),
  );
  const targetBlock = totalBlocks > 0
    ? Math.min(totalBlocks, getSeamlessBlockNumber({ rowIndex: visibleStartIndex, blockSize: size }))
    : 1;
  const radius = Math.max(0, Math.floor(Number(cacheRadius) || 0));
  const blocksToLoad = [];
  let renderFromBlock = targetBlock;
  let renderToBlock = targetBlock;

  if (totalBlocks > 0) {
    const visibleEndIndex = Math.min(
      maxRowIndex,
      Math.max(visibleStartIndex, Math.ceil(((Number(scrollTop) || 0) + (Number(clientHeight) || 0)) / rowPx)),
    );
    const endBlock = Math.min(totalBlocks, getSeamlessBlockNumber({ rowIndex: visibleEndIndex, blockSize: size }));
    renderFromBlock = Math.max(1, Math.min(targetBlock, endBlock) - radius);
    renderToBlock = Math.min(totalBlocks, Math.max(targetBlock, endBlock) + radius);
    for (let block = renderFromBlock; block <= renderToBlock; block += 1) {
      blocksToLoad.push(block);
    }
  }

  const rows = [];
  for (let block = renderFromBlock; block <= renderToBlock; block += 1) {
    const blockRows = blocks instanceof Map ? blocks.get(block) : null;
    if (!Array.isArray(blockRows)) continue;
    const blockStart = (block - 1) * size;
    blockRows.forEach((row, localIndex) => {
      const globalIndex = blockStart + localIndex + 1;
      if (globalIndex <= total) {
        rows.push({ row, globalIndex, block, localIndex });
      }
    });
  }
  const firstGlobalIndex = rows[0]?.globalIndex ?? null;
  const lastGlobalIndex = rows.length > 0 ? rows[rows.length - 1].globalIndex : null;
  const unloadedWindowStartRows = totalBlocks > 0 ? Math.max(0, (renderFromBlock - 1) * size) : 0;
  const unloadedWindowEndRows = totalBlocks > 0 ? Math.max(0, total - unloadedWindowStartRows) : total;
  const topSpacerRows = firstGlobalIndex === null ? unloadedWindowStartRows : Math.max(0, firstGlobalIndex - 1);
  const bottomSpacerRows = lastGlobalIndex === null ? unloadedWindowEndRows : Math.max(0, total - lastGlobalIndex);

  return {
    rows,
    targetBlock,
    blocksToLoad,
    topSpacerRows,
    topSpacerHeight: topSpacerRows * rowPx,
    bottomSpacerRows,
    bottomSpacerHeight: bottomSpacerRows * rowPx,
    totalBlocks,
  };
}

export function shouldLoadNextSeamlessBlock({
  scrollTop = 0,
  clientHeight = 0,
  scrollHeight = 0,
  thresholdPx = 320,
  loading = false,
  highestLoadedBlock = 0,
  totalBlocks = 0,
} = {}) {
  if (loading) return false;
  if (Number(highestLoadedBlock) >= Number(totalBlocks)) return false;
  return Number(scrollTop) + Number(clientHeight) >= Number(scrollHeight) - Number(thresholdPx);
}

export function shouldLoadPreviousSeamlessBlock({
  scrollTop = 0,
  thresholdPx = 320,
  loading = false,
  lowestLoadedBlock = 1,
} = {}) {
  if (loading) return false;
  if (Number(lowestLoadedBlock) <= 1) return false;
  return Number(scrollTop) <= Number(thresholdPx);
}

export function pruneSeamlessBlocks({ blocks = new Map(), centerBlock = 1, radius = 1, keep = [] } = {}) {
  const center = toPositiveInteger(centerBlock, 1);
  const keepRadius = Math.max(0, Math.floor(Number(radius) || 0));
  const keepSet = new Set((Array.isArray(keep) ? keep : []).map(Number));
  return new Map(
    [...blocks.entries()].filter(([block]) => keepSet.has(Number(block)) || Math.abs(Number(block) - center) <= keepRadius),
  );
}
