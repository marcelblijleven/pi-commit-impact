import { DEFAULT_THRESHOLDS } from "./config.js";
import type { CommitData, CommitImpactConfig, ImpactResult, JevResult, RiskTier, Signal } from "./types.js";

const RISK_ORDER: RiskTier[] = ["low", "medium", "high", "critical", "unknown"];
const FAIL_ORDER: RiskTier[] = ["low", "medium", "high", "critical"];

export function scoreHeuristics(commit: CommitData, config: CommitImpactConfig): { score: number; signals: Signal[] } {
  const signals: Signal[] = [];
  const message = `${commit.subject}\n${commit.body}`;
  const conventional = parseConventionalType(commit.subject);
  if (conventional) {
    const weight = config.conventionalCommitWeights?.[conventional.type] ?? 0;
    if (weight) signals.push({ label: `conventional:${conventional.type}`, score: weight + (conventional.breaking ? 25 : 0), detail: `Commit type ${conventional.type}${conventional.breaking ? " with ! breaking marker" : ""}.` });
  }

  for (const [keyword, weight] of Object.entries(config.keywordWeights || {})) {
    if (keyword === "!" && !conventional?.breaking) continue;
    if (keyword !== "!" && message.toLowerCase().includes(keyword.toLowerCase())) {
      signals.push({ label: `keyword:${keyword}`, score: weight, detail: `Commit message contains “${keyword}”.` });
    }
  }

  if (commit.commitCount > 1) signals.push({ label: "commit-count", score: Math.min(20, commit.commitCount * 3), detail: `${commit.commitCount} commits included in the range.` });

  const changed = commit.files.length;
  if (changed > 0) signals.push({ label: "changed-files", score: Math.min(28, changed * 2), detail: `${changed} files changed.` });
  const churn = commit.totalAdditions + commit.totalDeletions;
  if (churn > 0) signals.push({ label: "line-churn", score: Math.min(32, Math.log10(churn + 1) * 10), detail: `${churn} lines changed (+${commit.totalAdditions}/-${commit.totalDeletions}).` });

  const critical = commit.files.filter((f) => f.isCritical);
  if (critical.length) signals.push({ label: "critical-paths", score: Math.min(35, 14 + critical.length * 5), detail: `Critical files changed: ${critical.map((f) => f.path).slice(0, 6).join(", ")}${critical.length > 6 ? ", …" : ""}.` });

  const testsChanged = commit.files.some((f) => f.isTest);
  if (testsChanged) signals.push({ label: "tests-changed", score: -8, detail: "Test files changed, reducing uncertainty modestly." });
  else if (changed > 0) signals.push({ label: "no-tests-changed", score: 10, detail: "No test files changed with this commit." });

  const typeScore = commit.files.reduce((sum, f) => sum + (config.fileTypeWeights?.[f.fileType] ?? 0), 0);
  if (typeScore) signals.push({ label: "file-types", score: Math.min(25, typeScore), detail: "Changed file extensions include higher-risk types." });

  const score = clamp(signals.reduce((sum, s) => sum + s.score, 0), 0, 100);
  return { score, signals };
}

export function combineScores(commit: CommitData, heuristicScore: number, heuristicSignals: Signal[], jev: JevResult, config: CommitImpactConfig, failOn?: RiskTier): ImpactResult {
  const warnings = jev.warning ? [jev.warning] : [];
  const jevScore = typeof jev.score === "number" ? clamp(jev.score, 0, 100) : undefined;
  const weights = { jev: 0.65, heuristics: 0.35, ...config.weights };
  const score = jevScore === undefined
    ? heuristicScore
    : clamp((jevScore * (weights.jev ?? 0.65)) + (heuristicScore * (weights.heuristics ?? 0.35)), 0, 100);
  const guardedScore = Math.max(score, guardrailMinimum(heuristicSignals));
  const tier = jev.tier && jev.tier !== "unknown" && tierToScore(jev.tier, config) > guardedScore
    ? jev.tier
    : scoreToTier(guardedScore, config);
  const evidence = [
    ...jev.evidence.map((item) => `Jev: ${item}`),
    ...heuristicSignals.filter((s) => Math.abs(s.score) >= 8).map((s) => `${s.label}: ${s.detail}`),
  ].slice(0, 12);
  const recommendations = buildRecommendations(tier, commit, heuristicSignals, jev);
  const thresholdExceeded = failOn ? isAtOrAbove(tier, failOn) : false;

  return {
    target: commit.target,
    range: commit.range,
    sha: commit.sha,
    tier,
    score: Math.round(guardedScore),
    evidence,
    recommendations,
    warnings,
    metrics: {
      commitCount: commit.commitCount,
      commits: commit.commits,
      changedFiles: commit.files.length,
      additions: commit.totalAdditions,
      deletions: commit.totalDeletions,
      testsChanged: commit.files.some((f) => f.isTest),
      criticalFiles: commit.files.filter((f) => f.isCritical).map((f) => f.path),
    },
    heuristicSignals,
    jev,
    thresholdExceeded,
  };
}

export function scoreToTier(score: number, config: CommitImpactConfig): RiskTier {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...config.thresholds };
  if (score >= thresholds.critical) return "critical";
  if (score >= thresholds.high) return "high";
  if (score >= thresholds.medium) return "medium";
  return "low";
}

function tierToScore(tier: RiskTier, config: CommitImpactConfig): number {
  if (tier === "unknown") return 0;
  return ({ ...DEFAULT_THRESHOLDS, ...config.thresholds })[tier];
}

export function normalizeTier(value: unknown): RiskTier | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase();
  return RISK_ORDER.includes(lower as RiskTier) ? lower as RiskTier : undefined;
}

export function isAtOrAbove(actual: RiskTier, threshold: RiskTier): boolean {
  if (actual === "unknown") return false;
  return FAIL_ORDER.indexOf(actual) >= FAIL_ORDER.indexOf(threshold);
}

function guardrailMinimum(signals: Signal[]): number {
  if (signals.some((s) => s.label === "keyword:BREAKING CHANGE" || s.label === "critical-paths" && s.score >= 24)) return 65;
  if (signals.some((s) => s.label === "critical-paths")) return 45;
  return 0;
}

function buildRecommendations(tier: RiskTier, commit: CommitData, signals: Signal[], jev: JevResult): string[] {
  const recs = [...jev.recommendations];
  if (["high", "critical"].includes(tier)) recs.push("Require reviewer sign-off and run targeted production-like validation before deploy.");
  if (commit.files.some((f) => f.isCritical)) recs.push("Review changed critical-path files against deployment, rollback, and monitoring plans.");
  if (!commit.files.some((f) => f.isTest)) recs.push("Add or run targeted tests for the changed runtime paths.");
  if (signals.some((s) => s.label.startsWith("keyword:"))) recs.push("Confirm commit-message risk markers match the actual code change.");
  if (!jev.available) recs.push("Configure Jev HTTP to improve semantic impact analysis.");
  return [...new Set(recs)].slice(0, 8);
}

function parseConventionalType(subject: string): { type: string; breaking: boolean } | undefined {
  const match = /^(\w+)(?:\([^)]*\))?(!)?:/.exec(subject);
  if (!match) return undefined;
  return { type: match[1], breaking: Boolean(match[2]) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
