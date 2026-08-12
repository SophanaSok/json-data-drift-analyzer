import { useMemo, useState } from "react";
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
import { useRecordQueue } from "./use-record-queue";
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

  // Never fall back to a default profile here: a silently substituted policy
  // would put the wrong badges behind every field.
  const profile = review ? getProfile(review.profileId) : null;
  const { log, record } = useDecisionLog(review);
  const resolved = useMemo(() => resolveDecisions(log), [log]);

  const mode = params.get("mode") === "record" ? "record" : "field";

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

  const queue = useRecordQueue(
    recordSummaries,
    resolved,
    selectedRecord?.recordKey ?? null,
    (recordKey) => setParam("record", recordKey),
    mode === "record"
  );

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
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
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
        <p className="text-sm text-slate-600">
          {mode === "field"
            ? "Every record's value in both files, one field at a time."
            : "Every field of one record — candidate, reference, and what the export will contain — decidable in place."}
        </p>
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
        <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
          <RecordQueueList
            rows={queue.rows}
            selectedRecordKey={selectedRecord?.recordKey ?? null}
            onSelectRecord={(recordKey) => setParam("record", recordKey)}
          />
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
              draftScope={draftScope}
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
