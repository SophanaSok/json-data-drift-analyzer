import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  appendDecisions,
  cellId,
  classifyCells,
  countLanes,
  createBulkDecisions,
  resolveDecisions,
  summarizeDecisions,
  type BulkDecisionInput,
  type RecoveryDecision
} from "../../engine/decisions";
import { DecisionRow } from "./DecisionRow";
import { ACTION_LABEL } from "./decision-display";
import type { RecoveryReview } from "../../engine/review";
import type { SourceProfile } from "../../engine/adapter-types";

/**
 * The review queue: cells policy would not decide automatically, and the log of
 * decisions a person has recorded against them.
 *
 * Every decision requires a reason and is appended, never edited. Nothing here
 * bypasses policy silently — a decision that overrides automation is recorded as a
 * person's action, with the reason they gave.
 */
export function DecisionQueue({
  review,
  profile,
  log,
  onRecord,
  timestamp
}: {
  review: RecoveryReview;
  profile: SourceProfile;
  log: RecoveryDecision[];
  onRecord: (log: RecoveryDecision[]) => void;
  /** Injected so the same inputs always produce the same entry. */
  timestamp: string;
}) {
  const [fieldFilter, setFieldFilter] = useState<string>("all");
  const [bulkReason, setBulkReason] = useState("");
  const [pendingBulk, setPendingBulk] = useState<BulkDecisionInput["action"] | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const cells = useMemo(() => classifyCells(review, profile), [review, profile]);
  const lanes = useMemo(() => countLanes(cells), [cells]);
  const resolved = useMemo(() => resolveDecisions(log), [log]);
  const summary = useMemo(() => summarizeDecisions(log), [log]);

  const reviewCells = useMemo(
    () => cells.filter((cell) => cell.lane === "review" && (fieldFilter === "all" || cell.field === fieldFilter)),
    [cells, fieldFilter]
  );
  const fields = useMemo(
    () => [...new Set(cells.filter((cell) => cell.lane === "review").map((cell) => cell.field))].sort(),
    [cells]
  );

  const virtualizer = useVirtualizer({
    count: reviewCells.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 92,
    overscan: 6
  });

  const applyBulk = (action: BulkDecisionInput["action"]) => {
    setBulkError(null);
    try {
      const result = createBulkDecisions(reviewCells, { action, reason: bulkReason }, {
        review,
        profile,
        timestamp,
        sequence: log.length
      });
      onRecord(appendDecisions(log, result.decisions));
      setBulkOutcome(
        `Recorded ${result.applied} decision(s).` +
          (result.skipped.length > 0 ? ` Skipped ${result.skipped.length} with no reference value.` : "")
      );
      setBulkReason("");
      setPendingBulk(null);
    } catch (caught) {
      setBulkError(caught instanceof Error ? caught.message : "Could not record the decisions.");
      setPendingBulk(null);
    }
  };

  return (
    <section className="rounded border bg-white p-4" data-testid="decision-queue">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">Review queue</h3>
        <p className="text-xs text-slate-500" data-testid="lane-counts">
          {lanes.auto} applied automatically · {lanes.review} awaiting a decision · {summary.cellsDecided} decided
          {summary.revisedCells > 0 ? ` · ${summary.revisedCells} revised` : ""}
        </p>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        These cells were not decided by policy. A decision here is recorded as your action, with your
        reason, and appended to the log — earlier entries are kept.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-xs text-slate-500">Field</span>
          <select
            className="rounded border border-slate-300 p-1"
            data-testid="decision-field-filter"
            value={fieldFilter}
            onChange={(event) => setFieldFilter(event.target.value)}
          >
            <option value="all">All ({cells.filter((cell) => cell.lane === "review").length})</option>
            {fields.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-slate-500" data-testid="queue-count">
          {reviewCells.length} cell(s)
        </span>
      </div>

      <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3" data-testid="bulk-panel">
        <p className="text-xs font-medium">
          Apply to all {reviewCells.length} cell(s){fieldFilter === "all" ? " in the queue" : ` for ${fieldFilter}`}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Each cell gets its own reference value, never a shared one. A custom value stays a
          per-cell decision, because applying one literal everywhere is how the single outlier
          record gets overwritten with the common one.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="min-w-[14rem] flex-1 rounded border border-slate-300 p-1 text-xs"
            placeholder="Reason for all of them (required)"
            data-testid="bulk-reason"
            value={bulkReason}
            onChange={(event) => setBulkReason(event.target.value)}
          />
          <button
            className="rounded border px-2 py-1 text-xs text-sky-700 hover:bg-slate-100"
            data-testid="bulk-backfill"
            disabled={reviewCells.length === 0}
            onClick={() => {
              setBulkOutcome(null);
              setPendingBulk("backfill");
            }}
          >
            Use reference for all
          </button>
          <button
            className="rounded border px-2 py-1 text-xs text-sky-700 hover:bg-slate-100"
            data-testid="bulk-keep"
            disabled={reviewCells.length === 0}
            onClick={() => {
              setBulkOutcome(null);
              setPendingBulk("keep_candidate");
            }}
          >
            Keep candidate for all
          </button>
        </div>

        {pendingBulk ? (
          <div className="mt-2 rounded border border-amber-400 bg-amber-50 p-2" data-testid="bulk-confirm">
            <p className="text-xs text-amber-900">
              Record <strong>{reviewCells.length}</strong> decision(s) —{" "}
              {pendingBulk === "backfill" ? "use the reference value" : "keep the candidate value"}
              {fieldFilter === "all" ? " across every queued field" : ` for ${fieldFilter}`}? This appends
              {" "}{reviewCells.length} entries to the log.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                className="rounded border border-amber-500 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                data-testid="bulk-confirm-apply"
                onClick={() => applyBulk(pendingBulk)}
              >
                Yes, record them
              </button>
              <button
                className="rounded border px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                data-testid="bulk-confirm-cancel"
                onClick={() => setPendingBulk(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {bulkError ? (
          <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900" data-testid="bulk-error">
            {bulkError}
          </p>
        ) : null}
        {bulkOutcome ? (
          <p className="mt-2 text-xs text-emerald-800" data-testid="bulk-outcome">
            {bulkOutcome}
          </p>
        ) : null}
      </div>

      {reviewCells.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600" data-testid="queue-empty">
          Nothing awaiting a decision for this filter.
        </p>
      ) : (
        <div ref={scrollRef} className="mt-3 max-h-[26rem] overflow-auto rounded border">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((row) => {
              const cell = reviewCells[row.index];
              const id = cellId(cell.recordKey, cell.field);
              return (
                <div
                  key={id}
                  className="absolute left-0 top-0 w-full border-b"
                  style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                >
                  <DecisionRow
                    cell={cell}
                    decision={resolved.get(id)}
                    log={log}
                    context={{ review, profile, timestamp, sequence: log.length }}
                    onRecord={onRecord}
                    index={row.index}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {log.length > 0 ? (
        <div className="mt-4" data-testid="decision-log">
          <h4 className="text-sm font-medium">Decision log ({log.length} entries)</h4>
          <p className="text-xs text-slate-500">
            Append-only. A superseded entry stays on record, because &ldquo;decided then reverted&rdquo; is
            a different history from &ldquo;never touched&rdquo;.
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {[...log]
              .slice(-10)
              .reverse()
              .map((entry) => (
                <li key={entry.id} className="border-b pb-1">
                  <code>{entry.field}</code> — {ACTION_LABEL[entry.action]} · {entry.actor} ·{" "}
                  <span className="text-slate-500">{entry.reason}</span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
