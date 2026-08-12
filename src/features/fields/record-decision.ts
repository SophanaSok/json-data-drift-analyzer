import {
  appendDecision,
  createDecision,
  type CellClassification,
  type DecisionAction,
  type DecisionContext,
  type RecoveryDecision
} from "../../engine/decisions";

export type RecordDecisionInput = {
  classification: CellClassification;
  action: DecisionAction;
  reason: string;
  customValue?: string;
  log: RecoveryDecision[];
  makeContext: () => DecisionContext;
  onRecord: (log: RecoveryDecision[]) => void;
};

/**
 * Record one cell's decision, shared by the inline form and the keyboard
 * commands so a keystroke and a click cannot take different paths.
 *
 * @returns null on success, or the engine's refusal message
 */
export function recordCellDecision({
  classification,
  action,
  reason,
  customValue,
  log,
  makeContext,
  onRecord
}: RecordDecisionInput): string | null {
  try {
    const entry = createDecision(
      {
        recordKey: classification.recordKey,
        field: classification.field,
        action,
        // An empty box means "no value supplied", not "set this to empty".
        customValue: action === "use_custom" && (customValue ?? "").trim().length > 0 ? customValue : undefined,
        reason
      },
      classification,
      makeContext()
    );
    onRecord(appendDecision(log, entry));
    return null;
  } catch (caught) {
    return caught instanceof Error ? caught.message : "Could not record the decision.";
  }
}
