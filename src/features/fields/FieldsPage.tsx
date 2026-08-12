import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { buildFieldDetail, buildFieldSummaries } from "../../engine/field-view";
import { getProfile } from "../../profiles";
import { useUiStore } from "../../stores/ui-store";
import { FieldDetailPanel } from "./FieldDetailPanel";
import { FieldList } from "./FieldList";
import type { FieldListSortColumn, SortDirection } from "./field-view-table";

/**
 * The field-first explorer: pick a field, see both files' values for every
 * record, and (when a review and current profile exist) decide backfills in
 * place.
 *
 * Degrades honestly: with no review the tab still visualizes from the
 * analysis alone — fill rates, distributions, values — and states why
 * decisions are off, instead of hiding.
 */
export function FieldsPage() {
  const analysis = useUiStore((state) => state.analysis);
  const review = useUiStore((state) => state.review);
  const [params, setParams] = useSearchParams();
  const [listSort, setListSort] = useState<{ column: FieldListSortColumn; direction: SortDirection }>({
    column: "review",
    direction: "desc"
  });

  // Never fall back to a default profile here: a silently substituted policy
  // would put the wrong badges behind every field.
  const profile = review ? getProfile(review.profileId) : null;

  const summaries = useMemo(
    () => (analysis ? buildFieldSummaries(analysis, review, profile) : []),
    [analysis, review, profile]
  );

  const requestedField = params.get("field");
  const selectedField = useMemo(() => {
    if (!requestedField) return null;
    // A stale deep link degrades to no selection, never a blank panel.
    return summaries.some((summary) => summary.field === requestedField) ? requestedField : null;
  }, [requestedField, summaries]);

  const detail = useMemo(
    () => (analysis && selectedField ? buildFieldDetail(analysis, selectedField, review, profile) : null),
    [analysis, selectedField, review, profile]
  );

  if (!analysis) {
    return <p className="p-6">Run an analysis first.</p>;
  }

  const selectField = (field: string) => {
    const next = new URLSearchParams(params);
    next.set("field", field);
    setParams(next, { replace: true });
  };

  const onListSort = (column: FieldListSortColumn) => {
    setListSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: column === "field" ? "asc" : "desc" }
    );
  };

  return (
    <div className="space-y-4 p-6" data-testid="fields-explorer">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Explore</h2>
        <p className="text-sm text-slate-600">
          Every record's value in both files, one field at a time. Pick a field to see its reference values and where
          the two exports disagree.
        </p>
        {!review ? (
          <p className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700" data-testid="fields-no-review">
            No recovery review exists for this run, so lanes and decisions are unavailable — the values themselves are
            shown from the analysis.
          </p>
        ) : null}
      </header>

      <div className="grid gap-4 md:grid-cols-[22rem_minmax(0,1fr)]">
        <FieldList
          summaries={summaries}
          selectedField={selectedField}
          sort={listSort}
          onSort={onListSort}
          onSelectField={selectField}
          degraded={!review || !profile}
        />
        {detail ? (
          <FieldDetailPanel key={detail.field} detail={detail} />
        ) : (
          <p className="rounded border bg-white p-6 text-sm text-slate-600" data-testid="field-detail-prompt">
            Select a field on the left to see every record's candidate and reference value.
          </p>
        )}
      </div>
    </div>
  );
}
