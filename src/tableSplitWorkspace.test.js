import test from "node:test";
import assert from "node:assert/strict";

import {
  createSplitWorkspace,
  createTablePane,
  focusWorkspacePane,
  splitWorkspace,
  closeWorkspacePane,
  resolveEffectiveSplitMode,
  getTableTabDisplayName,
} from "./tableSplitWorkspace.js";

test("createSplitWorkspace starts with one primary pane", () => {
  const workspace = createSplitWorkspace({
    primaryPane: createTablePane({
      id: "primary",
      tabId: "tab-1",
      instanceId: "users-1",
      viewState: { tableName: "users" },
    }),
  });

  assert.equal(workspace.splitMode, "none");
  assert.equal(workspace.activePaneId, "primary");
  assert.equal(workspace.splitRatio, 0.5);
  assert.deepEqual(workspace.panes.map((pane) => pane.id), ["primary"]);
});

test("splitWorkspace creates a secondary pane and focuses it", () => {
  const workspace = createSplitWorkspace({
    primaryPane: createTablePane({
      id: "primary",
      tabId: "tab-1",
      instanceId: "users-1",
      viewState: { tableName: "users" },
    }),
  });

  const next = splitWorkspace({
    workspace,
    mode: "vertical",
    pane: createTablePane({
      id: "secondary",
      tabId: "tab-2",
      instanceId: "orders-1",
      viewState: { tableName: "orders" },
    }),
  });

  assert.equal(next.splitMode, "vertical");
  assert.equal(next.activePaneId, "secondary");
  assert.deepEqual(next.panes.map((pane) => pane.id), ["primary", "secondary"]);
});

test("focusWorkspacePane ignores missing pane ids", () => {
  const workspace = splitWorkspace({
    workspace: createSplitWorkspace({
      primaryPane: createTablePane({
        id: "primary",
        tabId: "tab-1",
        instanceId: "users-1",
        viewState: { tableName: "users" },
      }),
    }),
    mode: "horizontal",
    pane: createTablePane({
      id: "secondary",
      tabId: "tab-2",
      instanceId: "orders-1",
      viewState: { tableName: "orders" },
    }),
  });

  assert.equal(focusWorkspacePane(workspace, "missing").activePaneId, "secondary");
  assert.equal(focusWorkspacePane(workspace, "primary").activePaneId, "primary");
});

test("closeWorkspacePane keeps the requested pane when split closes", () => {
  const workspace = splitWorkspace({
    workspace: createSplitWorkspace({
      primaryPane: createTablePane({
        id: "primary",
        tabId: "tab-1",
        instanceId: "users-1",
        viewState: { tableName: "users" },
      }),
    }),
    mode: "vertical",
    pane: createTablePane({
      id: "secondary",
      tabId: "tab-2",
      instanceId: "orders-1",
      viewState: { tableName: "orders" },
    }),
  });

  const next = closeWorkspacePane(workspace, "primary");

  assert.equal(next.splitMode, "none");
  assert.equal(next.activePaneId, "primary");
  assert.deepEqual(next.panes.map((pane) => pane.id), ["primary"]);
});

test("resolveEffectiveSplitMode turns narrow vertical split into horizontal", () => {
  assert.equal(resolveEffectiveSplitMode({ splitMode: "vertical", width: 860 }), "horizontal");
  assert.equal(resolveEffectiveSplitMode({ splitMode: "vertical", width: 1200 }), "vertical");
  assert.equal(resolveEffectiveSplitMode({ splitMode: "horizontal", width: 860 }), "horizontal");
});

test("getTableTabDisplayName adds an ordinal only for duplicate table instances", () => {
  const tabs = [
    { id: "tab-1", tableName: "orders", instanceId: "orders-1" },
    { id: "tab-2", tableName: "users", instanceId: "users-1" },
    { id: "tab-3", tableName: "orders", instanceId: "orders-2" },
  ];

  assert.equal(getTableTabDisplayName(tabs, tabs[0]), "orders");
  assert.equal(getTableTabDisplayName(tabs, tabs[1]), "users");
  assert.equal(getTableTabDisplayName(tabs, tabs[2]), "orders #2");
});
