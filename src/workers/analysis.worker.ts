/// <reference lib="webworker" />
import { runAnalysis } from "../engine/diff";
import { getCollection } from "../engine/normalize";
import { hashInputFile } from "../engine/export";
import { runRecoveryReview } from "../engine/review";
import { parseJSON } from "../engine/source-loader";
import { getProfile } from "../profiles";
import type { AnalyzeRequest, WorkerMessage } from "./protocol";

function post(message: WorkerMessage): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  void handle(event);
};

async function handle(event: MessageEvent<AnalyzeRequest>): Promise<void> {
  if (event.data.type !== "analyze") {
    return;
  }

  const payload = event.data.payload;
  // Echoed on every message so the listener can correlate answers to requests; the
  // worker is shared across runs and closure identity is not enough.
  const analysisKey = payload.analysisKey;

  try {
    // Reported before the work, so a parse failure is attributed to parsing rather
    // than arriving with no progress update at all.
    post({ type: "progress", payload: { analysisKey, step: "Parsing files" } });

    // Strips a UTF-8 BOM before parsing. Real scraper exports ship with one, and a
    // bare JSON.parse rejects them outright.
    const baseline = parseJSON(payload.baselineText, payload.baselineFileName);
    const latest = parseJSON(payload.latestText, payload.latestFileName);

    const failed = [baseline, latest].find((result) => !result.success);
    if (failed) {
      post({
        type: "error",
        payload: { analysisKey, message: `Could not parse ${failed.source}: ${failed.error ?? "invalid JSON"}` }
      });
      return;
    }

    const analysis = runAnalysis({
      baselineData: baseline.dataset,
      latestData: latest.dataset,
      config: payload.config,
      baselineFileName: payload.baselineFileName,
      latestFileName: payload.latestFileName,
      analysisKey: payload.analysisKey,
      profile: payload.profile,
      onProgress: (step) => post({ type: "progress", payload: { analysisKey, step } })
    });

    // The recovery review runs here rather than on the main thread: it walks every
    // record several times over, and the worker already holds the parsed data.
    const review = await buildReview(payload, baseline.dataset, latest.dataset);

    post({ type: "progress", payload: { analysisKey, step: "Ready" } });
    post({ type: "result", payload: { analysisKey, analysis, review } });
  } catch (error) {
    post({
      type: "error",
      payload: { analysisKey, message: error instanceof Error ? error.message : "Unknown analysis error" }
    });
  }
}

async function buildReview(
  payload: AnalyzeRequest["payload"],
  baselineData: unknown,
  latestData: unknown
): Promise<Awaited<ReturnType<typeof runRecoveryReview>> | null> {
  if (!payload.sourceProfileId) {
    return null;
  }

  const profile = getProfile(payload.sourceProfileId);
  if (!profile) {
    return null;
  }

  post({ type: "progress", payload: { analysisKey: payload.analysisKey, step: "Reviewing recovery" } });

  // Records come from the profile's own collection path, not the comparison config:
  // the profile is what governs recovery, so it must govern what recovery reads.
  const referenceRecords = getCollection(baselineData, profile.collectionPath);
  const candidateRecords = getCollection(latestData, profile.collectionPath);

  // Hashed here because this is where the file text is; SubtleCrypto is available in
  // a worker, and an insecure context yields a stated reason rather than an error.
  const inputHashes = await Promise.all([
    hashInputFile(payload.latestFileName, "candidate", payload.latestText),
    hashInputFile(payload.baselineFileName, "reference", payload.baselineText)
  ]);

  return runRecoveryReview(referenceRecords, candidateRecords, profile, {
    sourceRun: payload.latestFileName,
    referenceRun: payload.baselineFileName,
    inputHashes
  });
}
