import { useState } from "react";
import {
  appendDecisions,
  assessBulkImpact,
  createBulkDecisions,
  type BulkDecisionInput,
  type CellClassification,
  type DecisionContext,
  type RecoveryDecision
} from "../../engine/decisions";
import type { FieldCell } from "../../engine/field-view";
import type { SourceProfile } from "../../engine/adapter-types";

type FieldBulkBarProps = {
  field: string;
  /** The cells currently visible under the active filters. */
  visibleCells: FieldCell[];
  /** Words describing the active filter scope, e.g. "candidate blank · value bids@cob.org". */
  scopeDescription: string;
  profile: SourceProfile;
  log: RecoveryDecision[];
  makeContext: () => DecisionContext;
  onRecord: (log: RecoveryDecision[]) => void;
};

/**
 * Bulk decisions scoped to what the user is looking at: the filtered rows of
 * one field. The scope is named in words next to the count — once two filters
 * stack, a bare "238" is meaningless.
 *
 * Being single-field by construction, a rule-6 field can be bulk-decided here
 * directly — the queue requires filtering to one field first, and this view IS
 * that filter. The confirmation still names the rule.
 */
export function FieldBulkBar({ field, visibleCells, scopeDescription, profile, log, makeContext, onRecord }: FieldBulkBarProps) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<BulkDecisionInput["action"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const decidable: CellClassification[] = visibleCells
    .map((cell) => cell.classification)
    .filter((classification): classification is CellClassification => classification !== null);
  const autoCount = decidable.filter((cell) => cell.lane === "auto").length;
  const impact = assessBulkImpact(decidable, profile);
  const dateSensitive = (profile.dateSensitiveFields ?? []).includes(field);

  if (decidable.length === 0) return null;

  const apply = (action: BulkDecisionInput["action"]) => {
    setError(null);
    try {
      const result = createBulkDecisions(decidable, { action, reason }, makeContext());
      onRecord(appendDecisions(log, result.decisions));
      const skipReasons = [...new Set(result.skipped.map((cell) => cell.reason))];
      setOutcome(
        `Recorded ${result.applied} decision(s).` +
          (result.skipped.length > 0 ? ` Skipped ${result.skipped.length}: ${skipReasons.join(" ")}` : "")
      );
      setReason("");
      setPending(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not record the decisions.");
      setPending(null);
    }
  };

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3" data-testid="field-bulk-bar">
      <p className="text-xs font-medium" data-testid="bulk-scope">
        Apply to all {decidable.length} decidable cell(s) for {field}
        {scopeDescription ? ` matching: ${scopeDescription}` : ""}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Each cell gets its own matched reference value, never a shared one.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="min-w-[14rem] flex-1 rounded border border-slate-300 p-1 text-xs"
          placeholder="Reason for all of them (required)"
          data-testid="bulk-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs text-sky-700 hover:bg-slate-100"
          data-testid="bulk-backfill"
          onClick={() => {
            setOutcome(null);
            setPending("backfill");
          }}
        >
          Use reference for all
        </button>
        <button
          type="button"
          className={`rounded border px-2 py-1 text-xs ${autoCount > 0 ? "border-red-300 text-red-900 hover:bg-red-50" : "text-sky-700 hover:bg-slate-100"}`}
          data-testid="bulk-keep"
          onClick={() => {
            setOutcome(null);
            setPending("keep_candidate");
          }}
        >
          {autoCount > 0 ? `Veto / keep candidate for all` : "Keep candidate for all"}
        </button>
      </div>

      {pending ? (
        <div className="mt-2 rounded border border-amber-400 bg-amber-50 p-2" data-testid="bulk-confirm">
          <p className="text-xs text-amber-900">
            Record <strong>{decidable.length}</strong> decision(s) —{" "}
            {pending === "backfill" ? "use each record's matched reference value" : "keep each candidate value"} for{" "}
            {field}? This appends {decidable.length} entries to the log.
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-amber-900" data-testid="bulk-breakdown">
            {pending === "backfill" ? (
              <>
                <li>{impact.fillBlank} fill a blank candidate value</li>
                <li>
                  {impact.overwritePopulated} <strong>overwrite a populated candidate value</strong>
                </li>
              </>
            ) : autoCount > 0 ? (
              <li>
                {autoCount} <strong>veto an already-applied automatic backfill</strong> — the candidate value is
                written back to the artifact
              </li>
            ) : null}
            {dateSensitive ? (
              <li>
                {field} is <strong>rule-6 date-sensitive</strong>. A bulk decision here is permitted because every
                cell in this batch is this one field; the reason above goes on every entry.
              </li>
            ) : null}
          </ul>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded border border-amber-500 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
              data-testid="bulk-confirm-apply"
              onClick={() => apply(pending)}
            >
              Yes, record them
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              data-testid="bulk-confirm-cancel"
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900" role="alert" data-testid="bulk-error">
          {error}
        </p>
      ) : null}
      {outcome ? (
        <p className="mt-2 text-xs text-emerald-800" role="alert" data-testid="bulk-outcome">
          {outcome}
        </p>
      ) : null}
    </div>
  );
}
