import { useMemo, useState, type ReactNode } from "react";
import type { FieldCell, FieldDetail } from "../../engine/field-view";
import { FieldRecordsTable } from "./FieldRecordsTable";
import { FieldValueDistribution } from "./FieldValueDistribution";
import { filterCells, formatPercent, sortCells, type CellSortColumn, type SituationFilter, type SortDirection } from "./field-view-table";

type FieldDetailPanelProps = {
  detail: FieldDetail;
  renderDecision?: (cell: FieldCell) => ReactNode;
  /** Bulk controls, given the filtered cells and the filter scope in words. */
  renderBulk?: (visibleCells: FieldCell[], scopeDescription: string) => ReactNode;
};

const SITUATION_OPTIONS: Array<{ value: SituationFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "candidate_blank", label: "Candidate blank" },
  { value: "conflict", label: "Conflict" },
  { value: "reference_blank", label: "Reference blank" },
  { value: "unchanged", label: "Unchanged" },
  { value: "only_one_file", label: "Only in one file" }
];

export function FieldDetailPanel({ detail, renderDecision, renderBulk }: FieldDetailPanelProps) {
  const [situation, setSituation] = useState<SituationFilter>("all");
  const [valueGroup, setValueGroup] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ column: CellSortColumn; direction: SortDirection }>({
    column: "recordKey",
    direction: "asc"
  });

  const visibleCells = useMemo(
    () => sortCells(filterCells(detail.cells, { situation, valueGroup, search }), sort.column, sort.direction),
    [detail.cells, situation, valueGroup, search, sort]
  );

  const onSort = (column: CellSortColumn) => {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" }
    );
  };

  const { evidence, policy } = detail;

  return (
    <section aria-labelledby="field-detail-heading" className="min-w-0 space-y-4" data-testid="field-detail">
      <div className="rounded border bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="field-detail-heading" className="font-medium">
            {detail.field}
          </h3>
          <p className="text-xs text-slate-500">
            fill {formatPercent(evidence.baselineFillRate)} → {formatPercent(evidence.latestFillRate)}
          </p>
        </div>

        {/* §6.3: the evidence, at the moment of choosing, in the proposal's own terms. */}
        <p className="mt-2 text-sm" data-testid="field-evidence">
          <strong>{evidence.eligibleCount}</strong> eligible · <strong>{evidence.conflictCount}</strong> conflict(s) ·{" "}
          <strong>{evidence.comparablePairCount}</strong> comparable pair(s)
          {evidence.volatilityUnmeasurable ? (
            <span className="text-amber-900" data-testid="volatility-unmeasurable">
              {" "}
              · volatility unmeasurable from this run pair
            </span>
          ) : null}
        </p>

        {policy ? (
          <p className="mt-1 text-xs text-slate-600" data-testid="field-policy">
            {policy.dateSensitive && !policy.excluded ? (
              <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 ring-1 ring-amber-400">
                rule 6
              </span>
            ) : null}
            {policy.description}
          </p>
        ) : null}

        {detail.decisionsUnavailableReason ? (
          <p
            className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
            data-testid="decisions-unavailable"
          >
            Decisions are unavailable: {detail.decisionsUnavailableReason}
          </p>
        ) : null}
      </div>

      <div className="rounded border bg-white p-4">
        <h4 className="text-sm font-medium">Reference values</h4>
        <div className="mt-2">
          <FieldValueDistribution
            distribution={detail.distribution}
            selectedValue={valueGroup}
            onSelectValue={setValueGroup}
          />
        </div>
      </div>

      <div className="rounded border bg-white p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            <span className="text-xs text-slate-500">Situation</span>
            <select
              className="rounded border border-slate-300 p-1"
              data-testid="filter-situation"
              value={situation}
              onChange={(event) => setSituation(event.target.value as SituationFilter)}
            >
              {SITUATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <input
            className="min-w-[12rem] flex-1 rounded border border-slate-300 p-1 text-sm"
            placeholder="Search record keys and values"
            data-testid="field-cells-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span className="text-xs text-slate-500" data-testid="field-cells-count" aria-live="polite">
            Showing {visibleCells.length} of {detail.cells.length}
          </span>
          {valueGroup !== null || situation !== "all" || search !== "" ? (
            <button
              type="button"
              className="rounded border px-2 py-0.5 text-xs text-sky-700 hover:bg-slate-100"
              data-testid="field-filter-reset"
              onClick={() => {
                setSituation("all");
                setValueGroup(null);
                setSearch("");
              }}
            >
              Reset filters
            </button>
          ) : null}
        </div>

        {renderBulk ? (
          <div className="mt-3">
            {renderBulk(
              visibleCells,
              [
                situation !== "all" ? SITUATION_OPTIONS.find((option) => option.value === situation)?.label : null,
                valueGroup !== null ? `value ${valueGroup}` : null,
                search.trim() !== "" ? `search "${search.trim()}"` : null
              ]
                .filter(Boolean)
                .join(" · ")
            )}
          </div>
        ) : null}

        {visibleCells.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600" data-testid="field-cells-empty">
            No rows match this filter.
          </p>
        ) : (
          <div className="mt-3">
            <FieldRecordsTable cells={visibleCells} sort={sort} onSort={onSort} renderDecision={renderDecision} />
          </div>
        )}
      </div>
    </section>
  );
}
