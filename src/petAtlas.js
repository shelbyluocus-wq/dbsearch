export const CODEX_PET_ATLAS = Object.freeze({
  width: 1536,
  height: 1872,
  cellWidth: 192,
  cellHeight: 208,
  columns: 8,
  rows: 9,
});

export const JIEDI_PET = Object.freeze({
  id: "jiedi",
  displayName: "Jiedi",
  description: "A chibi pixel-art basketball boy pet inspired by Jiedi in a white basketball uniform.",
  spritesheetPath: "spritesheet.webp",
});

export const CODEX_PET_STATES = Object.freeze([
  { id: "idle", row: 0, frames: 6, durations: [280, 110, 110, 140, 140, 320], label: "待机" },
  { id: "running-right", row: 1, frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220], label: "向右跑" },
  { id: "running-left", row: 2, frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220], label: "向左跑" },
  { id: "waving", row: 3, frames: 4, durations: [140, 140, 140, 280], label: "挥手" },
  { id: "jumping", row: 4, frames: 5, durations: [140, 140, 140, 140, 280], label: "跳跃" },
  { id: "failed", row: 5, frames: 8, durations: [140, 140, 140, 140, 140, 140, 140, 240], label: "失败" },
  { id: "waiting", row: 6, frames: 6, durations: [180, 180, 180, 180, 180, 260], label: "等待" },
  { id: "running", row: 7, frames: 6, durations: [120, 120, 120, 120, 120, 220], label: "运行中" },
  { id: "review", row: 8, frames: 6, durations: [150, 150, 150, 150, 150, 280], label: "检查" },
]);

export const CODEX_PET_STATE_BY_ID = Object.freeze(
  Object.fromEntries(CODEX_PET_STATES.map((state) => [state.id, state])),
);

export function normalizePetSkin(value) {
  return String(value || "").trim() === JIEDI_PET.id ? JIEDI_PET.id : JIEDI_PET.id;
}

export function normalizePetState(value) {
  const id = String(value || "").trim();
  return CODEX_PET_STATE_BY_ID[id] ? id : "idle";
}

export function resolvePetState({
  dragging = false,
  dragDirection = "",
  fallbackDragDirection = "",
  searching = false,
  found = false,
  failed = false,
  idleActive = false,
  idleKind = "",
} = {}) {
  if (failed) return "failed";
  if (found) return "waving";
  if (dragging) {
    if (dragDirection === "left") return "running-left";
    if (dragDirection === "right") return "running-right";
    if (fallbackDragDirection === "left") return "running-left";
    if (fallbackDragDirection === "right") return "running-right";
    return "running-right";
  }
  if (searching) return "running";
  if (idleActive && idleKind === "review") return "review";
  if (idleActive && idleKind === "waiting") return "waiting";
  return "idle";
}

export function getPetFrameStyle({ stateId, frame, imageUrl }) {
  const state = CODEX_PET_STATE_BY_ID[normalizePetState(stateId)] || CODEX_PET_STATE_BY_ID.idle;
  const column = Math.max(0, Math.min(state.frames - 1, Number(frame) || 0));
  return {
    width: `${CODEX_PET_ATLAS.cellWidth}px`,
    height: `${CODEX_PET_ATLAS.cellHeight}px`,
    backgroundImage: `url(${imageUrl})`,
    backgroundPosition: `-${column * CODEX_PET_ATLAS.cellWidth}px -${state.row * CODEX_PET_ATLAS.cellHeight}px`,
    backgroundSize: `${CODEX_PET_ATLAS.width}px ${CODEX_PET_ATLAS.height}px`,
    backgroundRepeat: "no-repeat",
  };
}
