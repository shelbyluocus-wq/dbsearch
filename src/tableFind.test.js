import test from "node:test";
import assert from "node:assert/strict";

import { matchTableFindEntry } from "./tableFind.js";

test("matchTableFindEntry keeps fuzzy data matching when exact mode is off", () => {
  assert.equal(
    matchTableFindEntry({ query: "2", exact: false, entryType: "data", text: "12" }),
    true,
  );
});

test("matchTableFindEntry only matches equal data values when exact mode is on", () => {
  assert.equal(
    matchTableFindEntry({ query: "2", exact: true, entryType: "data", text: "2" }),
    true,
  );
  assert.equal(
    matchTableFindEntry({ query: "2", exact: true, entryType: "data", text: "12" }),
    false,
  );
  assert.equal(
    matchTableFindEntry({ query: "2", exact: true, entryType: "data", text: "2.0" }),
    false,
  );
});

test("matchTableFindEntry keeps schema matching fuzzy even when exact mode is on", () => {
  assert.equal(
    matchTableFindEntry({ query: "prop", exact: true, entryType: "schema", text: "buildopenprop" }),
    true,
  );
});

test("matchTableFindEntry normalizes case and trims surrounding whitespace", () => {
  assert.equal(
    matchTableFindEntry({ query: "  FooBar ", exact: true, entryType: "data", text: " foobar " }),
    true,
  );
});

test("matchTableFindEntry safely rejects empty or missing input", () => {
  assert.equal(
    matchTableFindEntry({ query: "", exact: true, entryType: "data", text: "2" }),
    false,
  );
  assert.equal(
    matchTableFindEntry({ query: "2", exact: true, entryType: "data", text: "" }),
    false,
  );
  assert.equal(
    matchTableFindEntry({ query: null, exact: true, entryType: "data", text: undefined }),
    false,
  );
});
