function toPositiveInteger(value, fallback = 1) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function getSeamlessBlockNumber({ rowIndex = 0, blockSize = 150 } = {}) {
  const size = toPositiveInteger(blockSize, 150);
  const index = Math.max(0, Math.floor(Number(rowIndex) || 0));
  return Math.floor(index / size) + 1;
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

export function pruneSeamlessBlocks({ blocks = new Map(), centerBlock = 1, radius = 1 } = {}) {
  const center = toPositiveInteger(centerBlock, 1);
  const keepRadius = Math.max(0, Math.floor(Number(radius) || 0));
  return new Map(
    [...blocks.entries()].filter(([block]) => Math.abs(Number(block) - center) <= keepRadius),
  );
}
