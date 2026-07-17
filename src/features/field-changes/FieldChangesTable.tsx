import { useCallback, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { percent } from "../../lib/format";
import {
  FIELD_CHANGES_TABLE_COLUMNS,
  formatGridTemplateColumns,
  getTotalColumnWidth
} from "./field-changes-column-widths";
import type { FieldChangeRow, FieldSortColumn, SortDirection } from "./field-changes-table";
import { useFieldChangesColumnResize } from "./use-field-changes-column-resize";

const CELL_CLASS = "min-w-0 break-words whitespace-normal p-2 align-top";

type SortState = {
  column: FieldSortColumn;
  direction: SortDirection;
};

type FieldChangesTableProps = {
  rows: FieldChangeRow[];
  sort: SortState;
  onSort: (column: FieldSortColumn) => void;
  onSelectField: (field: string) => void;
};

function getFieldColumnValue(row: FieldChangeRow, column: FieldSortColumn): string {
  switch (column) {
    case "field":
      return row.field;
    case "changedRecords":
      return String(row.changedRecords);
    case "emptied":
      return String(row.emptied);
    case "restored":
      return String(row.restored);
    case "modified":
      return String(row.modified);
    case "baseline":
      return percent(row.baselinePresentRate);
    case "latest":
      return percent(row.latestPresentRate);
    case "change":
      return `${(row.populationChange * 100).toFixed(1)}pp`;
    case "severity":
      return row.severity;
  }
}

export function FieldChangesTable({ rows, sort, onSort, onSelectField }: FieldChangesTableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const remeasureRowsRef = useRef<(() => void) | null>(null);

  const handleColumnWidthsChange = useCallback(() => {
    remeasureRowsRef.current?.();
  }, []);

  const { columnWidths, beginResize } = useFieldChangesColumnResize(handleColumnWidthsChange);
  const gridTemplateColumns = useMemo(() => formatGridTemplateColumns(columnWidths), [columnWidths]);
  const tableWidth = useMemo(() => getTotalColumnWidth(columnWidths), [columnWidths]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    measureElement: (element) => element.getBoundingClientRect().height
  });

  useEffect(() => {
    remeasureRowsRef.current = () => rowVirtualizer.measure();
  }, [rowVirtualizer]);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [columnWidths, gridTemplateColumns, rowVirtualizer]);

  const sortIndicator = (column: FieldSortColumn) => {
    if (sort.column !== column) return "↕";
    return sort.direction === "asc" ? "↑" : "↓";
  };

  return (
    <div
      id="field-changes-scroll"
      ref={scrollRef}
      className="max-h-[520px] overflow-auto rounded border bg-white"
    >
      <div
        role="table"
        className="text-left text-sm"
        style={{ width: tableWidth, minWidth: "100%" }}
      >
        <div role="rowgroup" className="sticky top-0 z-10">
          <div
            role="row"
            className="grid border-b border-slate-200 bg-slate-100"
            style={{ gridTemplateColumns }}
          >
            {FIELD_CHANGES_TABLE_COLUMNS.map((column) => (
              <div
                key={column.id}
                role="columnheader"
                className="relative min-w-0 bg-slate-100 p-2 align-top"
              >
                <button
                  type="button"
                  className="inline-flex max-w-full items-center gap-1 truncate pr-2 font-medium hover:text-sky-700"
                  aria-sort={sort.column === column.id ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                  data-testid={`sort-${column.id}`}
                  onClick={() => onSort(column.id)}
                >
                  <span className="truncate">{column.label}</span>
                  <span className="shrink-0 text-xs text-slate-500" aria-hidden="true">
                    {sortIndicator(column.id)}
                  </span>
                </button>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${column.label} column`}
                  data-testid={`resize-${column.id}`}
                  className="absolute right-0 top-0 z-20 h-full w-2 cursor-col-resize touch-none select-none hover:bg-sky-300/60 active:bg-sky-400/70"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    beginResize(column.id, event.clientX);
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <div
          role="rowgroup"
          style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const row = rows[virtualItem.index];

            return (
              <div
                key={row.field}
                ref={rowVirtualizer.measureElement}
                role="row"
                data-index={virtualItem.index}
                data-testid={`field-change-row-${row.field}`}
                className="absolute left-0 top-0 grid w-full cursor-pointer border-b border-slate-100 bg-white hover:bg-sky-50"
                style={{
                  gridTemplateColumns,
                  transform: `translateY(${virtualItem.start}px)`
                }}
                onClick={() => onSelectField(row.field)}
              >
                {FIELD_CHANGES_TABLE_COLUMNS.map((column) => {
                  const value = getFieldColumnValue(row, column.id);
                  return (
                    <div key={column.id} role="cell" className={CELL_CLASS} title={value}>
                      {value}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
