import { useCallback, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { percent } from "../../lib/format";
import {
  FIELD_CHANGES_TABLE_COLUMNS,
  formatGridTemplateColumns,
  getTotalColumnWidth
} from "./field-changes-column-widths";
import {
  describePopulationChange,
  formatPopulationChange,
  POPULATION_CHANGE_EXPLANATION,
  type FieldChangeRow,
  type FieldSortColumn,
  type SortDirection
} from "./field-changes-table";
import { useFieldChangesColumnResize } from "./use-field-changes-column-resize";

const CELL_CLASS = "min-w-0 break-words whitespace-normal p-2 align-top";
const POPULATION_CHANGE_TOOLTIP_ID = "population-change-tooltip";

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
      return formatPopulationChange(row.populationChange);
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
                <div className="flex min-w-0 items-start gap-1 pr-2">
                  <button
                    type="button"
                    className="inline-flex min-w-0 items-center gap-1 font-medium hover:text-sky-700"
                    aria-sort={sort.column === column.id ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                    data-testid={`sort-${column.id}`}
                    onClick={() => onSort(column.id)}
                  >
                    <span className="truncate">
                      {column.label}
                      {column.id === "change" ? " (pp)" : ""}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500" aria-hidden="true">
                      {sortIndicator(column.id)}
                    </span>
                  </button>
                  {column.id === "change" ? (
                    <span className="group relative inline-flex shrink-0">
                      <button
                        type="button"
                        aria-label="What does pp mean?"
                        aria-describedby={POPULATION_CHANGE_TOOLTIP_ID}
                        className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-400 text-[10px] font-semibold leading-none text-slate-600 hover:border-sky-600 hover:text-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1"
                      >
                        <span aria-hidden="true">?</span>
                      </button>
                      <span
                        id={POPULATION_CHANGE_TOOLTIP_ID}
                        role="tooltip"
                        className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-72 rounded-md bg-slate-900 px-3 py-2 text-left text-xs font-normal leading-5 text-white shadow-lg group-hover:block group-focus-within:block"
                      >
                        {POPULATION_CHANGE_EXPLANATION}
                      </span>
                    </span>
                  ) : null}
                </div>
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
                  const description = column.id === "change" ? describePopulationChange(row) : value;
                  return (
                    <div
                      key={column.id}
                      role="cell"
                      className={CELL_CLASS}
                      title={description}
                      aria-label={column.id === "change" ? description : undefined}
                    >
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
