import type { CommitData, CommitImpactConfig, JevResult } from "./types.js";
import { normalizeTier } from "./scoring.js";

const DEFAULT_TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_TYPESAFE_MODEL = "jev-latest";

export async function callJev(commit: CommitData, config: CommitImpactConfig, signal?: AbortSignal): Promise<JevResult> {
  if (!config.jev) {
    return { available: false, evidence: [], recommendations: [] };
  }

  const endpoint = config.jev.endpoint;
  if (!endpoint) {
    return { available: false, evidence: [], recommendations: [], warning: "Jev is configured without an HTTP endpoint; using heuristic-only analysis." };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  const tokenEnv = config.jev?.tokenEnv;
  if (tokenEnv) {
    const token = process.env[tokenEnv];
    if (!token) return { available: false, evidence: [], recommendations: [], warning: `Jev token environment variable ${tokenEnv} is not set; using heuristic-only analysis.` };
    headers.authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.jev?.timeoutMs ?? 10_000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(buildTypeSafeRequest(commit, config)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const raw = await response.json();
    return normalizeJevResponse(raw);
  } catch (error: any) {
    return { available: false, evidence: [], recommendations: [], warning: `Jev HTTP analysis failed (${error.message}); using heuristic-only analysis.` };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function buildTypeSafeRequest(commit: CommitData, config: CommitImpactConfig) {
  return {
    state: {
      commit: {
        target: commit.target,
        range: commit.range,
        sha: commit.sha,
        subject: commit.subject,
        body: commit.body,
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
        date: commit.date,
        commitCount: commit.commitCount,
        commits: commit.commits,
      },
      diff: {
        files: commit.files.map((file) => ({
          path: file.path,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          isTest: file.isTest,
          isCritical: file.isCritical,
          fileType: file.fileType,
        })),
        totalAdditions: commit.totalAdditions,
        totalDeletions: commit.totalDeletions,
        patch: config.includePatch === false ? undefined : commit.patch,
      },
      scoringGoal: "Estimate production deployment/runtime regression risk caused by this commit. Focus on likely production breakage, not semantic-version API compatibility unless it affects runtime production behavior.",
    },
    model: config.jev?.model ?? DEFAULT_TYPESAFE_MODEL,
    questions: {
      production_regression_risk: {
        type: "score",
        instructions: "How likely is this commit to cause a production deployment or runtime regression if released without additional validation?",
        criteria: [
          "Very low risk: documentation, tests, formatting, or isolated internal changes with no plausible production runtime effect.",
          "Low risk: small localized runtime change with clear intent and limited blast radius.",
          "Medium risk: meaningful runtime behavior change, moderate churn, configuration/dependency changes, or unclear test coverage.",
          "High risk: broad behavior change, critical path change, migration, auth/security/payment/deployment impact, or large churn that needs targeted validation.",
          "Critical risk: likely outage, irreversible migration, security/auth breakage, deployment failure, or change that should be blocked until deeply reviewed.",
        ],
      },
      critical_behavior_change: {
        type: "noul",
        instructions: "Does this commit appear to change behavior in a production-critical path such as deployment, infrastructure, database schema, authentication, authorization, security, payments, or production configuration?",
        criteria: {
          true: "The diff or commit message indicates a production-critical behavior or operational path changed.",
          false: "The change does not appear to affect production-critical behavior or operational paths.",
        },
      },
      validation_focus: {
        type: "choice",
        instructions: "Which validation focus would most reduce production regression risk for this commit?",
        criteria: {
          standard_tests: "Normal automated tests and review are likely sufficient.",
          targeted_runtime_tests: "Run targeted unit/integration/e2e tests around changed runtime behavior.",
          deployment_or_rollback_review: "Review deployment, infrastructure, migration, config, observability, or rollback plan.",
          security_or_access_review: "Review authentication, authorization, security, privacy, or access-control implications.",
          human_escalation: "Escalate to senior/domain owner review before release.",
        },
      },
    },
  };
}

export function normalizeJevResponse(raw: any): JevResult {
  if (raw?.answers) return normalizeSystemOneResponse(raw);

  const score = numberFrom(raw?.score ?? raw?.riskScore ?? raw?.impactScore ?? raw?.probability);
  return {
    available: true,
    score,
    tier: normalizeTier(raw?.tier ?? raw?.riskTier ?? raw?.risk),
    evidence: stringArray(raw?.evidence ?? raw?.reasons ?? raw?.findings),
    recommendations: stringArray(raw?.recommendations ?? raw?.recommendedChecks ?? raw?.nextChecks),
    raw,
  };
}

function normalizeSystemOneResponse(raw: any): JevResult {
  const risk = raw.answers?.production_regression_risk;
  const critical = raw.answers?.critical_behavior_change;
  const validation = raw.answers?.validation_focus;
  const levelScore = typeof risk?.score === "number" ? risk.score : undefined;
  const maxLevel = risk?.legend ? Math.max(...Object.keys(risk.legend).map(Number).filter(Number.isFinite)) : 4;
  const score = levelScore === undefined ? undefined : (levelScore / Math.max(1, maxLevel)) * 100;
  const criticalProbability = typeof critical?.noul === "number" ? critical.noul : undefined;
  const validationChoice = typeof validation?.choice === "string" ? validation.choice : undefined;

  const evidence = [
    score !== undefined ? `System One production_regression_risk score ${levelScore?.toFixed(2)}/${maxLevel} (${Math.round(score)}/100), confidence ${formatConfidence(risk?.confidence)}.` : undefined,
    criticalProbability !== undefined ? `Critical behavior change probability ${Math.round(criticalProbability * 100)}%.` : undefined,
    validationChoice ? `Validation focus: ${validationChoice.replaceAll("_", " ")} (confidence ${formatConfidence(validation?.confidence)}).` : undefined,
  ].filter((item): item is string => Boolean(item));

  const recommendations = validationChoice ? [recommendationFor(validationChoice)] : [];

  return {
    available: true,
    score,
    tier: score === undefined ? undefined : normalizeTier(score >= 85 ? "critical" : score >= 65 ? "high" : score >= 35 ? "medium" : "low"),
    evidence,
    recommendations,
    raw,
  };
}

function recommendationFor(choice: string): string {
  switch (choice) {
    case "targeted_runtime_tests": return "Run targeted tests around the changed runtime paths before deployment.";
    case "deployment_or_rollback_review": return "Review deployment, migration, observability, and rollback plans before deployment.";
    case "security_or_access_review": return "Request security/access-control review before deployment.";
    case "human_escalation": return "Escalate to a senior/domain owner before release.";
    default: return "Standard automated tests and review are likely sufficient.";
  }
}

function formatConfidence(value: unknown): string {
  return typeof value === "number" ? value.toFixed(2) : "unknown";
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value <= 1 ? value * 100 : value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    const parsed = Number(value);
    return parsed <= 1 ? parsed * 100 : parsed;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

export { DEFAULT_TYPESAFE_ENDPOINT, DEFAULT_TYPESAFE_MODEL };
