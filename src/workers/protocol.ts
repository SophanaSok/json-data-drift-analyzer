import type { AnalysisResult, ComparisonConfig, QualityProfile } from "../engine/types";

export type WorkerStep =
  /** Emitted by the worker, which is where parsing actually happens. */
  | "Parsing files"
  /** Everything below is emitted by runAnalysis, which receives parsed data. */
  | "Reading export metadata"
  | "Detecting record collection"
  | "Matching records"
  // Fields and documents are compared in one pass, so they share one step.
  | "Comparing fields and documents"
  | "Profiling field health"
  | "Building fast indexes"
  | "Ready";

export type AnalyzeRequest = {
  type: "analyze";
  payload: {
    baselineFileName: string;
    latestFileName: string;
    baselineText: string;
    latestText: string;
    config: ComparisonConfig;
    analysisKey: string;
    profile?: QualityProfile;
  };
};

export type WorkerMessage =
  | { type: "progress"; payload: { step: WorkerStep } }
  | { type: "result"; payload: AnalysisResult }
  | { type: "error"; payload: { message: string } };
