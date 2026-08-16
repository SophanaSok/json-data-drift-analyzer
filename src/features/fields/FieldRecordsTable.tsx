import { useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FieldCell } from "../../engine/field-view";
import { formatCellValue } from "../../engine/field-view";
import { SITUATION_LABEL, isLongValue, shortValue, type CellSortColumn, type SortDirection } from "./field-view-table";

const CELL_CLASS = "min-w-0 break-words whitespace-normal p-2 align-top";

type SortState = { column: CellSortColumn; direction: SortDirection };

type FieldRecordsTableProps = {
  cells: FieldCell[];
  sort: SortState;
  onSort: (column: CellSortColumn) => void;
  /** Rendered in the last column when provided (the decision controls). */
  renderDecision?: (cell: FieldCell) => ReactNode;
  /** Rendered under the reference value — advisory evidence about that value. */
  renderReferenceNote?: (cell: FieldCell) => ReactNode;
};

const COLUMNS: Array<{ id: CellSortColumn; label: string }> = [
  { id: "recordKey", label: "Record" },
  { id: "candidate", label: "Candidate" },
  { id: "reference", label: "Reference" },
  { id: "situation", label: "Situation" }
];

/**
 * One value, expandable when long. The expansion is a real disclosure: labelled
 * with the size, `aria-expanded`, and shown as pre-wrapped text — a 4KB
 * Description is unreadable truncated and worse in a tooltip.
 */
function ValueCell({ value, cellKey, expanded, onToggle }: { value: unknown; cellKey: string; expanded: boolean; onToggle: () => void }) {
  const full = formatCellValue(value);
  if (!isLongValue(value)) {
    return <>{full}</>;
  }
  return (
    <>
      {expanded ? <pre tabIndex={0} aria-label="Full value" className="max-h-64 overflow-auto whitespace-pre-wrap break-all bg-slate-50 p-1 text-xs">{full}</pre> : shortValue(value)}
      <button
        type="button"
        className="mt-0.5 block text-xs text-sky-700 underline"
        aria-expanded={expanded}
        data-testid={`expand-${cellKey}`}
        onClick={onToggle}
      >
        {expanded ? "Collapse" : `Show full value (${full.length.toLocaleString()} characters)`}
      </button>
    </>
  );
}

const SITUATION_BADGE: Record<FieldCell["situation"], string> = {
  unchanged: "bg-slate-100 text-slate-600",
  candidate_blank: "bg-red-50 text-red-900",
  conflict: "bg-amber-100 text-amber-900",
  reference_blank: "bg-slate-100 text-slate-600",
  record_added: "bg-emerald-100 text-emerald-900",
  record_removed: "bg-red-50 text-red-900"
};

export function FieldRecordsTable({ cells, sort, onSort, renderDecision, renderReferenceNote }: FieldRecordsTableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // One expansion at a time keeps remeasurement cheap and the page readable.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: cells.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    // Rows change height when a value expands or a decision form opens;
    // fixed-height virtualization is the overlap bug the audit recorded.
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: 6
  });

  const sortIndicator = (column: CellSortColumn) => {
    if (sort.column !== column) return "↕";
    return sort.direction === "asc" ? "↑" : "↓";
  };

  const gridTemplateColumns = renderDecision
    ? "9rem minmax(0,1fr) minmax(0,1fr) 8rem 14rem"
    : "9rem minmax(0,1fr) minmax(0,1fr) 8rem";

  const toggleExpansion = (key: string) => {
    setExpandedKey((current) => (current === key ? null : key));
    // Height changed; remeasure the visible window.
    requestAnimationFrame(() => rowVirtualizer.measure());
  };

  return (
    <div ref={scrollRef} className="max-h-[520px] overflow-auto rounded border bg-white" data-testid="field-cells">
      <div role="table" className="text-left text-sm" style={{ minWidth: "100%" }}>
        <div role="rowgroup" className="sticky top-0 z-10">
          <div role="row" className="grid border-b border-slate-200 bg-slate-100" style={{ gridTemplateColumns }}>
            {COLUMNS.map((column) => (
              <div
                key={column.id}
                role="columnheader"
                aria-sort={sort.column === column.id ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                className="min-w-0 bg-slate-100 p-2 align-top"
              >
                <button
                  type="button"
                  className="inline-flex max-w-full items-center gap-1 truncate font-medium hover:text-sky-700"
                  data-testid={`field-cells-sort-${column.id}`}
                  onClick={() => onSort(column.id)}
                >
                  <span className="truncate">{column.label}</span>
                  <span className="shrink-0 text-xs text-slate-500" aria-hidden="true">
                    {sortIndicator(column.id)}
                  </span>
                </button>
              </div>
            ))}
            {renderDecision ? (
              <div role="columnheader" className="min-w-0 bg-slate-100 p-2 align-top font-medium">
                Decision
              </div>
            ) : null}
          </div>
        </div>

        <div role="rowgroup" style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const cell = cells[virtualItem.index]!;
            return (
              <div
                key={cell.recordId}
                ref={rowVirtualizer.measureElement}
                role="row"
                data-index={virtualItem.index}
                data-testid={`field-cell-${cell.recordKey}`}
                className="absolute left-0 top-0 grid w-full border-b border-slate-100 bg-white"
                style={{ gridTemplateColumns, transform: `translateY(${virtualItem.start}px)` }}
              >
                <div role="cell" className={CELL_CLASS}>
                  <span className="font-medium">{cell.recordKey}</span>
                </div>
                <div role="cell" className={CELL_CLASS}>
                  <ValueCell
                    value={cell.candidateValue}
                    cellKey={`candidate-${cell.recordKey}`}
                    expanded={expandedKey === `candidate-${cell.recordKey}`}
                    onToggle={() => toggleExpansion(`candidate-${cell.recordKey}`)}
                  />
                </div>
                <div role="cell" className={CELL_CLASS}>
                  <ValueCell
                    value={cell.referenceValue}
                    cellKey={`reference-${cell.recordKey}`}
                    expanded={expandedKey === `reference-${cell.recordKey}`}
                    onToggle={() => toggleExpansion(`reference-${cell.recordKey}`)}
                  />
                  {renderReferenceNote?.(cell)}
                </div>
                <div role="cell" className={CELL_CLASS}>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${SITUATION_BADGE[cell.situation]}`}>
                    {SITUATION_LABEL[cell.situation]}
                  </span>
                </div>
                {renderDecision ? (
                  <div role="cell" className={CELL_CLASS}>
                    {renderDecision(cell)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
