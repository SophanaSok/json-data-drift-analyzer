import type { AnalysisResult, ComparisonConfig, QualityProfile } from "../engine/types";

export type WorkerStep =
  | "Parsing files"
  | "Detecting record collection"
  | "Matching records"
  | "Comparing fields"
  | "Comparing documents"
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
