import { useState } from "react";
import { useUiStore } from "../../stores/ui-store";
import {
  changeKindLabel,
  changeKindStyles,
  collectTopLevelKeys,
  formatDiffValue,
  isFieldPathChanged
} from "../../lib/diff-display";
import type { DiffRecord } from "../../engine/types";

type RecordDetailProps = {
  recordId: string;
  onClose?: () => void;
};

export function RecordDetail({ recordId, onClose }: RecordDetailProps) {
  const analysis = useUiStore((state) => state.analysis);
  const [showDocs, setShowDocs] = useState(false);

  if (!analysis) return null;
  const record = analysis.recordsById[recordId];
  if (!record) return null;

  const bidDocs = record.documentDiffs.BidDocuments;
  const changedPaths = new Set(record.changedFields.map((change) => change.path));

  return (
    <section className="rounded border bg-white p-4" data-testid="record-details">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Expanded record details: {record.recordKey}</h3>
          <p className="mt-1 text-sm text-slate-600">
            Status: <span className="font-medium">{record.status}</span>
            {record.changedFieldCount > 0 ? ` · ${record.changedFieldCount} changed field${record.changedFieldCount === 1 ? "" : "s"}` : null}
          </p>
        </div>
        {onClose ? (
          <button type="button" className="rounded border px-2 py-1 text-sm text-slate-600 hover:bg-slate-50" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>

      {record.changedFields.length > 0 ? (
        <div className="mt-4" data-testid="field-changes">
          <h4 className="font-medium">Field changes</h4>
          <div className="mt-2 overflow-auto rounded border">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-2">Field</th>
                  <th className="p-2">Change</th>
                  <th className="p-2">Baseline</th>
                  <th className="p-2">Latest</th>
                </tr>
              </thead>
              <tbody>
                {record.changedFields.map((change) => {
                  const styles = changeKindStyles(change.kind);
                  return (
                    <tr key={change.path} className={styles.row} data-testid={`field-change-${change.path}`}>
                      <td className="p-2 font-mono text-xs">{change.path}</td>
                      <td className="p-2 capitalize">{changeKindLabel(change.kind)}</td>
                      <td className={`p-2 font-mono text-xs whitespace-pre-wrap ${styles.baseline}`}>{formatDiffValue(change.baselineValue)}</td>
                      <td className={`p-2 font-mono text-xs whitespace-pre-wrap ${styles.latest}`}>{formatDiffValue(change.latestValue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-600">No field-level changes detected.</p>
      )}

      <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <RecordSnapshot title="Baseline" record={record} side="baseline" changedPaths={changedPaths} />
        <RecordSnapshot title="Latest" record={record} side="latest" changedPaths={changedPaths} />
      </div>

      {bidDocs ? (
        <div className="mt-4 rounded border border-slate-200 p-3" data-testid="document-summary">
          <p>Bid documents: {bidDocs.baselineCount} → {bidDocs.latestCount}</p>
          <p>{bidDocs.removedCount} removed · {bidDocs.addedCount} added · {bidDocs.modifiedCount} modified · {bidDocs.unchangedCount} unchanged</p>
          <button type="button" className="mt-2 rounded border px-3 py-1 text-sm" onClick={() => setShowDocs((state) => !state)}>
            View document comparison
          </button>
          {showDocs ? (
            <table className="mt-3 w-full text-left text-sm" data-testid="document-comparison">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Title</th>
                  <th>URL</th>
                  <th>Hash</th>
                  <th>Field changes</th>
                </tr>
              </thead>
              <tbody>
                {bidDocs.changes.map((change) => (
                  <DocumentChangeRow key={`${change.kind}-${change.documentId}`} change={change} />
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function RecordSnapshot({
  title,
  record,
  side,
  changedPaths
}: {
  title: string;
  record: DiffRecord;
  side: "baseline" | "latest";
  changedPaths: Set<string>;
}) {
  const snapshot = side === "baseline" ? record.baseline : record.latest;
  const keys = collectTopLevelKeys(record.baseline, record.latest);

  return (
    <div>
      <h4 className="font-medium">{title}</h4>
      {snapshot ? (
        <dl className="mt-2 max-h-56 overflow-auto rounded border bg-slate-50 p-2">
          {keys.map((key) => {
            const changed = isFieldPathChanged(key, changedPaths);
            const value = snapshot[key];
            const missing = value === undefined;
            return (
              <div
                key={key}
                className={`border-b border-slate-200 py-1 last:border-b-0 ${changed ? (side === "baseline" ? "bg-red-50" : "bg-emerald-50") : ""}`}
                data-testid={changed ? `changed-field-${side}-${key}` : undefined}
              >
                <dt className="font-mono text-xs text-slate-500">{key}</dt>
                <dd className={`mt-0.5 font-mono text-xs whitespace-pre-wrap break-all ${missing ? "text-slate-400 italic" : changed ? "font-medium" : ""}`}>
                  {missing ? "—" : formatDiffValue(value)}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="mt-2 rounded bg-slate-50 p-2 text-slate-500 italic">No {title.toLowerCase()} record</p>
      )}
    </div>
  );
}

function DocumentChangeRow({
  change
}: {
  change: {
    kind: string;
    documentId: string;
    baseline?: { title: string | null; url: string | null; hash: string | null };
    latest?: { title: string | null; url: string | null; hash: string | null };
    changedFields: Array<"title" | "url" | "hash">;
  };
}) {
  const rowClass =
    change.kind === "removed"
      ? "bg-red-50"
      : change.kind === "added"
        ? "bg-emerald-50"
        : change.kind === "modified"
          ? "bg-amber-50"
          : "";

  const highlight = (field: "title" | "url" | "hash", value: string) => {
    const changed = change.changedFields.includes(field);
    return <span className={changed ? "rounded bg-amber-100 px-0.5 font-medium" : ""}>{value}</span>;
  };

  return (
    <tr className={rowClass}>
      <td className="capitalize">{change.kind}</td>
      <td>
        {highlight("title", change.latest?.title ?? change.baseline?.title ?? "")}
      </td>
      <td>
        {highlight("url", change.latest?.url ?? change.baseline?.url ?? "")}
      </td>
      <td>{change.documentId}</td>
      <td>{change.changedFields.join(", ")}</td>
    </tr>
  );
}
