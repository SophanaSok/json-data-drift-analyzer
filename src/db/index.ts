import Dexie, { type Table } from "dexie";
import type { AnalysisResult } from "../engine/types";
import type { RecoveryReview } from "../engine/review";
import type { RecoveryDecision } from "../engine/decisions";
import type { PostedTicketRecord, TrelloTarget } from "../features/trello/trello-ticket";
import type { ProfileOverride } from "../profiles/schema";

/**
 * Version of the persisted analysis/review shape, folded into the analysis cache
 * key. Bump it whenever `AnalysisResult` or `RecoveryReview` gains or changes a
 * field: entries written under the old shape then miss the cache and are rebuilt,
 * instead of being served with fields the current code assumes exist.
 */
export const ANALYSIS_CACHE_SCHEMA_VERSION = 3;

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

/**
 * Trello posting attempts, append-only. Carries no token, no API key, and no card
 * body — only a hash of what was sent.
 */
export type SavedPostedTicket = PostedTicketRecord;

/**
 * Non-secret Trello target. The token is deliberately absent: it lives in memory for
 * the session, or in sessionStorage only if the user opts in. See
 * docs/trello-integration.proposed.md section 7.
 */
export type SavedTrelloTarget = TrelloTarget;

export type TextDiffCache = {
  id: string;
  baselineLength: number;
  latestLength: number;
};

/**
 * A local per-source policy override: a delta applied over the repo profile at
 * resolution time (see src/profiles/resolve.ts). One row per profile. The
 * `reason` is required — an override is a policy decision and must be
 * auditable (AGENTS.md rule 7); the resolved policy hash changes with it, so
 * every artifact records that it ran under the override.
 */
export type SavedProfileOverride = ProfileOverride;

class DriftDatabase extends Dexie {
  analyses!: Table<SavedAnalysis, string>;
  decisions!: Table<SavedDecision, string>;
  postedTickets!: Table<SavedPostedTicket, string>;
  trelloTarget!: Table<SavedTrelloTarget, string>;
  textDiffs!: Table<TextDiffCache, string>;
  profileOverrides!: Table<SavedProfileOverride, string>;

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
    // postedTickets is indexed by fingerprint so the duplicate check is a lookup, not
    // a scan. trelloTarget holds one row and never holds the token.
    this.version(4).stores({
      analyses: "analysisKey, createdAt",
      decisions: "id, analysisKey, timestamp",
      postedTickets: "id, runFingerprint, analysisKey, attemptedAt",
      trelloTarget: "id",
      textDiffs: "id"
    });
    // Dexie only deletes an object store when a version names it null; the v2
    // schema merely omitted `profiles`, so databases created at v1 still carry
    // the orphaned store. This drops it for real.
    this.version(5).stores({
      analyses: "analysisKey, createdAt",
      decisions: "id, analysisKey, timestamp",
      postedTickets: "id, runFingerprint, analysisKey, attemptedAt",
      trelloTarget: "id",
      textDiffs: "id",
      profiles: null
    });
    // Deliberately NOT named `profiles` (the store v5 deletes): this table
    // stores DELTAS over repo profiles, never whole profiles — the repo files
    // stay the source of truth and an override is a local amendment to them.
    this.version(6).stores({
      analyses: "analysisKey, createdAt",
      decisions: "id, analysisKey, timestamp",
      postedTickets: "id, runFingerprint, analysisKey, attemptedAt",
      trelloTarget: "id",
      textDiffs: "id",
      profileOverrides: "profileId, updatedAt"
    });
  }
}

export const db = new DriftDatabase();

/**
 * Cap on cached analyses. Each SavedAnalysis holds the full record graph, the
 * serialized search index, and every finding — several MB apiece. Without a cap
 * the cache only ever grows, and once browser quota is hit every later `put`
 * fails forever. Twenty entries comfortably covers a working week of runs while
 * staying far from any realistic quota.
 */
export const ANALYSIS_CACHE_MAX_ENTRIES = 20;

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = (error as { name?: string }).name;
  // Dexie wraps the DOMException; the inner error keeps the original name.
  const inner = (error as { inner?: { name?: string } }).inner;
  return name === "QuotaExceededError" || inner?.name === "QuotaExceededError";
}

/** The slice of the analyses table the bounded put needs; injectable for tests. */
export type AnalysesTableLike = {
  put: (entry: SavedAnalysis) => Promise<unknown>;
  count: () => Promise<number>;
  bulkDelete: (keys: string[]) => Promise<unknown>;
  orderBy: (index: "createdAt") => { limit: (n: number) => { primaryKeys: () => Promise<string[]> } };
};

/**
 * Delete the oldest cached analyses until at most `keep` remain.
 * Uses the createdAt index, so this is a range read, not a table scan.
 */
async function evictOldestAnalyses(table: AnalysesTableLike, keep: number): Promise<void> {
  const count = await table.count();
  const excess = count - keep;
  if (excess <= 0) {
    return;
  }
  const oldestKeys = await table.orderBy("createdAt").limit(excess).primaryKeys();
  await table.bulkDelete(oldestKeys);
}

/**
 * Cache an analysis, keeping the cache bounded.
 *
 * After every write the oldest entries beyond ANALYSIS_CACHE_MAX_ENTRIES are
 * evicted. If the write itself hits browser quota, the whole cache is evicted
 * and the write retried once — the cache is an optimization, and a full cache
 * must never make caching fail forever. A second failure propagates to the
 * caller, which already degrades to session-only with a toast.
 */
export async function putAnalysisBounded(entry: SavedAnalysis, table: AnalysesTableLike = db.analyses): Promise<void> {
  try {
    await table.put(entry);
  } catch (error) {
    if (!isQuotaError(error)) {
      throw error;
    }
    await evictOldestAnalyses(table, 0);
    await table.put(entry);
  }
  await evictOldestAnalyses(table, ANALYSIS_CACHE_MAX_ENTRIES);
}

// ---------------------------------------------------------------------------
// Profile overrides
// ---------------------------------------------------------------------------

/** The slice of the overrides table the helpers need; injectable for tests. */
export type ProfileOverridesTableLike = {
  get: (key: string) => Promise<SavedProfileOverride | undefined>;
  put: (row: SavedProfileOverride) => Promise<unknown>;
  delete: (key: string) => Promise<unknown>;
};

/**
 * Read a profile's local override. Degrades to "no override" on a failing
 * IndexedDB (private browsing, corrupted DB): analysis must still run — it
 * just runs under the unmodified repo policy, which the resolved policy hash
 * records faithfully either way.
 */
export async function getProfileOverride(
  profileId: string,
  table: ProfileOverridesTableLike = db.profileOverrides
): Promise<SavedProfileOverride | null> {
  const row = await table.get(profileId).catch(() => undefined);
  return row ?? null;
}

/**
 * Save (create or replace) a profile's local override. Write failures
 * propagate: unlike a cache miss, a policy edit the user believes was saved
 * but was not is a silent policy divergence.
 */
export async function putProfileOverride(
  override: SavedProfileOverride,
  table: ProfileOverridesTableLike = db.profileOverrides
): Promise<void> {
  await table.put(override);
}

/** Remove a profile's local override, restoring the repo policy. */
export async function deleteProfileOverride(
  profileId: string,
  table: ProfileOverridesTableLike = db.profileOverrides
): Promise<void> {
  await table.delete(profileId);
}
