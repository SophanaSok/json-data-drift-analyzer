import Dexie, { type Table } from "dexie";
import type { AnalysisResult } from "../engine/types";
import type { RecoveryReview } from "../engine/review";

export type SavedAnalysis = {
  analysisKey: string;
  createdAt: string;
  result: AnalysisResult;
  /**
   * Recovery review for the same run. Stored alongside rather than separately so a
   * cache hit can never serve an analysis with a review from a different policy.
   * The analysis key includes the source profile id and version, so approving a
   * field invalidates the cache rather than silently reusing the old outcome.
   */
  review?: RecoveryReview | null;
};

export type TextDiffCache = {
  id: string;
  baselineLength: number;
  latestLength: number;
};

class DriftDatabase extends Dexie {
  analyses!: Table<SavedAnalysis, string>;
  textDiffs!: Table<TextDiffCache, string>;

  constructor() {
    super("json-data-drift-analyzer");
    this.version(1).stores({
      analyses: "analysisKey, createdAt",
      profiles: "id",
      textDiffs: "id"
    });
    this.version(2).stores({
      analyses: "analysisKey, createdAt",
      textDiffs: "id"
    });
  }
}

export const db = new DriftDatabase();
