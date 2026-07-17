import type { RecordSortColumn } from "./record-table";

export const RECORD_TABLE_COLUMNS: Array<{ id: RecordSortColumn; label: string }> = [
  { id: "status", label: "Status" },
  { id: "recordKey", label: "Record Key" },
  { id: "title", label: "Title" },
  { id: "publishedDate", label: "Published Date" },
  { id: "dueDate", label: "Due Date" },
  { id: "changedFields", label: "Changed fields" },
  { id: "documentChanges", label: "Document changes" },
  { id: "severity", label: "Severity" }
];

export const DEFAULT_RECORD_COLUMN_WIDTHS: Record<RecordSortColumn, number> = {
  status: 80,
  recordKey: 120,
  title: 240,
  publishedDate: 110,
  dueDate: 110,
  changedFields: 90,
  documentChanges: 180,
  severity: 90
};

export const MIN_RECORD_COLUMN_WIDTH = 56;
export const RECORD_COLUMN_WIDTHS_STORAGE_KEY = "records-table-column-widths";

export function clampColumnWidth(width: number): number {
  return Math.max(MIN_RECORD_COLUMN_WIDTH, Math.round(width));
}

export function getTotalColumnWidth(widths: Record<RecordSortColumn, number>): number {
  return RECORD_TABLE_COLUMNS.reduce((total, column) => total + widths[column.id], 0);
}

export function loadRecordColumnWidths(): Record<RecordSortColumn, number> {
  if (typeof window === "undefined") {
    return { ...DEFAULT_RECORD_COLUMN_WIDTHS };
  }

  try {
    const raw = window.localStorage.getItem(RECORD_COLUMN_WIDTHS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RECORD_COLUMN_WIDTHS };

    const parsed = JSON.parse(raw) as Partial<Record<RecordSortColumn, number>>;
    const widths = { ...DEFAULT_RECORD_COLUMN_WIDTHS };
    for (const column of RECORD_TABLE_COLUMNS) {
      const value = parsed[column.id];
      if (typeof value === "number" && Number.isFinite(value)) {
        widths[column.id] = clampColumnWidth(value);
      }
    }
    return widths;
  } catch {
    return { ...DEFAULT_RECORD_COLUMN_WIDTHS };
  }
}

export function saveRecordColumnWidths(widths: Record<RecordSortColumn, number>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RECORD_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
}
