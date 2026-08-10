/// <reference lib="webworker" />
import { runAnalysis } from "../engine/diff";
import { parseJSON } from "../engine/source-loader";
import type { AnalyzeRequest, WorkerMessage } from "./protocol";

function post(message: WorkerMessage): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  try {
    if (event.data.type !== "analyze") {
      return;
    }

    // Reported before the work, so a parse failure is attributed to parsing rather
    // than arriving with no progress update at all.
    post({ type: "progress", payload: { step: "Parsing files" } });

    // Strips a UTF-8 BOM before parsing. Real scraper exports ship with one, and a
    // bare JSON.parse rejects them outright.
    const baseline = parseJSON(event.data.payload.baselineText, event.data.payload.baselineFileName);
    const latest = parseJSON(event.data.payload.latestText, event.data.payload.latestFileName);

    const failed = [baseline, latest].find((result) => !result.success);
    if (failed) {
      post({
        type: "error",
        payload: { message: `Could not parse ${failed.source}: ${failed.error ?? "invalid JSON"}` }
      });
      return;
    }

    const result = runAnalysis({
      baselineData: baseline.dataset,
      latestData: latest.dataset,
      config: event.data.payload.config,
      baselineFileName: event.data.payload.baselineFileName,
      latestFileName: event.data.payload.latestFileName,
      analysisKey: event.data.payload.analysisKey,
      profile: event.data.payload.profile,
      onProgress: (step) => post({ type: "progress", payload: { step } })
    });

    post({ type: "progress", payload: { step: "Ready" } });
    post({ type: "result", payload: result });
  } catch (error) {
    post({ type: "error", payload: { message: error instanceof Error ? error.message : "Unknown analysis error" } });
  }
};
