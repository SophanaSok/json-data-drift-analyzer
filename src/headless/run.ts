import { runAnalysis } from "../engine/diff";
import { buildExportBundle, hashInputFile, type ExportBundle } from "../engine/export";
import { getCollection } from "../engine/normalize";
import { runRecoveryReview, type RecoveryReview } from "../engine/review";
import { parseJSON } from "../engine/source-loader";
import type { AnalysisResult } from "../engine/types";
import { toQualityProfile, type ResolvedSourceProfile } from "../profiles/resolve";

export type HeadlessInput = {
  baselineText: string;
  latestText: string;
  baselineFileName: string;
  latestFileName: string;
  profile: ResolvedSourceProfile;
  /** ISO-8601. Injectable so identical inputs produce identical artifacts. */
  generatedAt?: string;
};

export type HeadlessRun = {
  analysis: AnalysisResult;
  review: RecoveryReview;
  bundle: ExportBundle;
  /**
   * Human-readable reasons this run should fail a quality gate (empty = clean).
   * A parse failure throws instead — there is nothing to report on.
   */
  failures: string[];
};

/**
 * The analysis worker's pipeline, runnable anywhere: parse → drift analysis →
 * recovery review → export bundle, with no decisions log — byte-identical to a
 * browser run before any human decision is recorded.
 *
 * This is what lets detection run per export drop (a scheduled `npm run
 * analyze`) while humans stay in the browser for the decide-and-recover work.
 *
 * @throws Error naming the offending file when either input is not valid JSON
 */
export async function runHeadlessAnalysis(input: HeadlessInput): Promise<HeadlessRun> {
  const { profile } = input;

  const baseline = parseJSON(input.baselineText, input.baselineFileName);
  const latest = parseJSON(input.latestText, input.latestFileName);
  const failed = [baseline, latest].find((result) => !result.success);
  if (failed) {
    throw new Error(`Could not parse ${failed.source}: ${failed.error ?? "invalid JSON"}`);
  }

  // Same comparison config the upload page derives from the profile before any
  // manual edits: the profile's collection path and default identity, nothing
  // ignored.
  const analysis = runAnalysis({
    baselineData: baseline.dataset,
    latestData: latest.dataset,
    config: {
      collectionPath: profile.collectionPath,
      identityFields: profile.quality.identityDefault,
      ignoredFields: [],
      profileId: profile.id
    },
    baselineFileName: input.baselineFileName,
    latestFileName: input.latestFileName,
    analysisKey: "headless",
    profile: toQualityProfile(profile)
  });

  // Recovery reads the profile's own collection path, mirroring the worker.
  const referenceRecords = getCollection(baseline.dataset, profile.collectionPath);
  const candidateRecords = getCollection(latest.dataset, profile.collectionPath);
  const inputHashes = await Promise.all([
    hashInputFile(input.latestFileName, "candidate", input.latestText),
    hashInputFile(input.baselineFileName, "reference", input.baselineText)
  ]);
  const review = runRecoveryReview(referenceRecords, candidateRecords, profile, {
    sourceRun: input.latestFileName,
    referenceRun: input.baselineFileName,
    inputHashes,
    generatedAt: input.generatedAt
  });

  const bundle = buildExportBundle({
    profile,
    qa: review.qa,
    recovery: review.recovery,
    dedupe: review.dedupe,
    generatedAt: review.generatedAt,
    inputHashes: review.inputHashes,
    sourceRun: review.sourceRun,
    referenceRun: review.referenceRun
  });

  return { analysis, review, bundle, failures: collectFailures(analysis, bundle) };
}

/** Every reason the run fails quality, in display order; empty means clean. */
function collectFailures(analysis: AnalysisResult, bundle: ExportBundle): string[] {
  const failures: string[] = [];
  if (analysis.summary.qualityGate === "Quarantined") {
    failures.push("Drift quality gate is Quarantined — critical quality issues are open.");
  }
  if (!bundle.gate.recoveredExportAllowed) {
    failures.push(`Recovered data export is blocked: ${bundle.gate.blockingReasons.join(" ")}`);
  } else if (bundle.gate.criticalFindingCount > 0) {
    failures.push(`${bundle.gate.criticalFindingCount} critical finding(s) are unresolved.`);
  }
  return failures;
}
