/// <reference lib="webworker" />
import { runAnalysis } from "../engine/diff";
import type { AnalyzeRequest, WorkerStep, WorkerMessage } from "./protocol";

const steps: WorkerStep[] = [
  "Parsing files",
  "Detecting record collection",
  "Matching records",
  "Comparing fields",
  "Comparing documents",
  "Profiling field health",
  "Building fast indexes",
  "Ready"
];

function post(message: WorkerMessage): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  try {
    if (event.data.type !== "analyze") {
      return;
    }

    for (const step of steps.slice(0, -1)) {
      post({ type: "progress", payload: { step } });
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
      profile: event.data.payload.profile
    });

    post({ type: "progress", payload: { step: "Ready" } });
    post({ type: "result", payload: result });
  } catch (error) {
    post({ type: "error", payload: { message: error instanceof Error ? error.message : "Unknown analysis error" } });
  }
};
