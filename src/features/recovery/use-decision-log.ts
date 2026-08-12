import { useEffect, useState } from "react";
import { db } from "../../db";
import { orderDecisionLog, type RecoveryDecision } from "../../engine/decisions";
import type { RecoveryReview } from "../../engine/review";
import { useToastStore } from "../../stores/toast-store";

/**
 * The one decision log for a run, loaded from and appended to IndexedDB.
 *
 * Shared by the Recovery queue and the Explore tab so the two surfaces can
 * never read different logs for the same run. The scope key is
 * `review.generatedAt` — NOT the analysis key; nothing in the type system
 * distinguishes the two strings, which is exactly why this lives in one hook.
 *
 * Only one results tab renders at a time, so the two consumers never hold the
 * state concurrently; each mounts, loads, and appends against storage.
 */
export function useDecisionLog(review: RecoveryReview | null): {
  log: RecoveryDecision[];
  record: (next: RecoveryDecision[]) => void;
  analysisKey: string;
} {
  const showToast = useToastStore((state) => state.showToast);
  const [log, setLog] = useState<RecoveryDecision[]>([]);
  const analysisKey = review?.generatedAt ?? "";

  useEffect(() => {
    if (!review) return;
    let cancelled = false;
    void db.decisions
      .where("analysisKey")
      .equals(analysisKey)
      .toArray()
      // Storage returns rows in ITS order, not append order — and resolution is
      // last-entry-wins, so the order must be reconstructed from the recorded
      // sequence or a reload could flip which decision is in force.
      .then((rows) => {
        if (!cancelled) setLog(orderDecisionLog(rows));
      })
      .catch(() => {
        // A cache read failure must not hide the page; the log simply starts empty.
      });
    return () => {
      cancelled = true;
    };
  }, [review, analysisKey]);

  const record = (next: RecoveryDecision[]) => {
    // Persist everything appended since the last state, not just the final entry:
    // a bulk action adds hundreds at once and saving only the last would lose them.
    const appended = next.slice(log.length);
    setLog(next);
    if (appended.length === 0) return;

    void db.decisions
      .bulkPut(appended.map((decision) => ({ ...decision, analysisKey })))
      .catch(() => {
        showToast(
          `${appended.length} decision(s) recorded for this session but not saved in browser storage.`,
          "warning"
        );
      });
  };

  return { log, record, analysisKey };
}
