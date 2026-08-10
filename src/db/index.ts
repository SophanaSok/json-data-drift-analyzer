import Dexie, { type Table } from "dexie";
import type { AnalysisResult } from "../engine/types";
import type { RecoveryReview } from "../engine/review";
import type { RecoveryDecision } from "../engine/decisions";

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

/**
 * One recorded decision. The store is append-only: a change of mind adds a row,
 * and the latest row for a cell wins. Rows are never updated or deleted, because
 * the history is the audit trail.
 */
export type SavedDecision = RecoveryDecision & {
  /** Scopes decisions to the run they were made against. */
  analysisKey: string;
};

export type TextDiffCache = {
  id: string;
  baselineLength: number;
  latestLength: number;
};

class DriftDatabase extends Dexie {
  analyses!: Table<SavedAnalysis, string>;
  decisions!: Table<SavedDecision, string>;
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
    // Decisions are keyed by their own id and indexed by run, so a run's log can be
    // read back without scanning, and appending never overwrites an earlier entry.
    this.version(3).stores({
      analyses: "analysisKey, createdAt",
      decisions: "id, analysisKey, timestamp",
      textDiffs: "id"
    });
  }
}

export const db = new DriftDatabase();
