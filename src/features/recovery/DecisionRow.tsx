import {
  appendDecision,
  createDecision,
  type CellClassification,
  type DecisionAction,
  type DecisionContext,
  type RecoveryDecision
} from "../../engine/decisions";
import { EMPTY_DECISION_DRAFT, useDraftStore } from "../../stores/draft-store";
import { ACTION_LABEL, preview } from "./decision-display";

/**
 * One queued cell and its decision form.
 *
 * Separate from the virtualized list so the part that matters -- recording a
 * decision, and refusing one that cannot be audited -- is testable without a layout
 * engine. The engine refuses; this only surfaces the reason.
 *
 * The form's in-progress state lives in the draft store under `draftId`, not in
 * component state: the virtualized queue unmounts off-screen rows, and unmounting
 * must not discard half-typed reasons.
 */
export function DecisionRow({
  cell,
  decision,
  log,
  makeContext,
  onRecord,
  index,
  draftId
}: {
  cell: CellClassification;
  decision: RecoveryDecision | undefined;
  log: RecoveryDecision[];
  /** Called at recording time, so the entry carries the decision's own timestamp. */
  makeContext: () => DecisionContext;
  onRecord: (log: RecoveryDecision[]) => void;
  index: number;
  /** Stable per-cell key, scoped to the analysis by the caller. */
  draftId: string;
}) {
  const draft = useDraftStore((state) => state.decisionDrafts[draftId]) ?? EMPTY_DECISION_DRAFT;
  const updateDraft = useDraftStore((state) => state.updateDecisionDraft);
  const clearDraft = useDraftStore((state) => state.clearDecisionDraft);
  const { open, reason, customValue, error } = draft;

  const record = (action: DecisionAction) => {
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
        makeContext()
      );
      onRecord(appendDecision(log, entry));
      clearDraft(draftId);
    } catch (caught) {
      updateDraft(draftId, {
        error: caught instanceof Error ? caught.message : "Could not record the decision."
      });
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
          onClick={() => updateDraft(draftId, { open: !open, error: null })}
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
            onChange={(event) => updateDraft(draftId, { reason: event.target.value })}
          />
          <input
            className="w-40 rounded border border-slate-300 p-1 text-xs"
            placeholder="Custom value"
            data-testid="decision-custom"
            value={customValue}
            onChange={(event) => updateDraft(draftId, { customValue: event.target.value })}
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
