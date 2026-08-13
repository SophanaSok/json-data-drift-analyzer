import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { cellId, type CellClassification, type DecisionContext, type RecoveryDecision } from "../../engine/decisions";
import type { FieldCell, RecordDetailModel } from "../../engine/field-view";
import { formatCellValue } from "../../engine/field-view";
import type { SourceProfile } from "../../engine/adapter-types";
import { FieldDecisionControl } from "./FieldDecisionControl";
import { RecordBulkBar } from "./RecordBulkBar";
import { recordCellDecision } from "./record-decision";
import type { RecordQueue, RecordShortcutActions } from "./use-record-queue";
import { CorroborationNote } from "./CorroborationNote";
import { corroborationKey, type CorroborationReport } from "../../engine/corroboration";
import { isLongValue, shortValue } from "./field-view-table";

type RecordModePanelProps = {
  detail: RecordDetailModel;
  queue: RecordQueue;
  profile: SourceProfile | null;
  resolved: Map<string, RecoveryDecision>;
  log: RecoveryDecision[];
  makeContext: (() => DecisionContext) | null;
  onRecord: (log: RecoveryDecision[]) => void;
  sessionReason: string;
  onSessionReasonChange: (reason: string) => void;
  acknowledgedFields: string[] | null;
  onAcknowledge: (fields: string[]) => void;
  draftScope: string;
  /** Populated with this record's keyboard commands for the page-level keymap. */
  actionsRef: MutableRefObject<RecordShortcutActions | null>;
  /** Called after decisions land, so the page can refocus and advance. */
  onDecisionsRecorded: (applied: number, recordResolved: boolean) => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  onToggleHelp: () => void;
  /** Advisory evidence per cell; never affects what may be decided. */
  corroboration: CorroborationReport | null;
};

const SOURCE_BADGE = {
  candidate: { text: "candidate", className: "bg-slate-100 text-slate-700" },
  reference_backfill: { text: "reference backfill", className: "bg-amber-100 text-amber-900" },
  manual_override: { text: "your decision", className: "bg-sky-100 text-sky-900" }
} as const;

function Value({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const full = formatCellValue(value);
  if (!isLongValue(value)) return <>{full}</>;
  return (
    <>
      {expanded ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all bg-slate-50 p-1 text-xs">{full}</pre>
      ) : (
        shortValue(value)
      )}
      <button
        type="button"
        className="mt-0.5 block text-xs text-sky-700 underline"
        aria-expanded={expanded}
        onClick={() => setExpanded((shown) => !shown)}
      >
        {expanded ? "Collapse" : `Show full value (${full.length.toLocaleString()} characters)`}
      </button>
    </>
  );
}

/**
 * One record, every field that matters, and what the exported artifact will
 * contain for each — worked as a task: pending fields numbered and selectable
 * by digit, decidable by keystroke, with the record advancing when it is done.
 */
