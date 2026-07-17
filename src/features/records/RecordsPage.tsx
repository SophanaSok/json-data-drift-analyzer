import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MiniSearch from "minisearch";
import { RecordDetail } from "../../components/records/RecordDetail";
import { intersectSets } from "../../lib/sets";
import { useUiStore } from "../../stores/ui-store";
import { sortRecordIds, type RecordSortColumn, type SortDirection } from "./record-table";
import { RecordsTable } from "./RecordsTable";

const SEARCH_DEBOUNCE_MS = 120;

type SortState = {
  column: RecordSortColumn;
  direction: SortDirection;
};

export function RecordsPage() {
  const analysis = useUiStore((state) => state.analysis);
  const selectedRecordId = useUiStore((state) => state.selectedRecordId);
  const setSelectedRecordId = useUiStore((state) => state.setSelectedRecordId);
  const [params, setParams] = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(params.get("q") ?? "");
  const [searchText, setSearchText] = useState(params.get("q") ?? "");
  const [sort, setSort] = useState<SortState>({ column: "recordKey", direction: "asc" });

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchText(searchDraft);
      const next = new URLSearchParams(params);
      if (searchDraft) next.set("q", searchDraft);
      else next.delete("q");
      setParams(next, { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchDraft, params, setParams]);

  const status = (params.get("status") ?? "all") as "all" | "added" | "removed" | "changed" | "unchanged";
  const field = params.get("field");
  const kind = (params.get("kind") ?? "all") as "all" | "added" | "removed" | "modified" | "emptied" | "restored";
  const severity = (params.get("severity") ?? "all") as "all" | "pass" | "info" | "warning" | "high" | "critical";
  const documentState = (params.get("doc") ?? "all") as "all" | "added" | "removed" | "modified" | "incomplete" | "hashMismatch" | "decreasedCount";

  const filteredIds = useMemo(() => {
    if (!analysis) return [];
    const sets = [
      status === "all" ? undefined : analysis.indexes.byStatus[status],
      field ? analysis.indexes.byField[field] : undefined,
      kind === "all" ? undefined : analysis.indexes.byChangeKind[kind],
      severity === "all" ? undefined : analysis.indexes.bySeverity[severity],
      documentState === "all" ? undefined : analysis.indexes.byDocumentState[documentState]
    ];

    let ids = intersectSets(sets);
    if (sets.every((set) => !set)) {
      ids = new Set(analysis.allRecordIds);
    }

    if (searchText.trim()) {
      const search = MiniSearch.loadJSON(String(analysis.searchIndexJson), {
        fields: ["recordKey", "title", "bidStatus", "bidType", "bidUrl", "changedFields", "qualityText", "documentText"],
        storeFields: ["id"]
      });
      const matches = new Set(search.search(searchText).map((item) => String(item.id)));
      ids = intersectSets([ids, matches]);
    }

    return analysis.sorts.byRecordKey.filter((id) => ids.has(id));
  }, [analysis, status, field, kind, severity, documentState, searchText]);

  const sortedIds = useMemo(() => {
    if (!analysis) return filteredIds;
    return sortRecordIds(filteredIds, analysis.recordsById, sort.column, sort.direction);
  }, [analysis, filteredIds, sort.column, sort.direction]);

  const sortedRecords = useMemo(() => {
    if (!analysis) return [];
    return sortedIds.map((id) => analysis.recordsById[id]).filter(Boolean);
  }, [analysis, sortedIds]);

  const recordKeyFromUrl = params.get("record");

  useEffect(() => {
    if (!analysis) return;
    if (!recordKeyFromUrl) return;
    const match = analysis.allRecordIds.find((id) => analysis.recordsById[id]?.recordKey === recordKeyFromUrl);
    if (match && filteredIds.includes(match)) {
      setSelectedRecordId(match);
    }
  }, [analysis, recordKeyFromUrl, filteredIds, setSelectedRecordId]);

  useEffect(() => {
    if (!selectedRecordId) return;
    if (!sortedIds.includes(selectedRecordId)) {
      setSelectedRecordId(null);
    }
  }, [sortedIds, selectedRecordId, setSelectedRecordId]);

  if (!analysis) return <p className="p-6">Run an analysis first.</p>;

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === "all") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setParams(next);
  };

  const selectRecord = (id: string) => {
    const nextSelected = selectedRecordId === id ? null : id;
    setSelectedRecordId(nextSelected);
    const next = new URLSearchParams(params);
    if (nextSelected) {
      next.set("record", analysis.recordsById[nextSelected].recordKey);
    } else {
      next.delete("record");
    }
    setParams(next, { replace: true });
  };

  const closeDetail = () => {
    setSelectedRecordId(null);
    const next = new URLSearchParams(params);
    next.delete("record");
    setParams(next, { replace: true });
  };

  const toggleSort = (column: RecordSortColumn) => {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" }
    );
  };

  return (
    <div className="space-y-4 p-6">
      <h2 className="text-xl font-semibold">Records</h2>
      <div className="flex flex-wrap gap-2 text-sm">
        {["all", "added", "removed", "changed", "unchanged"].map((value) => (
          <button key={value} className={`rounded border px-3 py-1 ${status === value ? "bg-sky-100" : "bg-white"}`} onClick={() => updateParam("status", value)}>{value}</button>
        ))}
        <input className="rounded border px-2 py-1" placeholder="Search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />
        <select className="rounded border px-2 py-1" value={field ?? ""} onChange={(event) => updateParam("field", event.target.value)}>
          <option value="">All fields</option>
          {Object.keys(analysis.indexes.byField).sort().map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select className="rounded border px-2 py-1" value={kind} onChange={(event) => updateParam("kind", event.target.value)}>
          <option value="all">All change kinds</option>
          <option value="added">added</option><option value="removed">removed</option><option value="modified">modified</option><option value="emptied">emptied</option><option value="restored">restored</option>
        </select>
      </div>
      <p className="text-sm text-slate-600">Showing {filteredIds.length} of {analysis.allRecordIds.length} records</p>
      <RecordsTable
        records={sortedRecords}
        selectedRecordId={selectedRecordId}
        sort={sort}
        onSort={toggleSort}
        onSelectRecord={selectRecord}
      />
      {selectedRecordId && sortedIds.includes(selectedRecordId) ? (
        <RecordDetail recordId={selectedRecordId} onClose={closeDetail} />
      ) : (
        <p className="text-sm text-slate-500">Click a record to view expanded details with baseline vs latest highlighting.</p>
      )}
    </div>
  );
}
