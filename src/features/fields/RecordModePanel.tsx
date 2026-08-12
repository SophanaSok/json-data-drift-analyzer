import { useState } from "react";
import { cellId, type DecisionContext, type RecoveryDecision } from "../../engine/decisions";
import type { RecordDetailModel } from "../../engine/field-view";
import { formatCellValue } from "../../engine/field-view";
import type { SourceProfile } from "../../engine/adapter-types";
import { FieldDecisionControl } from "./FieldDecisionControl";
import { RecordBulkBar } from "./RecordBulkBar";
import type { RecordQueue } from "./use-record-queue";
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
  /** The draft-store scope — the review's generatedAt, shared with all decision surfaces. */
  draftScope: string;
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
      {expanded ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all bg-slate-50 p-1 text-xs">{full}</pre> : shortValue(value)}
      <button type="button" className="mt-0.5 block text-xs text-sky-700 underline" aria-expanded={expanded} onClick={() => setExpanded((shown) => !shown)}>
        {expanded ? "Collapse" : `Show full value (${full.length.toLocaleString()} characters)`}
      </button>
    </>
  );
}

/**
 * One record, every field that matters, and what the exported artifact will
 * contain for each — the record as it will leave the tool, decidable in place.
 */
export function RecordModePanel({ detail, queue, profile, resolved, log, makeContext, onRecord, sessionReason, draftScope }: RecordModePanelProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);

  const decisionFor = (field: string) =>
    detail.decisionRecordKey ? resolved.get(cellId(detail.decisionRecordKey, field)) : undefined;

  // Output: the decision in force, else the applied auto backfill, else the candidate.
  const outputOf = (cell: RecordDetailModel["cells"][number]) => {
    const decision = decisionFor(cell.field);
    if (decision) return { value: decision.outputValue, source: "manual_override" as const };
    if (cell.lane === "auto") return { value: cell.referenceValue, source: "reference_backfill" as const };
    return { value: cell.candidateValue, source: "candidate" as const };
  };

  const active = detail.cells.filter((cell) => cell.situation !== "unchanged");
  const unchanged = detail.cells.filter((cell) => cell.situation === "unchanged");
  const pendingCells = detail.cells
    .filter((cell) => cell.lane === "review" && cell.classification !== null && decisionFor(cell.field) === undefined)
    .map((cell) => cell.classification!);

  const current = queue.current;

  return (
    <section aria-labelledby="record-detail-heading" className="min-w-0 space-y-4" data-testid="record-mode-panel">
      <div className="rounded border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="record-detail-heading" className="font-medium">
            {detail.recordKey}
          </h3>
          <p className="text-xs text-slate-500" data-testid="record-position">
            record {queue.index + 1} of {queue.rows.length}
            {current && current.pendingCount > 0 ? ` · ${current.pendingCount} pending` : ""}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button type="button" className="rounded border px-2 py-1 text-sky-700 hover:bg-slate-100" data-testid="record-prev" onClick={queue.previous}>
            ← prev
          </button>
          <button type="button" className="rounded border px-2 py-1 text-sky-700 hover:bg-slate-100" data-testid="record-next" onClick={queue.next}>
            next →
          </button>
          <button type="button" className="rounded border px-2 py-1 text-sky-700 hover:bg-slate-100" data-testid="record-next-pending" onClick={queue.nextPending}>
            ⏭ next pending
          </button>
          <span className="text-slate-500">j / k step · n next pending</span>
          <span className="ml-auto flex items-center gap-2 text-slate-600" data-testid="record-progress">
            <span className="inline-block h-1.5 w-28 rounded-sm bg-slate-100" aria-hidden="true">
              <span
                className="block h-full rounded-sm bg-sky-600"
                style={{
                  width: `${queue.progress.recordsWithPending === 0 ? 100 : (queue.progress.resolvedRecords / queue.progress.recordsWithPending) * 100}%`
                }}
              />
            </span>
            {queue.progress.resolvedRecords} / {queue.progress.recordsWithPending} resolved
          </span>
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
      </div>

      {profile && makeContext && !detail.exclusion ? (
        <RecordBulkBar
          recordKey={detail.recordKey}
          pendingCells={pendingCells}
          profile={profile}
          log={log}
          makeContext={makeContext}
          onRecord={onRecord}
          sessionReason={sessionReason}
        />
      ) : null}

      <div className="rounded border bg-white">
        <table className="w-full text-sm" data-testid="record-cells">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-2">Field</th>
              <th className="p-2">Candidate</th>
              <th className="p-2">Reference</th>
              <th className="p-2">Output</th>
              <th className="p-2">Decision</th>
            </tr>
          </thead>
          <tbody>
            {active.map((cell) => {
              const output = outputOf(cell);
              const badge = SOURCE_BADGE[output.source];
              return (
                <tr key={cell.field} className="border-t align-top" data-testid={`record-cell-${cell.field}`}>
                  <td className="p-2 font-mono text-xs">{cell.field}</td>
                  <td className="min-w-0 break-words p-2">
                    <Value value={cell.candidateValue} />
                  </td>
                  <td className="min-w-0 break-words p-2">
                    <Value value={cell.referenceValue} />
                  </td>
                  <td className="min-w-0 break-words p-2" data-testid={`record-output-${cell.field}`}>
                    <Value value={output.value} />
                    <span className={`mt-0.5 block w-fit rounded px-1.5 py-0.5 text-[10px] ${badge.className}`}>{badge.text}</span>
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

        <div className="border-t p-2">
          <button
            type="button"
            className="text-xs text-sky-700 underline"
            aria-expanded={showUnchanged}
            data-testid="toggle-unchanged"
            onClick={() => setShowUnchanged((shown) => !shown)}
          >
            {showUnchanged ? "Hide" : "Show"} {unchanged.length} unchanged field(s)
          </button>
          {showUnchanged ? (
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs md:grid-cols-2" data-testid="unchanged-fields">
              {unchanged.map((cell) => (
                <div key={cell.field} className="flex gap-2">
                  <dt className="w-40 shrink-0 font-mono text-slate-500">{cell.field}</dt>
                  <dd className="min-w-0 break-words">{formatCellValue(cell.candidateValue)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </section>
  );
}
