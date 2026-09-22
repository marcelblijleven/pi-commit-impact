import { loadConfig } from "./config.js";
import { collectCommitData } from "./git.js";
import { callJev } from "./jev.js";
import { combineScores, scoreHeuristics } from "./scoring.js";
import type { AnalyzeOptions, ImpactResult } from "./types.js";

export async function analyzeCommitImpact(options: AnalyzeOptions, signal?: AbortSignal): Promise<ImpactResult> {
  const config = await loadConfig(options.cwd, options.configPath);
  if (options.includePatch !== undefined) config.includePatch = options.includePatch;
  const target = resolveAnalyzeTarget(options);
  const commit = await collectCommitData(options.cwd, target, config);
  const heuristics = scoreHeuristics(commit, config);
  const jev = await callJev(commit, config, signal);
  return combineScores(commit, heuristics.score, heuristics.signals, jev, config, options.failOn);
}

export function resolveAnalyzeTarget(options: Pick<AnalyzeOptions, "target" | "lastCommits">): string | undefined {
  if (options.target && options.lastCommits !== undefined) throw new Error("Use either target or lastCommits, not both.");
  if (options.lastCommits !== undefined) {
    if (!Number.isInteger(options.lastCommits) || options.lastCommits < 1) throw new Error("lastCommits must be a positive integer.");
    return `HEAD~${options.lastCommits}..HEAD`;
  }
  return options.target;
}

export function formatResult(result: ImpactResult, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  const lines: string[] = [];
  lines.push(`# Commit Impact: ${result.tier.toUpperCase()}${result.score === null ? "" : ` (${result.score}/100)`}`);
  lines.push("");
  lines.push(`- Target: \`${result.target}\``);
  lines.push(`- Range: \`${result.range}\``);
  lines.push(`- Commit: \`${result.sha}\``);
  lines.push(`- Commits in range: ${result.metrics.commitCount}`);
  lines.push(`- Changed files: ${result.metrics.changedFiles}`);
  lines.push(`- Churn: +${result.metrics.additions}/-${result.metrics.deletions}`);
  lines.push(`- Tests changed: ${result.metrics.testsChanged ? "yes" : "no"}`);
  if (result.thresholdExceeded) lines.push("- Fail-on threshold: exceeded");
  if (result.warnings.length) {
    lines.push("", "## Warnings");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  lines.push("", "## Evidence");
  if (result.evidence.length) for (const item of result.evidence) lines.push(`- ${item}`);
  else lines.push("- No strong risk signals found.");
  lines.push("", "## Recommended checks");
  if (result.recommendations.length) for (const item of result.recommendations) lines.push(`- ${item}`);
  else lines.push("- Standard review and test process should be sufficient.");
  if (result.metrics.commits.length > 1) {
    lines.push("", "## Commits in range");
    for (const commit of result.metrics.commits.slice(0, 20)) lines.push(`- \`${commit.sha.slice(0, 12)}\` ${commit.subject} — ${commit.authorName}`);
    if (result.metrics.commits.length > 20) lines.push(`- …and ${result.metrics.commits.length - 20} more`);
  }
  if (result.metrics.criticalFiles.length) {
    lines.push("", "## Critical files");
    for (const file of result.metrics.criticalFiles.slice(0, 20)) lines.push(`- ${file}`);
    if (result.metrics.criticalFiles.length > 20) lines.push(`- …and ${result.metrics.criticalFiles.length - 20} more`);
  }
  return lines.join("\n");
}
