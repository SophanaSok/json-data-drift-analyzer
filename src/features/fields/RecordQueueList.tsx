import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { QueueRow } from "./use-record-queue";

type RecordQueueListProps = {
  rows: QueueRow[];
  selectedRecordKey: string | null;
  onSelectRecord: (recordKey: string) => void;
};

const STATUS_BADGE: Record<string, string> = {
  added: "bg-emerald-100 text-emerald-900",
  removed: "bg-red-50 text-red-900"
};

/** The record queue: key, pending count or resolved tick, filterable to pending. */
export function RecordQueueList({ rows, selectedRecordKey, onSelectRecord }: RecordQueueListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);

  const visible = onlyPending ? rows.filter((row) => row.pendingCount > 0) : rows;
  const selectedIndex = visible.findIndex((row) => row.recordKey === selectedRecordKey);

  const rowVirtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: 8
  });

  // Keep the selection in view: after a few `n` presses the highlighted row is
  // otherwise off-screen and orientation is lost.
  useEffect(() => {
    if (selectedIndex >= 0) rowVirtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, rowVirtualizer]);

  return (
    <div className="flex max-h-[640px] flex-col rounded border bg-white" data-testid="record-queue">
      <label className="flex items-center gap-2 border-b border-slate-200 p-2 text-xs">
        <input
          type="checkbox"
          checked={onlyPending}
          data-testid="queue-only-pending"
          onChange={(event) => setOnlyPending(event.target.checked)}
        />
        Only records with pending decisions ({rows.filter((row) => row.pendingCount > 0).length})
      </label>
      <div ref={scrollRef} className="overflow-auto">
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const row = visible[virtualItem.index]!;
            const isSelected = row.recordKey === selectedRecordKey;
            return (
              <div
                key={row.recordId}
                ref={rowVirtualizer.measureElement}
                data-index={virtualItem.index}
                data-testid={`queue-record-${row.recordKey}`}
                data-selected={isSelected ? "true" : "false"}
                role="button"
                tabIndex={0}
                aria-current={isSelected ? "true" : undefined}
                className={`absolute left-0 top-0 flex w-full cursor-pointer items-center gap-2 border-b border-slate-100 p-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 ${
                  isSelected ? "bg-sky-100 ring-1 ring-inset ring-sky-300" : "hover:bg-sky-50"
                }`}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
                onClick={() => onSelectRecord(row.recordKey)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectRecord(row.recordKey);
                  }
                }}
              >
                <span className="min-w-0 flex-1 truncate font-medium" title={row.recordKey}>
                  {row.recordKey}
                </span>
                {STATUS_BADGE[row.status] ? (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_BADGE[row.status]}`}>
                    {row.status === "added" ? "only candidate" : "only reference"}
                  </span>
                ) : null}
                {row.resolved ? (
                  <span className="text-emerald-700" title="All review cells decided" data-testid="queue-resolved">
                    ✓
                  </span>
                ) : row.pendingCount > 0 ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">{row.pendingCount}</span>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
