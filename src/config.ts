import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { CommitImpactConfig, RiskTier } from "./types.js";

export const DEFAULT_THRESHOLDS: Record<Exclude<RiskTier, "unknown">, number> = {
  low: 0,
  medium: 35,
  high: 65,
  critical: 85,
};

export const DEFAULT_CONFIG: Required<Omit<CommitImpactConfig, "jev">> & Pick<CommitImpactConfig, "jev"> = {
  jev: undefined,
  includePatch: true,
  maxPatchBytes: 60_000,
  conventionalCommitWeights: {
    feat: 12,
    fix: 8,
    perf: 14,
    refactor: 16,
    build: 15,
    ci: 12,
    chore: 5,
    docs: -8,
    test: -10,
    style: -8,
    revert: 18,
  },
  keywordWeights: {
    "BREAKING CHANGE": 45,
    "!": 35,
    migration: 24,
    database: 22,
    auth: 22,
    security: 22,
    permission: 18,
    payment: 20,
    cache: 12,
    config: 14,
    deploy: 16,
    rollback: 18,
  },
  criticalGlobs: [
    ".github/workflows/**",
    ".gitlab-ci.yml",
    "Jenkinsfile",
    "Dockerfile",
    "docker-compose*.yml",
    "k8s/**",
    "kubernetes/**",
    "helm/**",
    "terraform/**",
    "infra/**",
    "migrations/**",
    "db/migrations/**",
    "schema/**",
    "**/auth/**",
    "**/security/**",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "requirements*.txt",
    "poetry.lock",
    "Cargo.lock",
    "go.mod",
    "go.sum",
    "config/production/**",
    "**/prod*.json",
    "**/prod*.yml",
  ],
  fileTypeWeights: {
    ".sql": 18,
    ".tf": 18,
    ".yml": 8,
    ".yaml": 8,
    ".json": 5,
    ".lock": 10,
  },
  thresholds: DEFAULT_THRESHOLDS,
  weights: {
    jev: 0.65,
    heuristics: 0.35,
  },
};

export async function loadConfig(cwd: string, configPath?: string): Promise<CommitImpactConfig & typeof DEFAULT_CONFIG> {
  const path = configPath
    ? isAbsolute(configPath) ? configPath : join(cwd, configPath)
    : join(cwd, "pi-commit-impact.config.json");

  let userConfig: CommitImpactConfig = {};
  try {
    const text = await readFile(path, "utf8");
    userConfig = JSON.parse(text) as CommitImpactConfig;
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw new Error(`Failed to read commit-impact config at ${path}: ${error.message}`);
  }

  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    jev: userConfig.jev ? { ...DEFAULT_CONFIG.jev, ...userConfig.jev } : DEFAULT_CONFIG.jev,
    conventionalCommitWeights: { ...DEFAULT_CONFIG.conventionalCommitWeights, ...userConfig.conventionalCommitWeights },
    keywordWeights: { ...DEFAULT_CONFIG.keywordWeights, ...userConfig.keywordWeights },
    criticalGlobs: userConfig.criticalGlobs ?? DEFAULT_CONFIG.criticalGlobs,
    fileTypeWeights: { ...DEFAULT_CONFIG.fileTypeWeights, ...userConfig.fileTypeWeights },
    thresholds: { ...DEFAULT_THRESHOLDS, ...userConfig.thresholds },
    weights: { ...DEFAULT_CONFIG.weights, ...userConfig.weights },
  };
}
