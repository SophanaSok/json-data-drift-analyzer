/**
 * Headless drift analysis: the browser pipeline, runnable per export drop.
 *
 * Usage: npm run analyze -- --baseline <file> --latest <file> [--profile <id>]
 *        [--out <dir>] [--generated-at <iso>]
 *
 * Runs parse → drift analysis → recovery review → export bundle with no
 * decisions log (identical to a browser run before any human decision), writes
 * every artifact the gate permits into --out (default ./drift-artifacts), and
 * exits non-zero when quality fails — so a scheduler or CI job can run checks
 * on every new export and page a human only when something is wrong.
 *
 * The profile defaults to source auto-detection on the latest file. Local
 * profile overrides live in the browser's IndexedDB and are NOT applied here;
 * a headless run always uses the committed repo policy.
 *
 * Exit codes: 0 clean · 1 quality failure (details printed) · 2 usage or input error.
 *
 * NOTE: run via `node --import ./tools/ts-resolve.ts` (the npm script does) so
 * Node can resolve src/'s extensionless imports.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveAll } from "./profile-files.ts";
import { resolveEffectiveProfile } from "../src/profiles/resolve.ts";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value !== undefined && !value.startsWith("--") ? value : null;
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  console.error(
    "Usage: npm run analyze -- --baseline <file> --latest <file> [--profile <id>] [--out <dir>] [--generated-at <iso>]"
  );
  process.exit(2);
}

const baselinePath = readArg("--baseline") ?? fail("--baseline is required.");
const latestPath = readArg("--latest") ?? fail("--latest is required.");
const profileId = readArg("--profile");
const outDir = resolve(readArg("--out") ?? "drift-artifacts");
const generatedAt = readArg("--generated-at") ?? undefined;

if (generatedAt !== undefined && Number.isNaN(Date.parse(generatedAt))) {
  fail(`--generated-at "${generatedAt}" is not a parseable date; pass ISO-8601.`);
}

function readInput(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fail(`Could not read "${path}".`);
  }
}

const baselineText = readInput(baselinePath);
const latestText = readInput(latestPath);
const baselineFileName = baselinePath.split("/").pop() ?? baselinePath;
const latestFileName = latestPath.split("/").pop() ?? latestPath;

// src/ modules use extensionless imports, so they load after the resolve hook
// via dynamic import (a static import would resolve before the hook registers).
const { parseJSON } = await import("../src/engine/source-loader.ts");
const { detectSourceProfile } = await import("../src/profiles/detect.ts");
const { runHeadlessAnalysis } = await import("../src/headless/run.ts");

const registered = resolveAll();
const repoProfile = profileId
  ? (registered.find((profile) => profile.id === profileId) ??
    fail(`Unknown profile "${profileId}". Registered: ${registered.map((profile) => profile.id).join(", ")}`))
  : detectProfile();

function detectProfile() {
  const parsed = parseJSON(latestText, latestFileName);
  if (!parsed.success) {
    return fail(`Could not parse ${latestFileName}: ${parsed.error ?? "invalid JSON"}`);
  }
  const detection = detectSourceProfile(parsed.dataset, registered);
  if (detection.status !== "match") {
    return fail(
      `Source auto-detection found no unambiguous profile (${detection.status}). ` +
        `Pass --profile <id>. Registered: ${registered.map((profile) => profile.id).join(", ")}`
    );
  }
  const match = registered.find((profile) => profile.id === detection.match.profileId)!;
  console.log(`Profile: ${match.id} v${match.version} (auto-detected from ${latestFileName})`);
  return match;
}

const { profile } = resolveEffectiveProfile(repoProfile, null);

const run = await runHeadlessAnalysis({
  baselineText,
  latestText,
  baselineFileName,
  latestFileName,
  profile,
  generatedAt
}).catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));

for (const issue of run.analysis.metadata.dateOrderingIssues) {
  console.warn(`Warning: ${issue.field}: baseline ${issue.baseline} is not older than latest ${issue.latest}`);
}

mkdirSync(outDir, { recursive: true });
for (const artifact of run.bundle.artifacts) {
  writeFileSync(join(outDir, artifact.fileName), artifact.content);
}

const { summary } = run.analysis;
console.log(`Compared ${baselineFileName} (baseline) → ${latestFileName} (latest) under ${profile.id} v${profile.version}.`);
console.log(
  `Records: ${summary.addedCount} added · ${summary.removedCount} removed · ${summary.changedCount} changed · ` +
    `match rate ${(run.review.match.matchRate * 100).toFixed(2)}% · ${run.review.qa.findings.length} finding(s).`
);
console.log(`Quality gate: ${summary.qualityGate}. Export gate: ${run.bundle.gate.recoveredExportAllowed ? "permitted" : "blocked"}.`);
for (const blocked of run.bundle.blocked) {
  console.log(`Withheld: ${blocked.kind} — ${blocked.reason}`);
}
console.log(`Wrote ${run.bundle.artifacts.length} artifact(s) to ${outDir}:`);
for (const artifact of run.bundle.artifacts) {
  console.log(`  ${artifact.fileName}`);
}

if (run.failures.length > 0) {
  console.error("\nQuality failure:");
  for (const reason of run.failures) {
    console.error(`  - ${reason}`);
  }
  console.error("Review the run in the browser UI to record decisions, then re-export.");
  process.exit(1);
}
console.log("Clean run.");
