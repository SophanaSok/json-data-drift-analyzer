import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  applyFindingFilters,
  DEFAULT_FINDING_FILTER,
  deriveFilterOptions,
  isFilterActive,
  type FindingFilter
} from "./recovery-review-table";
import type { Finding } from "../../engine/findings";

const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-red-100 text-red-900",
  high: "bg-amber-100 text-amber-900",
  medium: "bg-sky-100 text-sky-900",
  low: "bg-slate-100 text-slate-700",
  info: "bg-slate-100 text-slate-600"
};

const ACTION_CLASS: Record<string, string> = {
  backfill_allowed: "bg-emerald-100 text-emerald-900",
  manual_review: "bg-amber-100 text-amber-900",
  exclude: "bg-red-100 text-red-900",
  report_only: "bg-slate-100 text-slate-700"
};

/**
 * Filterable, virtualized list of QA findings.
 *
 * Virtualized because a real run produces thousands — this source yields 3,399 — and
 * rendering them all would make the tab unusable. Filtering is a pure function in
 * recovery-review-table.ts; this component only holds the selection.
 */
export function FindingsExplorer({ findings }: { findings: Finding[] }) {
  const [filter, setFilter] = useState<FindingFilter>(DEFAULT_FINDING_FILTER);
  const scrollRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => deriveFilterOptions(findings), [findings]);
  const visible = useMemo(() => applyFindingFilters(findings, filter), [findings, filter]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 76,
    overscan: 8
  });

  const set = (patch: Partial<FindingFilter>) => setFilter((current) => ({ ...current, ...patch }));

  return (
    <section className="rounded border bg-white p-4" data-testid="findings-explorer">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">Findings</h3>
        <p className="text-xs text-slate-500" data-testid="findings-count">
          Showing {visible.length} of {findings.length}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-xs text-slate-500">Severity</span>
          <select
            className="rounded border border-slate-300 p-1"
            data-testid="filter-severity"
            value={filter.severity}
            onChange={(event) => set({ severity: event.target.value as FindingFilter["severity"] })}
          >
            <option value="all">All</option>
            {options.severities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1">
          <span className="text-xs text-slate-500">Category</span>
          <select
            className="rounded border border-slate-300 p-1"
            data-testid="filter-category"
            value={filter.category}
            onChange={(event) => set({ category: event.target.value as FindingFilter["category"] })}
          >
            <option value="all">All</option>
            {options.categories.map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1">
          <span className="text-xs text-slate-500">Field</span>
          <select
            className="rounded border border-slate-300 p-1"
            data-testid="filter-field"
            value={filter.field}
            onChange={(event) => set({ field: event.target.value })}
          >
            <option value="all">All</option>
            {options.fields.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1">
          <span className="text-xs text-slate-500">Action</span>
          <select
            className="rounded border border-slate-300 p-1"
            data-testid="filter-action"
            value={filter.action}
            onChange={(event) => set({ action: event.target.value as FindingFilter["action"] })}
          >
            <option value="all">All</option>
            {options.actions.map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>

        <input
          className="min-w-[12rem] flex-1 rounded border border-slate-300 p-1"
          placeholder="Search message or record"
          data-testid="filter-search"
          value={filter.search}
          onChange={(event) => set({ search: event.target.value })}
        />

        {isFilterActive(filter) ? (
          <button
            className="rounded border px-2 py-1 text-xs text-sky-700 hover:bg-slate-100"
            data-testid="filter-reset"
            onClick={() => setFilter(DEFAULT_FINDING_FILTER)}
          >
            Reset filters
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600" data-testid="findings-empty">
          No findings match these filters.
        </p>
      ) : (
        <div ref={scrollRef} tabIndex={0} aria-label="Findings list" className="mt-3 max-h-[26rem] overflow-auto rounded border">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const finding = visible[virtualRow.index]!;
              return (
                <div
                  key={finding.id}
                  className="absolute left-0 top-0 w-full border-b p-2 text-sm"
                  style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                  data-testid={`finding-row-${virtualRow.index}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${SEVERITY_CLASS[finding.severity] ?? ""}`}>
                      {finding.severity}
                    </span>
                    <span className="text-xs text-slate-500">{finding.category.replace(/_/g, " ")}</span>
                    {finding.fieldPath ? <code className="text-xs">{finding.fieldPath}</code> : null}
                    <span className={`ml-auto rounded px-2 py-0.5 text-xs ${ACTION_CLASS[finding.recommendedAction] ?? ""}`}>
                      {finding.recommendedAction.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-slate-700">{finding.message}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
