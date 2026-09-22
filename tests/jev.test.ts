import test from "node:test";
import assert from "node:assert/strict";
import { buildTypeSafeRequest, callJev, normalizeJevResponse } from "../src/jev.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { CommitData } from "../src/types.js";

const commit: CommitData = {
  target: "HEAD",
  range: "HEAD^..HEAD",
  sha: "abc",
  subject: "feat: update checkout",
  body: "",
  authorName: "A",
  authorEmail: "a@example.com",
  date: "2024-01-01T00:00:00Z",
  commitCount: 1,
  commits: [{ sha: "abc", subject: "feat: update checkout", authorName: "A", date: "2024-01-01T00:00:00Z" }],
  totalAdditions: 10,
  totalDeletions: 2,
  patch: "diff --git a/src/checkout.ts b/src/checkout.ts",
  files: [{ path: "src/checkout.ts", additions: 10, deletions: 2, status: "M", isTest: false, isCritical: false, fileType: ".ts" }],
};

test("does not warn about TypeSafe credentials when Jev is absent", async () => {
  const result = await callJev(commit, { ...DEFAULT_CONFIG, jev: undefined });
  assert.equal(result.available, false);
  assert.equal(result.warning, undefined);
});

test("builds TypeSafe System One request shape", () => {
  const request = buildTypeSafeRequest(commit, { ...DEFAULT_CONFIG, jev: { endpoint: "https://api.typesafe.ai/v1/systemone", tokenEnv: "TYPESAFE_API_KEY" } });
  assert.equal(request.model, "jev-latest");
  assert.equal(request.questions.production_regression_risk.type, "score");
  assert.equal(request.questions.critical_behavior_change.type, "noul");
  assert.equal(request.questions.validation_focus.type, "choice");
  assert.equal(request.state.commit.sha, "abc");
  assert.equal(request.state.commit.commitCount, 1);
  assert.equal(request.state.commit.commits[0].subject, "feat: update checkout");
});

test("normalizes TypeSafe System One response", () => {
  const result = normalizeJevResponse({
    model: "jev-1.13.0",
    answers: {
      production_regression_risk: { type: "score", score: 3, confidence: 0.7, legend: { "0": "very low", "1": "low", "2": "medium", "3": "high", "4": "critical" }, probabilities: {} },
      critical_behavior_change: { type: "noul", noul: 0.82 },
      validation_focus: { type: "choice", choice: "deployment_or_rollback_review", confidence: 0.64, probabilities: {} },
    },
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  assert.equal(result.available, true);
  assert.equal(result.score, 75);
  assert.equal(result.tier, "high");
  assert.match(result.evidence.join("\n"), /Critical behavior change probability 82%/);
  assert.deepEqual(result.recommendations, ["Review deployment, migration, observability, and rollback plans before deployment."]);
});

test("normalizes legacy/flexible Jev response shapes", () => {
  const result = normalizeJevResponse({ riskScore: 0.72, riskTier: "High", reasons: ["auth path"], recommendedChecks: "run smoke tests" });
  assert.equal(result.available, true);
  assert.equal(result.score, 72);
  assert.equal(result.tier, "high");
  assert.deepEqual(result.evidence, ["auth path"]);
  assert.deepEqual(result.recommendations, ["run smoke tests"]);
});