export function RecordModePanel({
  detail,
  queue,
  profile,
  resolved,
  log,
  makeContext,
  onRecord,
  sessionReason,
  onSessionReasonChange,
  acknowledgedFields,
  onAcknowledge,
  draftScope,
  actionsRef,
  onDecisionsRecorded,
  focusMode,
  onToggleFocusMode,
  onToggleHelp,
  corroboration
}: RecordModePanelProps) {
  const [showContext, setShowContext] = useState(false);
  const [selected, setSelected] = useState(0);
  const [keyError, setKeyError] = useState<string | null>(null);
  const bulkApplyRef = useRef<((action: "backfill" | "keep_candidate") => void) | null>(null);

  const decisionFor = (field: string) =>
    detail.decisionRecordKey ? resolved.get(cellId(detail.decisionRecordKey, field)) : undefined;

  // Output: the decision in force, else the applied auto backfill, else the candidate.
  const outputOf = (cell: FieldCell) => {
    const decision = decisionFor(cell.field);
    if (decision) return { value: decision.outputValue, source: "manual_override" as const };
    if (cell.lane === "auto") return { value: cell.referenceValue, source: "reference_backfill" as const };
    return { value: cell.candidateValue, source: "candidate" as const };
  };

  // Pending first — they are the work; then decided/auto rows; profile-excluded
  // and unchanged fields move to the context section rather than occupying the
  // viewport between the user and the next decision.
  const pending = detail.cells.filter(
    (cell) => cell.lane === "review" && cell.classification !== null && decisionFor(cell.field) === undefined
  );
  const settled = detail.cells.filter(
    (cell) => cell.situation !== "unchanged" && !pending.includes(cell) && cell.lane !== null
  );
  const context = detail.cells.filter((cell) => cell.situation === "unchanged" || cell.lane === null);

  const pendingCells: CellClassification[] = pending.map((cell) => cell.classification!);

  useEffect(() => {
    setSelected((current) => (current < pending.length ? current : 0));
  }, [pending.length]);

  const decideSelected = (action: "backfill" | "keep_candidate") => {
    const cell = pending[selected];
    if (!cell?.classification || !makeContext) return;
    const failure = recordCellDecision({
      classification: cell.classification,
      action,
      reason: sessionReason,
      log,
      makeContext,
      onRecord
    });
    setKeyError(failure);
    if (!failure) onDecisionsRecorded(1, pending.length === 1);
  };

  // The page-level keymap delegates here; a ref avoids a render loop while
  // keeping every command bound to this record's current state.
  actionsRef.current = {
    acceptAll: () => bulkApplyRef.current?.("backfill"),
    keepAll: () => bulkApplyRef.current?.("keep_candidate"),
    selectField: (position) => {
      if (position < pending.length) setSelected(position);
    },
    acceptSelectedField: () => decideSelected("backfill"),
    keepSelectedField: () => decideSelected("keep_candidate"),
    editSelectedField: () => {
      const cell = pending[selected];
      if (!cell) return;
      document
        .querySelector<HTMLButtonElement>(`[data-testid="decide-${cell.recordKey}-${cell.field}"]`)
        ?.click();
      requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>('[data-testid="decision-custom"]')?.focus();
      });
    },
    toggleFocusMode: onToggleFocusMode,
    toggleHelp: onToggleHelp,
    cancel: () => setKeyError(null)
  };

  const current = queue.current;
  const progressPercent =
    queue.progress.recordsWithPending === 0
      ? 100
      : (queue.progress.resolvedRecords / queue.progress.recordsWithPending) * 100;

  // Focus mode shows only the work: already-decided and auto-applied rows move
  // into the context disclosure so every pending decision is above the fold.
  const rowsToRender = useMemo(
    () => (focusMode ? pending : [...pending, ...settled]),
    [focusMode, pending, settled]
  );
  const contextRows = useMemo(
    () => (focusMode ? [...settled, ...context] : context),
    [focusMode, settled, context]
  );

  return (
    <section aria-labelledby="record-detail-heading" className="min-w-0 space-y-3" data-testid="record-mode-panel">
      <div className="rounded border bg-white px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 id="record-detail-heading" className="font-medium">
            {detail.recordKey}
          </h3>
          <p className="text-xs text-slate-500" data-testid="record-position">
            record {queue.index + 1} of {queue.rows.length}
            {current && current.pendingCount > 0 ? ` · ${current.pendingCount} pending` : " · resolved"}
          </p>
          <span className="flex items-center gap-2 text-xs text-slate-600" data-testid="record-progress">
            <span className="inline-block h-1.5 w-24 rounded-sm bg-slate-100" aria-hidden="true">
              <span className="block h-full rounded-sm bg-sky-600" style={{ width: `${progressPercent}%` }} />
            </span>
            {queue.progress.resolvedRecords} / {queue.progress.recordsWithPending} resolved
          </span>
          <div className="ml-auto flex items-center gap-1 text-xs">
            <button type="button" className="rounded border px-2 py-0.5 text-sky-700 hover:bg-slate-100" data-testid="record-prev" onClick={queue.previous}>
              ← prev
            </button>
            <button type="button" className="rounded border px-2 py-0.5 text-sky-700 hover:bg-slate-100" data-testid="record-next" onClick={queue.next}>
              next →
            </button>
            <button type="button" className="rounded border px-2 py-0.5 text-sky-700 hover:bg-slate-100" data-testid="record-next-pending" onClick={queue.nextPending}>
              ⏭ pending
            </button>
            <button
              type="button"
              className="rounded border px-2 py-0.5 text-sky-700 hover:bg-slate-100"
              data-testid="toggle-focus-mode"
              aria-pressed={focusMode}
              onClick={onToggleFocusMode}
            >
              {focusMode ? "exit focus" : "focus"} <span className="text-slate-400">f</span>
            </button>
          </div>
        </div>

        {detail.exclusion ? (
          <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900" data-testid="record-excluded-warning">
            This record is not in the recovery output ({detail.exclusion.reason}): {detail.exclusion.detail} Decisions
            recorded here will be reported as unapplied at export.
          </p>
        ) : null}
        {detail.decisionsUnavailableReason ? (
          <p className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700" data-testid="decisions-unavailable">
            Decisions are unavailable: {detail.decisionsUnavailableReason}
          </p>
        ) : null}
        {keyError ? (
          <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900" role="alert" data-testid="record-key-error">
            {keyError}
          </p>
        ) : null}
      </div>

      {profile && makeContext && !detail.exclusion ? (
        <RecordBulkBar
          recordKey={detail.recordKey}
          pendingCells={pendingCells}
          profile={profile}
          log={log}
          makeContext={makeContext}
          onRecord={onRecord}
          reason={sessionReason}
          onReasonChange={onSessionReasonChange}
          acknowledgedFields={acknowledgedFields}
          onAcknowledge={onAcknowledge}
          onRecorded={(applied) => onDecisionsRecorded(applied, true)}
          applyRef={bulkApplyRef}
        />
      ) : null}

      <div className="rounded border bg-white">
        <table className="w-full text-sm" data-testid="record-cells">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="w-8 p-2" />
              <th className="p-2">Field</th>
              <th className="p-2">Candidate</th>
              <th className="p-2">Reference</th>
              <th className="p-2">Output</th>
              <th className="p-2">Decision</th>
            </tr>
          </thead>
          <tbody>
            {rowsToRender.map((cell) => {
              const output = outputOf(cell);
              const badge = SOURCE_BADGE[output.source];
              const pendingIndex = pending.indexOf(cell);
              const isSelected = pendingIndex >= 0 && pendingIndex === selected;
              return (
                <tr
                  key={cell.field}
                  className={`border-t align-top ${isSelected ? "bg-sky-50 ring-1 ring-inset ring-sky-300" : ""}`}
                  data-testid={`record-cell-${cell.field}`}
                  data-selected={isSelected ? "true" : "false"}
                >
                  <td className="p-2 text-xs text-slate-400">
                    {pendingIndex >= 0 && pendingIndex < 9 ? (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{pendingIndex + 1}</span>
                    ) : null}
                  </td>
                  <td className="p-2 font-mono text-xs">{cell.field}</td>
                  <td className="min-w-0 break-words p-2">
                    <Value value={cell.candidateValue} />
                  </td>
                  <td className="min-w-0 break-words p-2">
                    <Value value={cell.referenceValue} />
                    <CorroborationNote
                      corroboration={corroboration?.cells.get(corroborationKey(detail.recordId, cell.field))}
                    />
                  </td>
                  <td className="min-w-0 break-words p-2" data-testid={`record-output-${cell.field}`}>
                    <Value value={output.value} />
                    <span className={`mt-0.5 block w-fit rounded px-1.5 py-0.5 text-[10px] ${badge.className}`}>
                      {badge.text}
                    </span>
                  </td>
                  <td className="w-56 p-2">
                    {makeContext ? (
                      <FieldDecisionControl
                        cell={cell}
                        resolved={resolved}
                        log={log}
                        makeContext={makeContext}
                        onRecord={onRecord}
                        draftScope={draftScope}
                        defaultReason={sessionReason}
                        editSeedValue={typeof cell.referenceValue === "string" ? cell.referenceValue : undefined}
                      />
                    ) : (
                      <span className="text-xs text-slate-500">{cell.laneReason}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rowsToRender.length === 0 ? (
          <p className="p-3 text-sm text-slate-600" data-testid="record-no-pending">
            Nothing left to decide on this record. Press <kbd>n</kbd> for the next one with pending work.
          </p>
        ) : null}

        <div className="border-t p-2">
          <button
            type="button"
            className="text-xs text-sky-700 underline"
            aria-expanded={showContext}
            data-testid="toggle-unchanged"
            onClick={() => setShowContext((shown) => !shown)}
          >
            {showContext ? "Hide" : "Show"} {contextRows.length} other field(s)
          </button>
          {showContext ? (
            <table className="mt-2 w-full text-xs" data-testid="unchanged-fields">
              <tbody>
                {contextRows.map((cell) => {
                  const output = outputOf(cell);
                  return (
                    <tr key={cell.field} className="border-t align-top" data-testid={`record-cell-${cell.field}`}>
                      <td className="w-40 p-1 font-mono text-slate-500">{cell.field}</td>
                      <td className="min-w-0 break-words p-1" data-testid={`record-output-${cell.field}`}>
                        {formatCellValue(output.value)}
                      </td>
                      <td className="w-56 p-1">
                        {makeContext ? (
                          <FieldDecisionControl
                            cell={cell}
                            resolved={resolved}
                            log={log}
                            makeContext={makeContext}
                            onRecord={onRecord}
                            draftScope={draftScope}
                            defaultReason={sessionReason}
                            editSeedValue={
                              typeof output.value === "string"
                                ? output.value
                                : typeof cell.referenceValue === "string"
                                  ? cell.referenceValue
                                  : ""
                            }
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-slate-500" data-testid="record-keymap">
        <kbd>a</kbd> accept all · <kbd>x</kbd> keep all · <kbd>1</kbd>–<kbd>9</kbd> select field ·{" "}
        <kbd>Enter</kbd> accept · <kbd>c</kbd> keep · <kbd>e</kbd> edit · <kbd>n</kbd> next pending ·{" "}
        <kbd>j</kbd>/<kbd>k</kbd> step · <kbd>f</kbd> focus
      </p>
    </section>
  );
}
