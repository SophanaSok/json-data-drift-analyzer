/**
 * One entry point for the whole recovery pipeline.
 *
 * Match -> QA -> recover -> dedupe, in that order, with each stage fed the previous
 * stage's output. The ordering is not incidental: recovery can populate the fields
 * dedupe scores for completeness, and dedupe takes a RecoveryResult precisely so it
 * cannot run first.
 *
 * The chain was previously spelled out in every test file and would have been spelled
 * out again in the worker and the UI. Having it once means the app and the tests
 * cannot disagree about what "running recovery" means.
 */

import { matchRecords, type MatchReport } from "./matchRecords";
import { runQa, type QaReport } from "./qa";
import { runRecovery, type RecoveryOptions, type RecoveryResult } from "./recovery";
import { runDedupe, type DedupeResult } from "./dedupe";
import type { InputFileHash } from "./export";
import type { PolicyStamp, SourceProfile } from "./adapter-types";

export type RecoveryReview = {
  profileId: string;
  profileVersion: number;
  /** Hash of the resolved policy this review ran under; null when unstamped. */
  policyHash: string | null;
  /** Local-override revision active during the run; 0 when none. */
  overrideRevision: number;
  generatedAt: string;
  sourceRun: string | null;
  referenceRun: string | null;
  /** SHA-256 of the input files, or a stated reason they are unavailable. */
  inputHashes: InputFileHash[];
  match: MatchReport;
  qa: QaReport;
  recovery: RecoveryResult;
  dedupe: DedupeResult;
};

export type RecoveryReviewOptions = {
  /** ISO-8601. Injectable so identical inputs produce identical output. */
  generatedAt?: string;
  sourceRun?: string;
  referenceRun?: string;
  inputHashes?: InputFileHash[];
  manualOverrides?: RecoveryOptions["manualOverrides"];
};

export function runRecoveryReview(
  referenceRecords: Array<Record<string, unknown>>,
  candidateRecords: Array<Record<string, unknown>>,
  profile: SourceProfile & PolicyStamp,
  options: RecoveryReviewOptions = {}
): RecoveryReview {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const shared = {
    generatedAt,
    sourceRun: options.sourceRun,
    referenceRun: options.referenceRun
  };

  const match = matchRecords(referenceRecords, candidateRecords, profile);
  const qa = runQa(referenceRecords, candidateRecords, profile, { ...shared, matchReport: match });
  const recovery = runRecovery(candidateRecords, referenceRecords, profile, match, qa.findings, {
    ...shared,
    manualOverrides: options.manualOverrides
  });
  const dedupe = runDedupe(recovery, candidateRecords, profile, { generatedAt });

  return {
    profileId: profile.id,
    profileVersion: profile.version,
    policyHash: profile.policyHash ?? null,
    overrideRevision: profile.overrideRevision ?? 0,
    generatedAt,
    sourceRun: options.sourceRun ?? null,
    referenceRun: options.referenceRun ?? null,
    inputHashes: options.inputHashes ?? [],
    match,
    qa,
    recovery,
    dedupe
  };
}
