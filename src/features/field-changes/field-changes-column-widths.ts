import type { FieldSortColumn } from "./field-changes-table";

export const FIELD_CHANGES_TABLE_COLUMNS: Array<{ id: FieldSortColumn; label: string }> = [
  { id: "field", label: "Field" },
  { id: "changedRecords", label: "Changed records" },
  { id: "emptied", label: "Emptied" },
  { id: "restored", label: "Restored" },
  { id: "modified", label: "Modified" },
  { id: "baseline", label: "Baseline" },
  { id: "latest", label: "Latest" },
  { id: "change", label: "Change" },
  { id: "severity", label: "Severity" }
];

export const DEFAULT_FIELD_CHANGES_COLUMN_WIDTHS: Record<FieldSortColumn, number> = {
  field: 180,
  changedRecords: 120,
  emptied: 80,
  restored: 80,
  modified: 80,
  baseline: 90,
  latest: 90,
  change: 90,
  severity: 90
};

export const MIN_FIELD_CHANGES_COLUMN_WIDTH = 56;
export const FIELD_CHANGES_COLUMN_WIDTHS_STORAGE_KEY = "field-changes-table-column-widths";

export function clampColumnWidth(width: number): number {
  return Math.max(MIN_FIELD_CHANGES_COLUMN_WIDTH, Math.round(width));
}

export function getTotalColumnWidth(widths: Record<FieldSortColumn, number>): number {
  return FIELD_CHANGES_TABLE_COLUMNS.reduce((total, column) => total + widths[column.id], 0);
}

export function formatGridTemplateColumns(widths: Record<FieldSortColumn, number>): string {
  return FIELD_CHANGES_TABLE_COLUMNS.map((column) => `${widths[column.id]}px`).join(" ");
}

export function loadFieldChangesColumnWidths(): Record<FieldSortColumn, number> {
  if (typeof window === "undefined") {
    return { ...DEFAULT_FIELD_CHANGES_COLUMN_WIDTHS };
  }

  try {
    const raw = window.localStorage.getItem(FIELD_CHANGES_COLUMN_WIDTHS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FIELD_CHANGES_COLUMN_WIDTHS };

    const parsed = JSON.parse(raw) as Partial<Record<FieldSortColumn, number>>;
    const widths = { ...DEFAULT_FIELD_CHANGES_COLUMN_WIDTHS };
    for (const column of FIELD_CHANGES_TABLE_COLUMNS) {
      const value = parsed[column.id];
      if (typeof value === "number" && Number.isFinite(value)) {
        widths[column.id] = clampColumnWidth(value);
      }
    }
    return widths;
  } catch {
    return { ...DEFAULT_FIELD_CHANGES_COLUMN_WIDTHS };
  }
}

export function saveFieldChangesColumnWidths(widths: Record<FieldSortColumn, number>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FIELD_CHANGES_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
}
