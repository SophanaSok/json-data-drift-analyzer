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
  /** The remembered session reason; editable per record before confirming. */
  sessionReason: string;
};

/**
 * Accept or keep every pending value for one record.
 *
 * A per-record batch spans several fields, which normally makes the engine
 * skip every rule-6 date-sensitive cell. Here the user is looking at each
 * field name and value on one screen, so the batch may cover them — behind a
 * confirmation that names the rule and every affected field, passed to the
 * engine as an explicit acknowledged-fields list (§6.2's "distinct
 * confirmation, with the rule stated in the dialog").
 */
export function RecordBulkBar({ recordKey, pendingCells, profile, log, makeContext, onRecord, sessionReason }: RecordBulkBarProps) {
  const [reason, setReason] = useState(sessionReason);
  const [pending, setPending] = useState<"backfill" | "keep_candidate" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  // After a successful apply pendingCells drops to zero — the outcome must
  // outlive the controls, or the confirmation the user just earned vanishes.
  if (pendingCells.length === 0 && outcome === null && error === null) return null;

  const dateSensitiveFields = pendingCells
    .map((cell) => cell.field)
    .filter((field) => (profile.dateSensitiveFields ?? []).includes(field));
  const needsAcknowledgment = pending === "backfill" && dateSensitiveFields.length > 0;

  const apply = (action: "backfill" | "keep_candidate") => {
    setError(null);
    try {
      const result = createBulkDecisions(
        pendingCells,
        {
          action,
          reason,
          ...(action === "backfill" && acknowledged ? { acknowledgedDateSensitiveFields: dateSensitiveFields } : {})
        },
        makeContext()
      );
      onRecord(appendDecisions(log, result.decisions));
      setOutcome(
        `Recorded ${result.applied} decision(s) for ${recordKey}.` +
          (result.skipped.length > 0 ? ` Skipped ${result.skipped.length}.` : "")
      );
      setPending(null);
      setAcknowledged(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not record the decisions.");
      setPending(null);
    }
  };

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3" data-testid="record-bulk-bar">
      {pendingCells.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[14rem] flex-1 rounded border border-slate-300 p-1 text-xs"
          placeholder="Reason for this record's decisions (required)"
          data-testid="record-bulk-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs text-sky-700 hover:bg-slate-100"
          data-testid="record-accept-all"
          onClick={() => {
            setOutcome(null);
            setAcknowledged(false);
            setPending("backfill");
          }}
        >
          Accept all {pendingCells.length} reference value(s)
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs text-sky-700 hover:bg-slate-100"
          data-testid="record-keep-all"
          onClick={() => {
            setOutcome(null);
            setPending("keep_candidate");
          }}
        >
          Keep all candidate values
        </button>
      </div>
      ) : null}

      {pending ? (
        <div className="mt-2 rounded border border-amber-400 bg-amber-50 p-2" data-testid="record-bulk-confirm">
          <p className="text-xs text-amber-900">
            Record <strong>{pendingCells.length}</strong> decision(s) for <strong>{recordKey}</strong> —{" "}
            {pending === "backfill" ? "use each field's reference value" : "keep each candidate value"}? Fields:{" "}
            {pendingCells.map((cell) => cell.field).join(", ")}.
          </p>
          {needsAcknowledgment ? (
            <label className="mt-2 flex items-start gap-2 text-xs text-amber-900" data-testid="rule6-acknowledgment">
              <input
                type="checkbox"
                checked={acknowledged}
                data-testid="rule6-acknowledge-check"
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                <strong>{dateSensitiveFields.join(", ")}</strong> {dateSensitiveFields.length === 1 ? "is" : "are"}{" "}
                <strong>rule-6 date-sensitive</strong>: automatic backfill requires explicit approval. I am approving
                these reference values for this record, having seen them above.
              </span>
            </label>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded border border-amber-500 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100 disabled:opacity-40"
              data-testid="record-bulk-apply"
              disabled={needsAcknowledgment && !acknowledged}
              title={needsAcknowledgment && !acknowledged ? "Acknowledge the rule-6 fields first" : undefined}
              onClick={() => apply(pending)}
            >
              Yes, record them
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              data-testid="record-bulk-cancel"
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900" role="alert" data-testid="record-bulk-error">
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
