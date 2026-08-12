import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { resolveDecisions } from "../../engine/decisions";
import {
  buildCellContext,
  buildFieldDetail,
  buildFieldSummaries,
  buildRecordDetail,
  buildRecordSummaries
} from "../../engine/field-view";
import { getProfile } from "../../profiles";
import { useUiStore } from "../../stores/ui-store";
import { useDecisionLog } from "../recovery/use-decision-log";
import { FieldBulkBar } from "./FieldBulkBar";
import { FieldDecisionControl } from "./FieldDecisionControl";
import { FieldDetailPanel } from "./FieldDetailPanel";
import { FieldList } from "./FieldList";
import { RecordModePanel } from "./RecordModePanel";
import { RecordQueueList } from "./RecordQueueList";
import { useRecordQueue, type RecordShortcutActions } from "./use-record-queue";
import type { FieldListSortColumn, SortDirection } from "./field-view-table";

/**
 * The explorer: both files' values, decidable in place, sliced either way.
 *
 * "By field" answers "what happened to DueDate across all records"; "By
 * record" answers "what should this record contain" — same engine, same
 * decision log, same draft store, so a half-typed reason or a recorded
 * decision follows the user across modes and tabs.
 */
export function FieldsPage() {
  const analysis = useUiStore((state) => state.analysis);
  const review = useUiStore((state) => state.review);
  const [params, setParams] = useSearchParams();
  const [listSort, setListSort] = useState<{ column: FieldListSortColumn; direction: SortDirection }>({
    column: "review",
    direction: "desc"
  });
  // The remembered session reason: pre-fills every decision form, editable
  // anywhere. At 499 records an empty box per decision degrades to one-character
  // reasons, which satisfies the audit check while defeating it.
  const [sessionReason, setSessionReason] = useState("");
  // Rule-6 approval is taken once per source, per docs/recovery-workflow.proposed.md
  // §6.2 — re-certifying the same field names on every one of 499 records trains
  // click-through rather than deliberation.
  const [acknowledgedFields, setAcknowledgedFields] = useState<string[] | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const actionsRef = useRef<RecordShortcutActions | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  // Never fall back to a default profile here: a silently substituted policy
  // would put the wrong badges behind every field.
  const profile = review ? getProfile(review.profileId) : null;
  const { log, record } = useDecisionLog(review);
  const resolved = useMemo(() => resolveDecisions(log), [log]);

  const mode = params.get("mode") === "record" ? "record" : "field";
  const focusMode = mode === "record" && params.get("focus") === "1";

  // The field-independent classification setup — the dominant cost of any
  // per-field or per-record build. One instance per (analysis, review, profile).
  const ctx = useMemo(
    () => (analysis ? buildCellContext(analysis, review, profile) : null),
    [analysis, review, profile]
  );

  const summaries = useMemo(
    () => (analysis && ctx ? buildFieldSummaries(analysis, review, profile, ctx) : []),
    [analysis, review, profile, ctx]
  );
  const recordSummaries = useMemo(
    () => (analysis && ctx && mode === "record" ? buildRecordSummaries(analysis, review, profile, ctx) : []),
    [analysis, review, profile, ctx, mode]
  );

  const requestedField = params.get("field");
  const selectedField = useMemo(() => {
    if (!requestedField) return null;
    // A stale deep link degrades to no selection, never a blank panel.
    return summaries.some((summary) => summary.field === requestedField) ? requestedField : null;
  }, [requestedField, summaries]);

  const requestedRecord = params.get("record");
  const selectedRecord = useMemo(() => {
    if (!requestedRecord) return null;
    return recordSummaries.find((summary) => summary.recordKey === requestedRecord) ?? null;
  }, [requestedRecord, recordSummaries]);

  const detail = useMemo(
    () =>
      analysis && ctx && mode === "field" && selectedField
        ? buildFieldDetail(analysis, selectedField, review, profile, ctx)
        : null,
    [analysis, ctx, mode, selectedField, review, profile]
  );
  const recordDetail = useMemo(
    () =>
      analysis && ctx && mode === "record" && selectedRecord
        ? buildRecordDetail(analysis, selectedRecord.recordId, review, profile, ctx)
        : null,
    [analysis, ctx, mode, selectedRecord, review, profile]
  );

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  // Rebuilt each render, which is correct: useRecordQueue keeps the live
  // handler in a ref, so these always close over the current record and params
  // while the window listener itself is registered once.
  const shortcutActions: RecordShortcutActions = {
    acceptAll: () => actionsRef.current?.acceptAll(),
    keepAll: () => actionsRef.current?.keepAll(),
    selectField: (position) => actionsRef.current?.selectField(position),
    acceptSelectedField: () => actionsRef.current?.acceptSelectedField(),
    keepSelectedField: () => actionsRef.current?.keepSelectedField(),
    editSelectedField: () => actionsRef.current?.editSelectedField(),
    toggleFocusMode: () => setParam("focus", params.get("focus") === "1" ? null : "1"),
    toggleHelp: () => setShowHelp((shown) => !shown),
    cancel: () => {
      if (params.get("focus") === "1") setParam("focus", null);
      actionsRef.current?.cancel();
    }
  };

  const queue = useRecordQueue(
    recordSummaries,
    resolved,
    selectedRecord?.recordKey ?? null,
    (recordKey) => setParam("record", recordKey),
    mode === "record",
    shortcutActions
  );

  // After any decision: keep focus in the workspace so the next keystroke works
  // (the clicked button unmounts, which would otherwise drop focus to <body>),
  // and advance when the record is done.
  const onDecisionsRecorded = (applied: number, recordResolved: boolean) => {
    if (applied > 0) {
      setLastAction(
        `Recorded ${applied} decision(s) for ${selectedRecord?.recordKey ?? "this record"} — press k to go back`
      );
    }
    workspaceRef.current?.focus();
    if (recordResolved && applied > 0) queue.nextPending();
  };

  if (!analysis) {
    return <p className="p-6">Run an analysis first.</p>;
  }

  const onListSort = (column: FieldListSortColumn) => {
    setListSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: column === "field" ? "asc" : "desc" }
    );
  };

  const makeContext =
    review && profile ? () => ({ review, profile, timestamp: new Date().toISOString(), sequence: log.length }) : null;
  const draftScope = review?.generatedAt ?? "";
  const decisionsLive = review !== null && profile !== null;

  return (
    <div className="space-y-4 p-6" data-testid="fields-explorer">
      <header className={focusMode ? "space-y-1" : "space-y-2"}>
        <div className={`flex flex-wrap items-center justify-between gap-2 ${focusMode ? "hidden" : ""}`}>
          <h2 className="text-xl font-semibold">Explore</h2>
          <div className="flex rounded border border-slate-300 text-sm" role="group" aria-label="Explore mode">
            <button
              type="button"
              className={`px-3 py-1 ${mode === "field" ? "bg-sky-100 font-medium" : "hover:bg-slate-100"}`}
              aria-pressed={mode === "field"}
              data-testid="mode-field"
              onClick={() => setParam("mode", null)}
            >
              By field
            </button>
            <button
              type="button"
              className={`border-l border-slate-300 px-3 py-1 ${mode === "record" ? "bg-sky-100 font-medium" : "hover:bg-slate-100"}`}
              aria-pressed={mode === "record"}
              data-testid="mode-record"
              onClick={() => setParam("mode", "record")}
            >
              By record
            </button>
          </div>
        </div>
        {focusMode ? null : (
          <p className="text-sm text-slate-600">
            {mode === "field"
              ? "Every record's value in both files, one field at a time."
              : "Every field of one record — candidate, reference, and what the export will contain — decidable in place. For work that is the same on every record, By field decides it in four bulk actions."}
          </p>
        )}
        {mode === "record" && lastAction ? (
          <p className="rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900" data-testid="last-action">
            ✓ {lastAction}
          </p>
        ) : null}
        {mode === "record" && acknowledgedFields !== null ? (
          <p className="flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="rule6-active">
            Rule-6 approved for this source this session: <strong>{acknowledgedFields.join(", ")}</strong>
            <button
              type="button"
              className="rounded border border-amber-500 px-1.5 py-0.5 hover:bg-amber-100"
              data-testid="rule6-revoke"
              onClick={() => setAcknowledgedFields(null)}
            >
              revoke
            </button>
          </p>
        ) : null}
        {mode === "record" && showHelp ? (
          <div className="rounded border border-slate-300 bg-white p-3 text-xs text-slate-700" data-testid="keymap-help">
            <p className="font-medium">Keyboard</p>
            <ul className="mt-1 grid gap-x-6 gap-y-0.5 md:grid-cols-2">
              <li><kbd>a</kbd> accept all pending for this record</li>
              <li><kbd>x</kbd> keep all candidate values</li>
              <li><kbd>1</kbd>–<kbd>9</kbd> select a pending field</li>
              <li><kbd>Enter</kbd> accept the selected field</li>
              <li><kbd>c</kbd> keep the selected field</li>
              <li><kbd>e</kbd> edit the selected field's value</li>
              <li><kbd>n</kbd> next record with pending work</li>
              <li><kbd>j</kbd> / <kbd>k</kbd> next / previous record</li>
              <li><kbd>f</kbd> focus mode · <kbd>?</kbd> this help</li>
              <li><kbd>Esc</kbd> leave focus mode</li>
            </ul>
          </div>
        ) : null}
        {decisionsLive ? (
          <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            Session reason (pre-fills each decision, editable per record):
            <input
              className="min-w-[20rem] flex-1 rounded border border-slate-300 p-1"
              placeholder='e.g. "verified against the agency portal, Aug 2026"'
              data-testid="session-reason"
              value={sessionReason}
              onChange={(event) => setSessionReason(event.target.value)}
            />
          </label>
        ) : (
          <p className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700" data-testid="fields-no-review">
            No recovery review exists for this run, so lanes and decisions are unavailable — the values themselves are
            shown from the analysis.
          </p>
        )}
      </header>

      {mode === "field" ? (
        <div className="grid gap-4 md:grid-cols-[22rem_minmax(0,1fr)]">
          <FieldList
            summaries={summaries}
            selectedField={selectedField}
            sort={listSort}
            onSort={onListSort}
            onSelectField={(field) => setParam("field", field)}
            degraded={!decisionsLive}
          />
          {detail ? (
            <FieldDetailPanel
              key={detail.field}
              detail={detail}
              renderDecision={
                makeContext && detail.decisionsUnavailableReason === null
                  ? (cell) => (
                      <FieldDecisionControl
                        cell={cell}
                        resolved={resolved}
                        log={log}
                        makeContext={makeContext}
                        onRecord={record}
                        draftScope={draftScope}
                        defaultReason={sessionReason}
                      />
                    )
                  : undefined
              }
              renderBulk={
                makeContext && profile && detail.decisionsUnavailableReason === null
                  ? (visibleCells, scopeDescription) => (
                      <FieldBulkBar
                        field={detail.field}
                        visibleCells={visibleCells}
                        scopeDescription={scopeDescription}
                        profile={profile}
                        log={log}
                        makeContext={makeContext}
                        onRecord={record}
                      />
                    )
                  : undefined
              }
            />
          ) : (
            <p className="rounded border bg-white p-6 text-sm text-slate-600" data-testid="field-detail-prompt">
              Select a field on the left to see every record's candidate and reference value.
            </p>
          )}
        </div>
      ) : (
        <div
          ref={workspaceRef}
          tabIndex={-1}
          className={`grid gap-4 outline-none ${focusMode ? "" : "md:grid-cols-[18rem_minmax(0,1fr)]"}`}
          data-testid="record-workspace"
        >
          {focusMode ? null : (
            <RecordQueueList
              rows={queue.rows}
              selectedRecordKey={selectedRecord?.recordKey ?? null}
              onSelectRecord={(recordKey) => setParam("record", recordKey)}
            />
          )}
          {recordDetail ? (
            <RecordModePanel
              key={recordDetail.recordId}
              detail={recordDetail}
              queue={queue}
              profile={profile}
              resolved={resolved}
              log={log}
              makeContext={makeContext}
              onRecord={record}
              sessionReason={sessionReason}
              onSessionReasonChange={setSessionReason}
              acknowledgedFields={acknowledgedFields}
              onAcknowledge={setAcknowledgedFields}
              draftScope={draftScope}
              actionsRef={actionsRef}
              onDecisionsRecorded={onDecisionsRecorded}
              focusMode={focusMode}
              onToggleFocusMode={() => setParam("focus", focusMode ? null : "1")}
              onToggleHelp={() => setShowHelp((shown) => !shown)}
            />
          ) : (
            <p className="rounded border bg-white p-6 text-sm text-slate-600" data-testid="record-detail-prompt">
              Select a record on the left — or press <kbd>n</kbd> for the next one with pending decisions.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
