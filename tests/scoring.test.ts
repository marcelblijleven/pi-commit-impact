import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config.js";
import { combineScores, isAtOrAbove, scoreHeuristics, scoreToTier } from "../src/scoring.js";
import type { CommitData, JevResult } from "../src/types.js";

const commit: CommitData = {
  target: "HEAD",
  range: "HEAD^..HEAD",
  sha: "abc",
  subject: "feat!: change auth flow",
  body: "BREAKING CHANGE: auth migration",
  authorName: "A",
  authorEmail: "a@example.com",
  date: "2024-01-01T00:00:00Z",
  commitCount: 1,
  commits: [{ sha: "abc", subject: "feat!: change auth flow", authorName: "A", date: "2024-01-01T00:00:00Z" }],
  totalAdditions: 100,
  totalDeletions: 20,
  patch: "",
  files: [
    { path: "src/auth/login.ts", additions: 80, deletions: 15, status: "M", isTest: false, isCritical: true, fileType: ".ts" },
    { path: "migrations/001.sql", additions: 20, deletions: 5, status: "A", isTest: false, isCritical: true, fileType: ".sql" },
  ],
};

test("heuristics raise risk for breaking auth migration without tests", () => {
  const result = scoreHeuristics(commit, DEFAULT_CONFIG);
  assert.equal(result.score, 100);
  assert.ok(result.signals.some((s) => s.label === "keyword:BREAKING CHANGE"));
  assert.ok(result.signals.some((s) => s.label === "critical-paths"));
});

test("weighted Jev score keeps heuristic guardrails", () => {
  const heuristics = scoreHeuristics(commit, DEFAULT_CONFIG);
  const jev: JevResult = { available: true, score: 20, evidence: ["small semantic change"], recommendations: [] };
  const impact = combineScores(commit, heuristics.score, heuristics.signals, jev, DEFAULT_CONFIG, "high");
  assert.equal(impact.tier, "high");
  assert.equal(impact.thresholdExceeded, true);
});

test("tier thresholds and fail-on ordering", () => {
  assert.equal(scoreToTier(10, DEFAULT_CONFIG), "low");
  assert.equal(scoreToTier(40, DEFAULT_CONFIG), "medium");
  assert.equal(scoreToTier(70, DEFAULT_CONFIG), "high");
  assert.equal(scoreToTier(90, DEFAULT_CONFIG), "critical");
  assert.equal(isAtOrAbove("high", "medium"), true);
  assert.equal(isAtOrAbove("medium", "high"), false);
});
