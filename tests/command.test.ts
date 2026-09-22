import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../index.js";
import { resolveAnalyzeTarget } from "../src/analyze.js";

test("parse slash command arguments", () => {
  const args = parseArgs("main..HEAD --format json --config custom.json --fail-on high --no-patch", "/repo");
  assert.equal(args.cwd, "/repo");
  assert.equal(args.target, "main..HEAD");
  assert.equal(args.format, "json");
  assert.equal(args.configPath, "custom.json");
  assert.equal(args.failOn, "high");
  assert.equal(args.includePatch, false);
});

test("parse --last commits", () => {
  const args = parseArgs("--last 3 --format markdown", "/repo");
  assert.equal(args.lastCommits, 3);
  assert.equal(resolveAnalyzeTarget(args), "HEAD~3..HEAD");
});

test("reject target combined with --last", () => {
  assert.throws(() => parseArgs("HEAD --last 3", "/repo"), /either a target or --last/);
});
