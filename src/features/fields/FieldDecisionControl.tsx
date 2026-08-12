import {
  appendDecision,
  cellId,
  createDecision,
  decisionHistory,
  type DecisionAction,
  type DecisionContext,
  type RecoveryDecision
} from "../../engine/decisions";
import type { FieldCell } from "../../engine/field-view";
import { ACTION_LABEL } from "../recovery/decision-display";
import { EMPTY_DECISION_DRAFT, useDraftStore } from "../../stores/draft-store";

type FieldDecisionControlProps = {
  cell: FieldCell;
  resolved: Map<string, RecoveryDecision>;
  log: RecoveryDecision[];
  makeContext: () => DecisionContext;
  onRecord: (log: RecoveryDecision[]) => void;
  /** Draft scope prefix — the review's generatedAt, shared with the queue. */
  draftScope: string;
};

const LANE_BADGE: Record<string, string> = {
  auto: "bg-emerald-100 text-emerald-900",
  review: "bg-amber-100 text-amber-900",
  ineligible: "bg-slate-100 text-slate-600"
};

/**
 * The in-table decision form. Same engine calls and draft scoping as the
 * recovery queue's DecisionRow, so half-typed reasons follow the user between
 * tabs — but the lane and its reason are rendered visibly (§6.4), and an
 * auto-lane cell offers a veto (§6.5), which the queue never surfaces.
 */
export function FieldDecisionControl({ cell, resolved, log, makeContext, onRecord, draftScope }: FieldDecisionControlProps) {
  const classification = cell.classification;
  const id = classification ? cellId(classification.recordKey, classification.field) : null;
  const draftId = id ? `${draftScope}|${id}` : null;
  const draft = useDraftStore((state) => (draftId ? state.decisionDrafts[draftId] : undefined)) ?? EMPTY_DECISION_DRAFT;
  const updateDraft = useDraftStore((state) => state.updateDecisionDraft);
  const clearDraft = useDraftStore((state) => state.clearDecisionDraft);

  if (!classification || !id || !draftId) {
    // Not decidable: say why, in place, rather than hiding the reason.
    return <span className="text-xs text-slate-500">{cell.laneReason}</span>;
  }

  const decision = resolved.get(id);
  const history = decision ? decisionHistory(log, classification.recordKey, classification.field) : [];
  const isVeto = decision?.action === "keep_candidate" && classification.lane === "auto";
  const { open, reason, customValue, error } = draft;

  const record = (action: DecisionAction) => {
    try {
      const entry = createDecision(
        {
          recordKey: classification.recordKey,
          field: classification.field,
          action,
          customValue: action === "use_custom" && customValue.trim().length > 0 ? customValue : undefined,
          reason
        },
        classification,
        makeContext()
      );
      onRecord(appendDecision(log, entry));
      clearDraft(draftId);
    } catch (caught) {
      updateDraft(draftId, { error: caught instanceof Error ? caught.message : "Could not record the decision." });
    }
  };

  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <span className={`rounded px-1.5 py-0.5 ${LANE_BADGE[classification.lane]}`}>{classification.lane}</span>
        {decision ? (
          <span
            className={`rounded px-1.5 py-0.5 ${isVeto ? "bg-red-50 text-red-900" : "bg-emerald-100 text-emerald-900"}`}
            data-testid="cell-decided"
          >
            {isVeto ? "vetoed" : `decided: ${ACTION_LABEL[decision.action]}`}
          </span>
        ) : null}
        {history.length > 1 ? <span className="text-slate-500">revised ×{history.length - 1}</span> : null}
        <button
          type="button"
          className="ml-auto rounded border px-1.5 py-0.5 text-sky-700 hover:bg-slate-100"
          data-testid={`decide-${cell.recordKey}`}
          onClick={() => updateDraft(draftId, { open: !open, error: null })}
        >
          {open ? "Cancel" : decision ? "Change" : "Decide"}
        </button>
      </div>

      {/* §6.4: the lane's reason, visible, not inferred. */}
      <p className="text-slate-500">{classification.reason}</p>

      {error ? (
        <p className="rounded border border-red-300 bg-red-50 p-1 text-red-900" role="alert" data-testid="decision-error">
          {error}
        </p>
      ) : null}

      {open ? (
        <div className="space-y-1" data-testid="decision-form">
          <input
            className="w-full rounded border border-slate-300 p-1"
            placeholder="Reason (required)"
            data-testid="decision-reason"
            value={reason}
            onChange={(event) => updateDraft(draftId, { reason: event.target.value })}
          />
          <input
            className="w-full rounded border border-slate-300 p-1"
            placeholder="Custom value"
            data-testid="decision-custom"
            value={customValue}
            onChange={(event) => updateDraft(draftId, { customValue: event.target.value })}
          />
          <div className="flex flex-wrap gap-1">
            {classification.lane === "auto" ? (
              <button
                type="button"
                className="rounded border border-red-300 px-1.5 py-0.5 text-red-900 hover:bg-red-50"
                data-testid="decision-veto"
                onClick={() => record("keep_candidate")}
              >
                Veto backfill
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="rounded border px-1.5 py-0.5 text-sky-700 hover:bg-slate-100"
                  data-testid="decision-backfill"
                  onClick={() => record("backfill")}
                >
                  Use reference
                </button>
                <button
                  type="button"
                  className="rounded border px-1.5 py-0.5 text-sky-700 hover:bg-slate-100"
                  data-testid="decision-keep"
                  onClick={() => record("keep_candidate")}
                >
                  Keep candidate
                </button>
              </>
            )}
            <button
              type="button"
              className="rounded border px-1.5 py-0.5 text-sky-700 hover:bg-slate-100"
              data-testid="decision-custom-apply"
              onClick={() => record("use_custom")}
            >
              Use custom
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
