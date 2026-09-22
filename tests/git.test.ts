import test from "node:test";
import assert from "node:assert/strict";
import { matchesGlob, isTestPath } from "../src/git.js";

test("matches configured critical globs", () => {
  assert.equal(matchesGlob(".github/workflows/deploy.yml", ".github/workflows/**"), true);
  assert.equal(matchesGlob("src/auth/login.ts", "**/auth/**"), true);
  assert.equal(matchesGlob("src/app.ts", "**/auth/**"), false);
});

test("detects common test paths", () => {
  assert.equal(isTestPath("src/foo.test.ts"), true);
  assert.equal(isTestPath("tests/foo.ts"), true);
  assert.equal(isTestPath("src/foo.ts"), false);
});
