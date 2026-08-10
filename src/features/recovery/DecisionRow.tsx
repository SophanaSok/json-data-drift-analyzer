import { useState } from "react";
import {
  appendDecision,
  createDecision,
  type CellClassification,
  type DecisionAction,
  type DecisionContext,
  type RecoveryDecision
} from "../../engine/decisions";
import { ACTION_LABEL, preview } from "./decision-display";

/**
 * One queued cell and its decision form.
 *
 * Separate from the virtualized list so the part that matters -- recording a
 * decision, and refusing one that cannot be audited -- is testable without a layout
 * engine. The engine refuses; this only surfaces the reason.
 */
export function DecisionRow({
  cell,
  decision,
  log,
  context,
  onRecord,
  index
}: {
  cell: CellClassification;
  decision: RecoveryDecision | undefined;
  log: RecoveryDecision[];
  context: DecisionContext;
  onRecord: (log: RecoveryDecision[]) => void;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const record = (action: DecisionAction) => {
    setError(null);
    try {
      const entry = createDecision(
        {
          recordKey: cell.recordKey,
          field: cell.field,
          action,
          // An empty box means "no value supplied", not "set this to empty".
          // Deliberately blanking a value should not be a two-click accident.
          customValue: action === "use_custom" && customValue.trim().length > 0 ? customValue : undefined,
          reason
        },
        cell,
        context
      );
      onRecord(appendDecision(log, entry));
      setReason("");
      setCustomValue("");
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not record the decision.");
    }
  };

  return (
    <div className="p-2 text-sm" data-testid={`queue-row-${index}`}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs">{cell.field}</code>
        <span className="text-xs text-slate-500">
          candidate {preview(cell.candidateValue)} → reference {preview(cell.referenceValue)}
        </span>
        {decision ? (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900" data-testid="cell-decided">
            decided: {ACTION_LABEL[decision.action]}
          </span>
        ) : null}
        <button
          className="ml-auto rounded border px-2 py-0.5 text-xs text-sky-700 hover:bg-slate-100"
          data-testid={`decide-${index}`}
          onClick={() => {
            setOpen(!open);
            setError(null);
          }}
        >
          {open ? "Cancel" : decision ? "Change" : "Decide"}
        </button>
      </div>

      {error ? (
        <p className="mt-1 rounded border border-red-300 bg-red-50 p-1 text-xs text-red-900" data-testid="decision-error">
          {error}
        </p>
      ) : null}

      {open ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="decision-form">
          <input
            className="min-w-[12rem] flex-1 rounded border border-slate-300 p-1 text-xs"
            placeholder="Reason (required)"
            data-testid="decision-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <input
            className="w-40 rounded border border-slate-300 p-1 text-xs"
            placeholder="Custom value"
            data-testid="decision-custom"
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
          />
          <button className="rounded border px-2 py-1 text-xs text-sky-700 hover:bg-slate-100" data-testid="decision-backfill" onClick={() => record("backfill")}>
            Use reference
          </button>
          <button className="rounded border px-2 py-1 text-xs text-sky-700 hover:bg-slate-100" data-testid="decision-keep" onClick={() => record("keep_candidate")}>
            Keep candidate
          </button>
          <button className="rounded border px-2 py-1 text-xs text-sky-700 hover:bg-slate-100" data-testid="decision-custom-apply" onClick={() => record("use_custom")}>
            Use custom
          </button>
        </div>
      ) : null}
    </div>
  );
}
