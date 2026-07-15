import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MiniSearch from "minisearch";
import { useVirtualizer } from "@tanstack/react-virtual";
import { intersectSets } from "../../lib/sets";
import { useUiStore } from "../../stores/ui-store";

const SEARCH_DEBOUNCE_MS = 120;

export function RecordsPage() {
  const analysis = useUiStore((state) => state.analysis);
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
              return (
                <tr key={id} data-testid={`record-${id}`} style={{ position: "absolute", transform: `translateY(${virtualItem.start}px)`, width: "100%" }}>
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
      {filteredIds[0] ? <RecordDetail recordId={filteredIds[0]} /> : null}
    </div>
  );
}

function RecordDetail({ recordId }: { recordId: string }) {
  const analysis = useUiStore((state) => state.analysis);
  const [showDocs, setShowDocs] = useState(false);

  if (!analysis) return null;
  const record = analysis.recordsById[recordId];
  const bidDocs = record.documentDiffs.BidDocuments;

  return (
    <section className="rounded border bg-white p-4" data-testid="record-details">
      <h3 className="font-medium">Expanded record details: {record.recordKey}</h3>
      <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
        <div><h4 className="font-medium">Baseline</h4><pre className="mt-2 max-h-56 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(record.baseline ?? {}, null, 2)}</pre></div>
        <div><h4 className="font-medium">Latest</h4><pre className="mt-2 max-h-56 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(record.latest ?? {}, null, 2)}</pre></div>
      </div>
      {bidDocs ? (
        <div className="mt-4 rounded border border-slate-200 p-3" data-testid="document-summary">
          <p>Bid documents: {bidDocs.baselineCount} → {bidDocs.latestCount}</p>
          <p>{bidDocs.removedCount} removed · {bidDocs.addedCount} added · {bidDocs.modifiedCount} modified · {bidDocs.unchangedCount} unchanged</p>
          <button className="mt-2 rounded border px-3 py-1 text-sm" onClick={() => setShowDocs((state) => !state)}>View document comparison</button>
          {showDocs ? (
            <table className="mt-3 w-full text-left text-sm" data-testid="document-comparison">
              <thead><tr><th>Status</th><th>Title</th><th>URL</th><th>Hash</th><th>Field changes</th></tr></thead>
              <tbody>
                {bidDocs.changes.map((change) => (
                  <tr key={`${change.kind}-${change.documentId}`}>
                    <td>{change.kind}</td>
                    <td>{change.latest?.title ?? change.baseline?.title ?? ""}</td>
                    <td>{change.latest?.url ?? change.baseline?.url ?? ""}</td>
                    <td>{change.documentId}</td>
                    <td>{change.changedFields.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
