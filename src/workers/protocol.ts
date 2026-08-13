import type { AnalysisResult, ComparisonConfig } from "../engine/types";
import type { RecoveryReview } from "../engine/review";
import type { ResolvedSourceProfile } from "../profiles/resolve";

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
  /** Emitted while the recovery pipeline runs, after the drift analysis. */
  | "Reviewing recovery"
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
    /**
     * The fully resolved source profile: base + delta + any local override,
     * stamped with its policy identity. The worker must never resolve policy
     * itself — override state lives in the main thread's IndexedDB, and a
     * worker-side lookup could race a mid-run override edit. Governs the
     * recovery review AND supplies the quality-analysis configuration (via
     * toQualityProfile). Absent means no recovery review and the deprecated
     * default quality profile.
     */
    sourceProfile?: ResolvedSourceProfile;
  };
};

/**
 * Every message echoes the request's analysisKey. The worker is a singleton shared
 * across runs, so without the echo a listener cannot tell which request a message
 * answers — and a result correlated by closure alone can be cached under a LATER
 * request's key, permanently mislabeling the analysis (see analysis-runner.ts).
 */
export type WorkerMessage =
  | { type: "progress"; payload: { analysisKey: string; step: WorkerStep } }
  /**
   * The drift analysis, plus the recovery review when a source profile applied.
   * Both travel together so a cached run cannot hold one without the other.
   */
  | {
      type: "result";
      payload: { analysisKey: string; analysis: AnalysisResult; review: RecoveryReview | null };
    }
  | { type: "error"; payload: { analysisKey: string; message: string } };
