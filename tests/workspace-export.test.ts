import assert from "node:assert/strict";
import test from "node:test";
import { escapeCsv } from "../lib/workspaces/export";

test("CSV exports neutralize formulas while preserving numeric amounts", () => {
  for (const value of ["=1+1", "+cmd", "-cmd", "@SUM(A1)", " \t=1+1", "\r=1+1", "\n=1+1"]) {
    assert.ok(escapeCsv(value).startsWith('"\''));
  }
  assert.equal(escapeCsv(-1250), '"-1250"');
  assert.equal(escapeCsv('A, "B"'), '"A, ""B"""');
  assert.equal(escapeCsv(null), '""');
});
