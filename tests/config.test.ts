import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

test("loadConfig leaves Jev disabled when absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "commit-impact-config-no-jev-"));
  await writeFile(join(dir, "pi-commit-impact.config.json"), JSON.stringify({ keywordWeights: { risky: 30 } }));
  const config = await loadConfig(dir);
  assert.equal(config.jev, undefined);
});

test("loadConfig merges user overrides with defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "commit-impact-config-"));
  await writeFile(join(dir, "pi-commit-impact.config.json"), JSON.stringify({
    jev: { endpoint: "https://jev.test", tokenEnv: "JEV_TOKEN" },
    keywordWeights: { risky: 30 },
    criticalGlobs: ["prod/**"]
  }));
  const config = await loadConfig(dir);
  assert.equal(config.jev?.endpoint, "https://jev.test");
  assert.equal(config.keywordWeights.risky, 30);
  assert.equal(config.keywordWeights["BREAKING CHANGE"], 45);
  assert.deepEqual(config.criticalGlobs, ["prod/**"]);
});
