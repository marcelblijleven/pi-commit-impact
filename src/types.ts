export type RiskTier = "low" | "medium" | "high" | "critical" | "unknown";

export interface CommitImpactConfig {
  jev?: {
    endpoint?: string;
    tokenEnv?: string;
    model?: string;
    timeoutMs?: number;
  };
  includePatch?: boolean;
  maxPatchBytes?: number;
  conventionalCommitWeights?: Record<string, number>;
  keywordWeights?: Record<string, number>;
  criticalGlobs?: string[];
  fileTypeWeights?: Record<string, number>;
  thresholds?: Partial<Record<Exclude<RiskTier, "unknown">, number>>;
  weights?: {
    jev?: number;
    heuristics?: number;
  };
}

export interface AnalyzeOptions {
  cwd: string;
  target?: string;
  lastCommits?: number;
  format?: "markdown" | "json";
  configPath?: string;
  failOn?: RiskTier;
  includePatch?: boolean;
}

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  status: string;
  isTest: boolean;
  isCritical: boolean;
  fileType: string;
}

export interface CommitSummary {
  sha: string;
  subject: string;
  authorName: string;
  date: string;
}

export interface CommitData {
  target: string;
  range: string;
  sha: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  date: string;
  commitCount: number;
  commits: CommitSummary[];
  files: ChangedFile[];
  totalAdditions: number;
  totalDeletions: number;
  patch?: string;
}

export interface Signal {
  label: string;
  score: number;
  detail: string;
}

export interface JevResult {
  available: boolean;
  score?: number;
  tier?: RiskTier;
  evidence: string[];
  recommendations: string[];
  warning?: string;
  raw?: unknown;
}

export interface ImpactResult {
  target: string;
  range: string;
  sha: string;
  tier: RiskTier;
  score: number | null;
  evidence: string[];
  recommendations: string[];
  warnings: string[];
  metrics: {
    commitCount: number;
    commits: CommitSummary[];
    changedFiles: number;
    additions: number;
    deletions: number;
    testsChanged: boolean;
    criticalFiles: string[];
  };
  heuristicSignals: Signal[];
  jev: JevResult;
  thresholdExceeded: boolean;
}
