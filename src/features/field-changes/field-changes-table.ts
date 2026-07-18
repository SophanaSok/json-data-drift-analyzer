import type { Severity } from "../../engine/types";

export type FieldSortColumn =
  | "field"
  | "changedRecords"
  | "emptied"
  | "restored"
  | "modified"
  | "baseline"
  | "latest"
  | "change"
  | "severity";

export type SortDirection = "asc" | "desc";

export const POPULATION_CHANGE_EXPLANATION =
  "Percentage-point change in field fill rate, calculated as Latest − Baseline. Example: 95% → 30% = −65pp.";

export type FieldChangeRow = {
  field: string;
  changedRecords: number;
  emptied: number;
  restored: number;
  modified: number;
  baselinePresentRate: number;
  latestPresentRate: number;
  populationChange: number;
  severity: Severity;
};

export function formatPopulationChange(value: number): string {
  return `${(value * 100).toFixed(1)}pp`;
}

export function describePopulationChange(row: FieldChangeRow): string {
  const baseline = `${(row.baselinePresentRate * 100).toFixed(1)}%`;
  const latest = `${(row.latestPresentRate * 100).toFixed(1)}%`;
  const change = `${(row.populationChange * 100).toFixed(1)} percentage points`;
  return `Field fill rate: ${baseline} → ${latest} (${change})`;
}

const SEVERITY_RANK: Record<Severity, number> = {
  pass: 0,
  info: 1,
  warning: 2,
  high: 3,
  critical: 4
};

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function compareNumbers(a: number, b: number): number {
  return a - b;
}

export function compareFieldChangeRows(
  a: FieldChangeRow,
  b: FieldChangeRow,
  column: FieldSortColumn,
  direction: SortDirection
): number {
  let result = 0;
  switch (column) {
    case "field":
      result = compareStrings(a.field, b.field);
      break;
    case "changedRecords":
      result = compareNumbers(a.changedRecords, b.changedRecords);
      break;
    case "emptied":
      result = compareNumbers(a.emptied, b.emptied);
      break;
    case "restored":
      result = compareNumbers(a.restored, b.restored);
      break;
    case "modified":
      result = compareNumbers(a.modified, b.modified);
      break;
    case "baseline":
      result = compareNumbers(a.baselinePresentRate, b.baselinePresentRate);
      break;
    case "latest":
      result = compareNumbers(a.latestPresentRate, b.latestPresentRate);
      break;
    case "change":
      result = compareNumbers(a.populationChange, b.populationChange);
      break;
    case "severity":
      result = compareNumbers(SEVERITY_RANK[a.severity], SEVERITY_RANK[b.severity]);
      break;
  }

  if (result === 0) {
    result = compareStrings(a.field, b.field);
  }

  return direction === "asc" ? result : -result;
}

export function sortFieldChangeRows(
  rows: FieldChangeRow[],
  column: FieldSortColumn,
  direction: SortDirection
): FieldChangeRow[] {
  return [...rows].sort((a, b) => compareFieldChangeRows(a, b, column, direction));
}
