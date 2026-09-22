import { execFile } from "node:child_process";
import { extname } from "node:path";
import { promisify } from "node:util";
import type { ChangedFile, CommitData, CommitImpactConfig } from "./types.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
  return stdout.toString();
}

export async function resolveRange(cwd: string, target = "HEAD"): Promise<{ target: string; range: string; sha: string }> {
  if (target.includes("..") || target.includes("...")) {
    const tip = rangeTip(target);
    const sha = (await git(cwd, ["rev-parse", "--verify", `${tip}^{commit}`])).trim();
    return { target, range: target, sha };
  }

  const sha = (await git(cwd, ["rev-parse", "--verify", `${target}^{commit}`])).trim();
  try {
    await git(cwd, ["rev-parse", `${target}^`]);
    return { target, range: `${target}^..${target}`, sha };
  } catch {
    const root = (await git(cwd, ["hash-object", "-t", "tree", "/dev/null"])).trim();
    return { target, range: `${root}..${target}`, sha };
  }
}

function rangeTip(target: string): string {
  const separator = target.includes("...") ? "..." : "..";
  const [, right] = target.split(separator);
  return right?.trim() || "HEAD";
}

export async function collectCommitData(cwd: string, target: string | undefined, config: CommitImpactConfig): Promise<CommitData> {
  const resolved = await resolveRange(cwd, target || "HEAD");
  const [subject, body, authorName, authorEmail, date] = (await git(cwd, [
    "log",
    "-1",
    "--format=%s%x1f%b%x1f%an%x1f%ae%x1f%aI",
    resolved.sha,
  ])).split("\x1f");

  const commits = await collectCommitSummaries(cwd, resolved.range);
  const numstat = await git(cwd, ["diff", "--numstat", resolved.range]);
  const nameStatus = await git(cwd, ["diff", "--name-status", resolved.range]);
  const statusByPath = parseNameStatus(nameStatus);
  const files = parseNumstat(numstat, statusByPath, config);
  const patch = await getPatch(cwd, resolved.range, config);

  return {
    ...resolved,
    subject: subject?.trim() || "",
    body: body?.trim() || "",
    authorName: authorName?.trim() || "",
    authorEmail: authorEmail?.trim() || "",
    date: date?.trim() || "",
    commitCount: commits.length,
    commits,
    files,
    totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
    totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
    patch,
  };
}

async function collectCommitSummaries(cwd: string, range: string) {
  const output = await git(cwd, ["log", "--reverse", "--format=%H%x1f%s%x1f%an%x1f%aI%x1e", range]);
  return output.split("\x1e").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [sha, subject, authorName, date] = entry.split("\x1f");
    return {
      sha: sha || "",
      subject: subject || "",
      authorName: authorName || "",
      date: date || "",
    };
  });
}

function parseNameStatus(output: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0] ?? "M";
    const path = parts.at(-1);
    if (path) map.set(path, status);
  }
  return map;
}

function parseNumstat(output: string, statusByPath: Map<string, string>, config: CommitImpactConfig): ChangedFile[] {
  return output.split("\n").filter(Boolean).map((line) => {
    const [addedRaw, deletedRaw, path] = line.split("\t");
    const additions = addedRaw === "-" ? 0 : Number(addedRaw || 0);
    const deletions = deletedRaw === "-" ? 0 : Number(deletedRaw || 0);
    const fileType = extname(path || "") || "[none]";
    return {
      path,
      additions,
      deletions,
      status: statusByPath.get(path) || "M",
      isTest: isTestPath(path),
      isCritical: (config.criticalGlobs || []).some((glob) => matchesGlob(path, glob)),
      fileType,
    };
  });
}

async function getPatch(cwd: string, range: string, config: CommitImpactConfig): Promise<string | undefined> {
  if (config.includePatch === false) return undefined;
  const patch = await git(cwd, ["diff", "--no-ext-diff", "--unified=3", range]);
  const max = config.maxPatchBytes ?? 60_000;
  if (Buffer.byteLength(patch, "utf8") <= max) return patch;
  return `${Buffer.from(patch).subarray(0, max).toString("utf8")}\n\n[patch truncated to ${max} bytes]`;
}

export function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|test|tests|spec)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i.test(path);
}

export function matchesGlob(path: string, glob: string): boolean {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`).test(path);
}
