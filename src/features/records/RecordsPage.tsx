import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MiniSearch from "minisearch";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RecordDetail } from "../../components/records/RecordDetail";
import { intersectSets } from "../../lib/sets";
import { useUiStore } from "../../stores/ui-store";
import {
  formatDocumentSummary,
  getRecordFieldValue,
  sortRecordIds,
  type RecordSortColumn,
  type SortDirection
} from "./record-table";

const SEARCH_DEBOUNCE_MS = 120;

type SortState = {
  column: RecordSortColumn;
  direction: SortDirection;
};

const SORT_COLUMNS: Array<{ id: RecordSortColumn; label: string; width: string }> = [
  { id: "status", label: "Status", width: "7%" },
  { id: "recordKey", label: "Record Key", width: "12%" },
  { id: "title", label: "Title", width: "24%" },
  { id: "publishedDate", label: "Published Date", width: "11%" },
  { id: "dueDate", label: "Due Date", width: "11%" },
  { id: "changedFields", label: "Changed fields", width: "9%" },
  { id: "documentChanges", label: "Document changes", width: "18%" },
  { id: "severity", label: "Severity", width: "8%" }
];

const RECORD_CELL_CLASS = "truncate p-2 align-top";

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

  const parentRef = useRef<HTMLDivElement | null>(null);

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

  const rowVirtualizer = useVirtualizer({
    count: sortedIds.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44
  });

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

  const sortIndicator = (column: RecordSortColumn) => {
    if (sort.column !== column) return "↕";
    return sort.direction === "asc" ? "↑" : "↓";
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
      <div id="records-scroll" ref={parentRef} className="max-h-[520px] overflow-auto rounded border bg-white">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            {SORT_COLUMNS.map((column) => (
              <col key={column.id} style={{ width: column.width }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-slate-200 bg-slate-100">
              {SORT_COLUMNS.map((column) => (
                <th key={column.id} className="bg-slate-100 p-2 align-top">
                  <button
                    type="button"
                    className="inline-flex max-w-full items-center gap-1 truncate font-medium hover:text-sky-700"
                    aria-sort={sort.column === column.id ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                    data-testid={`sort-${column.id}`}
                    onClick={() => toggleSort(column.id)}
                  >
                    <span className="truncate">{column.label}</span>
                    <span className="shrink-0 text-xs text-slate-500" aria-hidden="true">{sortIndicator(column.id)}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const id = sortedIds[virtualItem.index];
              const record = analysis.recordsById[id];
              const docSummary = formatDocumentSummary(record);
              const isSelected = selectedRecordId === id;
              return (
                <tr
                  key={id}
                  data-testid={`record-${id}`}
                  data-selected={isSelected ? "true" : "false"}
                  className={`cursor-pointer border-b border-slate-100 hover:bg-sky-50 ${isSelected ? "bg-sky-100 ring-1 ring-inset ring-sky-300" : ""}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    transform: `translateY(${virtualItem.start}px)`,
                    width: "100%",
                    display: "table",
                    tableLayout: "fixed"
                  }}
                  onClick={() => selectRecord(id)}
                >
                  <td className={RECORD_CELL_CLASS} title={record.status}>{record.status}</td>
                  <td className={RECORD_CELL_CLASS} title={record.recordKey}>{record.recordKey}</td>
                  <td className={RECORD_CELL_CLASS} title={getRecordFieldValue(record, "Title")}>{getRecordFieldValue(record, "Title")}</td>
                  <td className={RECORD_CELL_CLASS} title={getRecordFieldValue(record, "PublishedDate") || "-"}>{getRecordFieldValue(record, "PublishedDate") || "-"}</td>
                  <td className={RECORD_CELL_CLASS} title={getRecordFieldValue(record, "DueDate") || "-"}>{getRecordFieldValue(record, "DueDate") || "-"}</td>
                  <td className={RECORD_CELL_CLASS} title={String(record.changedFieldCount)}>{record.changedFieldCount}</td>
                  <td className={RECORD_CELL_CLASS} title={docSummary}>{docSummary}</td>
                  <td className={RECORD_CELL_CLASS} title={record.severity}>{record.severity}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedRecordId && sortedIds.includes(selectedRecordId) ? (
        <RecordDetail recordId={selectedRecordId} onClose={closeDetail} />
      ) : (
        <p className="text-sm text-slate-500">Click a record to view expanded details with baseline vs latest highlighting.</p>
      )}
    </div>
  );
}
