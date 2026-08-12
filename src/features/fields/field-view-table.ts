import type { CellSituation, FieldCell, FieldSummary } from "../../engine/field-view";
import { formatCellValue } from "../../engine/field-view";

export type SituationFilter = "all" | "candidate_blank" | "conflict" | "reference_blank" | "unchanged" | "only_one_file";

export type FieldListSortColumn = "field" | "latestFill" | "change" | "review";
export type CellSortColumn = "recordKey" | "candidate" | "reference" | "situation";
export type SortDirection = "asc" | "desc";

export const SITUATION_LABEL: Record<CellSituation, string> = {
  unchanged: "unchanged",
  candidate_blank: "candidate blank",
  conflict: "conflict",
  reference_blank: "reference blank",
  record_added: "only in candidate",
  record_removed: "only in reference"
};

export function matchesSituation(cell: FieldCell, filter: SituationFilter): boolean {
  if (filter === "all") return true;
  if (filter === "only_one_file") return cell.situation === "record_added" || cell.situation === "record_removed";
  return cell.situation === filter;
}

export function filterCells(
  cells: FieldCell[],
  options: { situation: SituationFilter; valueGroup: string | null; search: string }
): FieldCell[] {
  const query = options.search.trim().toLowerCase();
  return cells.filter((cell) => {
    if (!matchesSituation(cell, options.situation)) return false;
    if (options.valueGroup !== null && formatCellValue(cell.referenceValue) !== options.valueGroup) return false;
    if (query.length > 0) {
      const haystack =
        `${cell.recordKey} ${formatCellValue(cell.candidateValue)} ${formatCellValue(cell.referenceValue)}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

const SITUATION_RANK: Record<CellSituation, number> = {
  conflict: 0,
  candidate_blank: 1,
  reference_blank: 2,
  record_added: 3,
  record_removed: 4,
  unchanged: 5
};

export function compareCells(a: FieldCell, b: FieldCell, column: CellSortColumn, direction: SortDirection): number {
  const sign = direction === "asc" ? 1 : -1;
  let result = 0;
  switch (column) {
    case "recordKey":
      result = a.recordKey.localeCompare(b.recordKey, undefined, { numeric: true, sensitivity: "base" });
      break;
    case "candidate":
      result = formatCellValue(a.candidateValue).localeCompare(formatCellValue(b.candidateValue));
      break;
    case "reference":
      result = formatCellValue(a.referenceValue).localeCompare(formatCellValue(b.referenceValue));
      break;
    case "situation":
      result = SITUATION_RANK[a.situation] - SITUATION_RANK[b.situation];
      break;
  }
  if (result === 0) {
    // Stable, deterministic ties, matching the record-table convention.
    result = a.recordKey.localeCompare(b.recordKey, undefined, { numeric: true, sensitivity: "base" });
  }
  return result * sign;
}

export function sortCells(cells: FieldCell[], column: CellSortColumn, direction: SortDirection): FieldCell[] {
  return [...cells].sort((a, b) => compareCells(a, b, column, direction));
}

export function compareSummaries(
  a: FieldSummary,
  b: FieldSummary,
  column: FieldListSortColumn,
  direction: SortDirection
): number {
  const sign = direction === "asc" ? 1 : -1;
  let result = 0;
  switch (column) {
    case "field":
      result = a.field.localeCompare(b.field);
      break;
    case "latestFill":
      result = a.latestFillRate - b.latestFillRate;
      break;
    case "change":
      result = a.populationChange - b.populationChange;
      break;
    case "review":
      result = a.cells.review - b.cells.review;
      break;
  }
  if (result === 0) result = a.field.localeCompare(b.field);
  return result * sign;
}

export function sortSummaries(
  summaries: FieldSummary[],
  column: FieldListSortColumn,
  direction: SortDirection
): FieldSummary[] {
  return [...summaries].sort((a, b) => compareSummaries(a, b, column, direction));
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(rate > 0 && rate < 0.005 ? 1 : 0)}%`;
}

/** "100% → 0%" — the field list's fill transition, as text, not just bars. */
export function formatFillTransition(summary: FieldSummary): string {
  return `${formatPercent(summary.baselineFillRate)} → ${formatPercent(summary.latestFillRate)}`;
}

const LONG_VALUE_THRESHOLD = 120;

export function isLongValue(value: unknown): boolean {
  return formatCellValue(value).length > LONG_VALUE_THRESHOLD;
}

export function shortValue(value: unknown): string {
  const text = formatCellValue(value);
  if (text.length <= LONG_VALUE_THRESHOLD) return text;
  return `${text.slice(0, LONG_VALUE_THRESHOLD)}…`;
}
