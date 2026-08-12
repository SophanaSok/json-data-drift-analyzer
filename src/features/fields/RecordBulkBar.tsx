import { useState } from "react";
import {
  appendDecisions,
  createBulkDecisions,
  type CellClassification,
  type DecisionContext,
  type RecoveryDecision
} from "../../engine/decisions";
import type { SourceProfile } from "../../engine/adapter-types";

type RecordBulkBarProps = {
  recordKey: string;
  /** The record's review-lane cells still without a decision. */
  pendingCells: CellClassification[];
  profile: SourceProfile;
  log: RecoveryDecision[];
  makeContext: () => DecisionContext;
  onRecord: (log: RecoveryDecision[]) => void;
  /** Live session reason — a prop, not seed state, so edits reach the open record. */
  reason: string;
  onReasonChange: (reason: string) => void;
  /** Date-sensitive fields already approved for this session, or null if none. */
  acknowledgedFields: string[] | null;
  onAcknowledge: (fields: string[]) => void;
  /** Called after decisions are recorded, so the queue can advance. */
  onRecorded?: (applied: number) => void;
};

/**
 * Accept or keep every pending value for one record.
 *
 * A per-record batch spans several fields, which makes the engine skip
 * date-sensitive cells unless they are explicitly acknowledged. That
 * acknowledgment is taken once per session — `docs/recovery-workflow.proposed.md`
 * §6.2 specifies the rule-6 confirmation "per source", and re-certifying the
 * same four field names on all 499 records trains click-through rather than
 * deliberation.
 */
export function RecordBulkBar({
  recordKey,
  pendingCells,
  profile,
  log,
  makeContext,
  onRecord,
  reason,
  onReasonChange,
  acknowledgedFields,
  onAcknowledge,
  onRecorded
}: RecordBulkBarProps) {
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const dateSensitiveFields = [
    ...new Set(
      pendingCells.map((cell) => cell.field).filter((field) => (profile.dateSensitiveFields ?? []).includes(field))
    )
  ].sort();

  // The engine only skips date-sensitive cells when the batch spans more than
  // one field. A record down to its last rule-6 field needs no acknowledgment —
  // blocking it would be friction with nothing behind it.
  const batchFields = new Set(pendingCells.map((cell) => cell.field));
  const engineWouldSkip = dateSensitiveFields.length > 0 && batchFields.size > 1;
  const covered =
    !engineWouldSkip ||
    (acknowledgedFields !== null && dateSensitiveFields.every((field) => acknowledgedFields.includes(field)));

  if (pendingCells.length === 0 && outcome === null && error === null) return null;

  const apply = (action: "backfill" | "keep_candidate") => {
    setError(null);
    try {
      const result = createBulkDecisions(
        pendingCells,
        {
          action,
          reason,
          ...(action === "backfill" && covered && engineWouldSkip
            ? { acknowledgedDateSensitiveFields: dateSensitiveFields }
            : {})
        },
        makeContext()
      );
      onRecord(appendDecisions(log, result.decisions));
      setOutcome(
        `Recorded ${result.applied} decision(s) for ${recordKey}.` +
          (result.skipped.length > 0 ? ` Skipped ${result.skipped.length}.` : "")
      );
      onRecorded?.(result.applied);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not record the decisions.");
    }
  };

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3" data-testid="record-bulk-bar">
      {pendingCells.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="min-w-[14rem] flex-1 rounded border border-slate-300 p-1 text-xs"
              placeholder="Reason for this record's decisions (required)"
              data-testid="record-bulk-reason"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
            />
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs text-sky-700 hover:bg-slate-100 disabled:opacity-40"
              data-testid="record-accept-all"
              disabled={!covered}
              title={covered ? undefined : "Approve the rule-6 fields first"}
              onClick={() => {
                setOutcome(null);
                apply("backfill");
              }}
            >
              Accept all {pendingCells.length} reference value(s)
              <span className="ml-1 text-slate-400">a</span>
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs text-sky-700 hover:bg-slate-100"
              data-testid="record-keep-all"
              onClick={() => {
                setOutcome(null);
                apply("keep_candidate");
              }}
            >
              Keep all candidate values
              <span className="ml-1 text-slate-400">x</span>
            </button>
          </div>

          {engineWouldSkip && !covered ? (
            <div className="mt-2 rounded border border-amber-400 bg-amber-50 p-2" data-testid="rule6-acknowledgment">
              <p className="text-xs text-amber-900">
                <strong>{dateSensitiveFields.join(", ")}</strong>{" "}
                {dateSensitiveFields.length === 1 ? "is" : "are"} <strong>rule-6 date-sensitive</strong>: automatic
                backfill requires explicit approval. Approving here covers these fields for this source, for the rest
                of this session — every decision still records its own reason, and you can revoke it at any time.
              </p>
              <button
                type="button"
                className="mt-2 rounded border border-amber-500 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                data-testid="rule6-approve"
                onClick={() => onAcknowledge(dateSensitiveFields)}
              >
                I approve these fields for this source
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p
          className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900"
          role="alert"
          data-testid="record-bulk-error"
        >
          {error}
        </p>
      ) : null}
      {outcome ? (
        <p className="mt-2 text-xs text-emerald-800" role="alert" data-testid="record-bulk-outcome">
          {outcome}
        </p>
      ) : null}
    </div>
  );
}
