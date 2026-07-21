/// <reference lib="webworker" />
import { runAnalysis } from "../engine/diff";
import type { AnalyzeRequest, WorkerMessage } from "./protocol";

function post(message: WorkerMessage): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  try {
    if (event.data.type !== "analyze") {
      return;
    }

    const baselineData = JSON.parse(event.data.payload.baselineText) as unknown;
    const latestData = JSON.parse(event.data.payload.latestText) as unknown;

    const result = runAnalysis({
      baselineData,
      latestData,
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
