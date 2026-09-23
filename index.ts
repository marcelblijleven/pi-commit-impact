import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { analyzeCommitImpact, formatResult } from "./src/analyze.js";
import { parseArgs } from "./src/args.js";

export { parseArgs } from "./src/args.js";

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
