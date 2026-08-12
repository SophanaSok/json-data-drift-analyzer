import type { FieldSummary } from "../../engine/field-view";
import {
  formatFillTransition,
  sortSummaries,
  type FieldListSortColumn,
  type SortDirection
} from "./field-view-table";

type SortState = { column: FieldListSortColumn; direction: SortDirection };

type FieldListProps = {
  summaries: FieldSummary[];
  selectedField: string | null;
  sort: SortState;
  onSort: (column: FieldListSortColumn) => void;
  onSelectField: (field: string) => void;
  /** True when no review exists: policy badges and lane counts are absent. */
  degraded: boolean;
};

const COLUMNS: Array<{ id: FieldListSortColumn; label: string }> = [
  { id: "field", label: "Field" },
  { id: "change", label: "Fill" },
  { id: "review", label: "To review" }
];

function policyBadge(summary: FieldSummary) {
  const policy = summary.policy;
  if (!policy) return null;
  if (policy.excluded) {
    return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">excluded</span>;
  }
  if (policy.safeBackfill) {
    return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-900">auto backfill</span>;
  }
  if (policy.dateSensitive) {
    return (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900 ring-1 ring-amber-400">
        rule 6
      </span>
    );
  }
  if (policy.manualReview) {
    return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">review only</span>;
  }
  return null;
}

/**
 * Fill transition as two thin bars: reference (neutral) above candidate
 * (accent). Magnitude only — severity stays in text and badges, so the bars
 * never repaint by state.
 */
function FillBars({ summary }: { summary: FieldSummary }) {
  return (
    <span className="flex w-24 shrink-0 flex-col gap-0.5" aria-hidden="true">
      <span className="h-1.5 rounded-sm bg-slate-100">
        <span className="block h-full rounded-sm bg-slate-400" style={{ width: `${summary.baselineFillRate * 100}%` }} />
      </span>
      <span className="h-1.5 rounded-sm bg-slate-100">
        <span className="block h-full rounded-sm bg-sky-600" style={{ width: `${summary.latestFillRate * 100}%` }} />
      </span>
    </span>
  );
}

export function FieldList({ summaries, selectedField, sort, onSort, onSelectField, degraded }: FieldListProps) {
  const sorted = sortSummaries(summaries, sort.column, sort.direction);

  const sortIndicator = (column: FieldListSortColumn) => {
    if (sort.column !== column) return "↕";
    return sort.direction === "asc" ? "↑" : "↓";
  };

  return (
    <div className="max-h-[640px] overflow-auto rounded border bg-white" data-testid="field-list">
      <div role="table" className="w-full text-sm">
        <div role="rowgroup" className="sticky top-0 z-10">
          <div role="row" className="flex border-b border-slate-200 bg-slate-100">
            {COLUMNS.map((column) => (
              <div
                key={column.id}
                role="columnheader"
                aria-sort={sort.column === column.id ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                className={`p-2 ${column.id === "field" ? "flex-1" : "w-24 shrink-0"}`}
              >
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium hover:text-sky-700"
                  data-testid={`field-list-sort-${column.id}`}
                  onClick={() => onSort(column.id)}
                >
                  {column.label}
                  <span className="text-slate-500" aria-hidden="true">
                    {sortIndicator(column.id)}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
        <div role="rowgroup">
          {sorted.map((summary) => {
            const isSelected = summary.field === selectedField;
            return (
              <div
                key={summary.field}
                role="row"
                tabIndex={0}
                aria-current={isSelected ? "true" : undefined}
                data-testid={`field-row-${summary.field}`}
                data-selected={isSelected ? "true" : "false"}
                className={`flex cursor-pointer border-b border-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 ${
                  isSelected ? "bg-sky-100 ring-1 ring-inset ring-sky-300" : "hover:bg-sky-50"
                }`}
                onClick={() => onSelectField(summary.field)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectField(summary.field);
                  }
                }}
              >
                <div role="cell" className="min-w-0 flex-1 p-2">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium" title={summary.field}>
                      {summary.field}
                    </span>
                    {policyBadge(summary)}
                  </span>
                  <span className="text-xs text-slate-500">{formatFillTransition(summary)}</span>
                </div>
                <div role="cell" className="w-24 shrink-0 p-2">
                  <FillBars summary={summary} />
                </div>
                <div role="cell" className="w-24 shrink-0 p-2 text-xs">
                  {degraded ? (
                    <span className="text-slate-400">—</span>
                  ) : summary.cells.review > 0 ? (
                    <span className="font-medium text-amber-900">{summary.cells.review}</span>
                  ) : (
                    <span className="text-slate-400">0</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
