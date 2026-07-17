import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MiniSearch from "minisearch";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RecordDetail } from "../../components/records/RecordDetail";
import { intersectSets } from "../../lib/sets";
import { useUiStore } from "../../stores/ui-store";

const SEARCH_DEBOUNCE_MS = 120;

export function RecordsPage() {
  const analysis = useUiStore((state) => state.analysis);
  const selectedRecordId = useUiStore((state) => state.selectedRecordId);
  const setSelectedRecordId = useUiStore((state) => state.setSelectedRecordId);
  const [params, setParams] = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(params.get("q") ?? "");
  const [searchText, setSearchText] = useState(params.get("q") ?? "");

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
    if (!filteredIds.includes(selectedRecordId)) {
      setSelectedRecordId(null);
    }
  }, [filteredIds, selectedRecordId, setSelectedRecordId]);

  const rowVirtualizer = useVirtualizer({
    count: filteredIds.length,
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
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Status</th><th className="p-2">Record Key</th><th className="p-2">Title</th><th className="p-2">Changed fields</th><th className="p-2">Document changes</th><th className="p-2">Severity</th></tr></thead>
          <tbody style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const id = filteredIds[virtualItem.index];
              const record = analysis.recordsById[id];
              const docSummary = record.documentDiffs.BidDocuments;
              const isSelected = selectedRecordId === id;
              return (
                <tr
                  key={id}
                  data-testid={`record-${id}`}
                  data-selected={isSelected ? "true" : "false"}
                  className={`cursor-pointer border-b border-slate-100 hover:bg-sky-50 ${isSelected ? "bg-sky-100 ring-1 ring-inset ring-sky-300" : ""}`}
                  style={{ position: "absolute", transform: `translateY(${virtualItem.start}px)`, width: "100%" }}
                  onClick={() => selectRecord(id)}
                >
                  <td className="p-2">{record.status}</td>
                  <td className="p-2">{record.recordKey}</td>
                  <td className="p-2">{String((record.latest ?? record.baseline)?.Title ?? "")}</td>
                  <td className="p-2">{record.changedFieldCount}</td>
                  <td className="p-2">{docSummary ? `${docSummary.addedCount} added · ${docSummary.removedCount} removed · ${docSummary.modifiedCount} modified` : "-"}</td>
                  <td className="p-2">{record.severity}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedRecordId && filteredIds.includes(selectedRecordId) ? (
        <RecordDetail recordId={selectedRecordId} onClose={closeDetail} />
      ) : (
        <p className="text-sm text-slate-500">Click a record to view expanded details with baseline vs latest highlighting.</p>
      )}
    </div>
  );
}
