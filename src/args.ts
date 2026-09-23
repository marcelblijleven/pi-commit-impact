import { normalizeTier } from "./scoring.js";
import type { AnalyzeOptions, RiskTier } from "./types.js";

export function parseArgs(input: string, cwd: string): AnalyzeOptions {
  return parseArgTokens(tokenize(input), cwd);
}

export function parseArgTokens(tokens: string[], cwd: string): AnalyzeOptions {
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
