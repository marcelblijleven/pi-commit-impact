#!/usr/bin/env node
import { analyzeCommitImpact, formatResult } from "./src/analyze.js";
import { parseArgTokens } from "./src/args.js";

const USAGE = `Usage: commit-impact [target] [options]

Estimate production regression risk for a commit or range.

Arguments:
  target                         Commit or range to analyze. Defaults to HEAD.
                                 A single commit is analyzed as commit^..commit.

Options:
  --last N                       Analyze the last N commits as HEAD~N..HEAD.
  --format markdown|json         Output format. Defaults to markdown.
  --config PATH                  Path to pi-commit-impact.config.json.
  --fail-on low|medium|high|critical
                                 Exit with code 1 when risk tier is at/above threshold.
  --include-patch                Allow truncated patch content to be sent to Jev.
  --no-patch                     Do not send patch content to Jev.
  -h, --help                     Show this help.

Examples:
  commit-impact
  commit-impact HEAD --format json
  commit-impact --last 3 --fail-on high
  commit-impact main..HEAD --config pi-commit-impact.config.json
`;

export async function main(argv = process.argv.slice(2), cwd = process.cwd()): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  try {
    const options = parseArgTokens(argv, cwd);
    const result = await analyzeCommitImpact(options);
    console.log(formatResult(result, options.format));
    return result.thresholdExceeded ? 1 : 0;
  } catch (error: any) {
    console.error(`commit-impact failed: ${error.message}`);
    return 1;
  }
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  process.exitCode = await main();
}
