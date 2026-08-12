import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AnalysisResult } from "../../engine/types";
import { useUiStore } from "../../stores/ui-store";
import { FieldChangesTable } from "./FieldChangesTable";
import {
  sortFieldChangeRows,
  type FieldChangeRow,
  type FieldSortColumn,
  type SortDirection
} from "./field-changes-table";

type SortState = {
  column: FieldSortColumn;
  direction: SortDirection;
};

function buildFieldChangeRows(analysis: AnalysisResult): FieldChangeRow[] {
  const kindCounts: Record<string, { emptied: number; restored: number; modified: number }> = {};

  for (const record of Object.values(analysis.recordsById)) {
    for (const change of record.changedFields) {
      let counts = kindCounts[change.path];
      if (!counts) {
        counts = { emptied: 0, restored: 0, modified: 0 };
        kindCounts[change.path] = counts;
      }
      if (change.kind === "emptied") counts.emptied += 1;
      else if (change.kind === "restored") counts.restored += 1;
      else if (change.kind === "modified") counts.modified += 1;
    }
  }

  return analysis.fieldStats.map((stat) => ({
    field: stat.field,
    changedRecords: analysis.indexes.byField[stat.field]?.size ?? 0,
    emptied: kindCounts[stat.field]?.emptied ?? 0,
    restored: kindCounts[stat.field]?.restored ?? 0,
    modified: kindCounts[stat.field]?.modified ?? 0,
    baselinePresentRate: stat.baselinePresentRate,
    latestPresentRate: stat.latestPresentRate,
    populationChange: stat.populationChange,
    severity: stat.severity
  }));
}

export function FieldChangesPage() {
  const analysis = useUiStore((state) => state.analysis);
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortState>({ column: "field", direction: "asc" });

  const rows = useMemo(() => (analysis ? buildFieldChangeRows(analysis) : []), [analysis]);

  const sortedRows = useMemo(
    () => sortFieldChangeRows(rows, sort.column, sort.direction),
    [rows, sort.column, sort.direction]
  );

  if (!analysis) return <p className="p-6">Run an analysis first.</p>;

  const toggleSort = (column: FieldSortColumn) => {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" }
    );
  };

  const selectField = (field: string) => {
    // The Explore tab is the field-first drill-down this click was always
    // reaching for: values, distribution, and per-record rows for one field.
    // (The Records tab, by contrast, lists records that changed ANY field.)
    navigate(`/results?tab=explore&field=${encodeURIComponent(field)}`);
  };

  return (
    <div className="space-y-4 p-6">
      <h2 className="text-xl font-semibold">Field Changes</h2>
      <FieldChangesTable rows={sortedRows} sort={sort} onSort={toggleSort} onSelectField={selectField} />
    </div>
  );
}
