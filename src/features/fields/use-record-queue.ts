import { useEffect, useMemo } from "react";
import { cellId, type RecoveryDecision } from "../../engine/decisions";
import type { RecordSummary } from "../../engine/field-view";

export type QueueRow = RecordSummary & {
  /** Review-lane cells without a decision in force. */
  pendingCount: number;
  /** True when the record had review cells and every one now has a decision. */
  resolved: boolean;
};

export type RecordQueue = {
  rows: QueueRow[];
  index: number;
  current: QueueRow | null;
  progress: { resolvedRecords: number; recordsWithPending: number };
  previous: () => void;
  next: () => void;
  nextPending: () => void;
};

/**
 * The cursor for record-by-record work: position in the ordered record list,
 * exact per-record pending counts from the decision log, and the three moves
 * (previous, next, next-still-pending). Keyboard: j/k step, n jumps to the
 * next record with pending decisions — ignored while typing in a form field.
 */
export function useRecordQueue(
  summaries: RecordSummary[],
  resolved: Map<string, RecoveryDecision>,
  selectedRecordKey: string | null,
  onSelect: (recordKey: string) => void,
  keyboardEnabled: boolean
): RecordQueue {
  const rows = useMemo<QueueRow[]>(
    () =>
      summaries.map((summary) => {
        const pendingCount =
          summary.decisionRecordKey === null
            ? 0
            : summary.reviewFields.filter(
                (field) => !resolved.has(cellId(summary.decisionRecordKey!, field))
              ).length;
        return {
          ...summary,
          pendingCount,
          resolved: summary.reviewFields.length > 0 && pendingCount === 0
        };
      }),
    [summaries, resolved]
  );

  const index = useMemo(
    () => rows.findIndex((row) => row.recordKey === selectedRecordKey),
    [rows, selectedRecordKey]
  );
  const current = index >= 0 ? rows[index]! : null;

  const progress = useMemo(() => {
    let resolvedRecords = 0;
    let recordsWithPending = 0;
    for (const row of rows) {
      if (row.reviewFields.length === 0) continue;
      recordsWithPending += 1;
      if (row.resolved) resolvedRecords += 1;
    }
    return { resolvedRecords, recordsWithPending };
  }, [rows]);

  const step = (delta: number) => {
    if (rows.length === 0) return;
    const from = index >= 0 ? index : delta > 0 ? -1 : 0;
    const to = Math.min(rows.length - 1, Math.max(0, from + delta));
    onSelect(rows[to]!.recordKey);
  };

  const nextPending = () => {
    if (rows.length === 0) return;
    const from = index >= 0 ? index : -1;
    // Wrap around, so "next pending" from the last record finds earlier ones.
    for (let offset = 1; offset <= rows.length; offset += 1) {
      const row = rows[(from + offset) % rows.length]!;
      if (row.pendingCount > 0) {
        onSelect(row.recordKey);
        return;
      }
    }
  };

  useEffect(() => {
    if (!keyboardEnabled) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
        return;
      }
      if (event.key === "j") step(1);
      else if (event.key === "k") step(-1);
      else if (event.key === "n") nextPending();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return { rows, index, current, progress, previous: () => step(-1), next: () => step(1), nextPending };
}
