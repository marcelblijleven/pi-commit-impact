import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { analyzeCommitImpact, formatResult } from "./src/analyze.js";
import { normalizeTier } from "./src/scoring.js";
import type { AnalyzeOptions, RiskTier } from "./src/types.js";

const tool = defineTool({
  name: "commit_impact",
  label: "Commit Impact",
  description: "Estimate production regression risk for a commit/range using local heuristics and optional TypeSafe.ai Jev HTTP analysis. Defaults to HEAD. For requests like “risk score of the last 3 commits”, use lastCommits: 3.",
  parameters: Type.Object({
    target: Type.Optional(Type.String({ description: "Commit or range to analyze. Defaults to HEAD. A single commit is analyzed as commit^..commit. Do not combine with lastCommits." })),
    lastCommits: Type.Optional(Type.Number({ description: "Analyze the last N commits as HEAD~N..HEAD. Use this for natural requests like 'last 3 commits'. Do not combine with target." })),
    format: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("json")], { description: "Output format." })),
    configPath: Type.Optional(Type.String({ description: "Path to pi-commit-impact.config.json. Defaults to repo root." })),
    failOn: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("critical")], { description: "Mark thresholdExceeded when the risk tier is at or above this tier." })),
    includePatch: Type.Optional(Type.Boolean({ description: "Override config for whether truncated patch content may be sent to Jev." })),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const result = await analyzeCommitImpact({
      cwd: ctx.cwd,
      target: params.target,
      lastCommits: params.lastCommits,
      format: params.format ?? "markdown",
      configPath: params.configPath,
      failOn: params.failOn,
      includePatch: params.includePatch,
    }, signal);
    return {
      content: [{ type: "text", text: formatResult(result, params.format ?? "markdown") }],
      details: result,
    };
  },
});

export default function commitImpactExtension(pi: ExtensionAPI) {
  pi.registerTool(tool);

  pi.registerCommand("commit-impact", {
    description: "Estimate production regression risk for a commit/range. Usage: /commit-impact [target] [--last N] [--format markdown|json] [--config path] [--fail-on medium|high|critical] [--no-patch]",
    handler: async (args, ctx) => {
      try {
        const options = parseArgs(String(args || ""), ctx.cwd);
        const result = await analyzeCommitImpact(options, ctx.signal);
        const output = formatResult(result, options.format);
        if (ctx.hasUI) ctx.ui.notify(output, result.thresholdExceeded ? "warning" : "info");
        else console.log(output);
        if (result.thresholdExceeded) process.exitCode = 1;
      } catch (error: any) {
        if (ctx.hasUI) ctx.ui.notify(`commit-impact failed: ${error.message}`, "error");
        else console.error(`commit-impact failed: ${error.message}`);
        process.exitCode = 1;
      }
    },
  });
}

export function parseArgs(input: string, cwd: string): AnalyzeOptions {
  const tokens = tokenize(input);
  const options: AnalyzeOptions = { cwd, target: undefined, format: "markdown" };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--format") options.format = readFormat(tokens[++i]);
    else if (token.startsWith("--format=")) options.format = readFormat(token.slice("--format=".length));
    else if (token === "--last") options.lastCommits = readPositiveInteger(tokens[++i], "--last");
    else if (token.startsWith("--last=")) options.lastCommits = readPositiveInteger(token.slice("--last=".length), "--last");
    else if (token === "--config") options.configPath = tokens[++i];
    else if (token.startsWith("--config=")) options.configPath = token.slice("--config=".length);
    else if (token === "--fail-on") options.failOn = readFailOn(tokens[++i]);
    else if (token.startsWith("--fail-on=")) options.failOn = readFailOn(token.slice("--fail-on=".length));
    else if (token === "--no-patch") options.includePatch = false;
    else if (token === "--include-patch") options.includePatch = true;
    else if (!options.target) options.target = token;
    else throw new Error(`Unexpected argument: ${token}`);
  }
  if (options.target && options.lastCommits !== undefined) throw new Error("Use either a target or --last, not both.");
  return options;
}

function readPositiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  throw new Error(`Invalid ${flag} value: ${value}`);
}

function readFormat(value: string | undefined): "markdown" | "json" {
  if (value === "markdown" || value === "json") return value;
  throw new Error(`Invalid format: ${value}`);
}

function readFailOn(value: string | undefined): RiskTier {
  const tier = normalizeTier(value);
  if (tier && tier !== "unknown") return tier;
  throw new Error(`Invalid fail-on tier: ${value}`);
}

function tokenize(input: string): string[] {
  const matches = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map((token) => token.replace(/^(["'])(.*)\1$/, "$2"));
}
