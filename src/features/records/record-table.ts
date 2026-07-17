import type { DiffRecord, Severity } from "../../engine/types";

export type RecordSortColumn =
  | "status"
  | "recordKey"
  | "title"
  | "changedFields"
  | "documentChanges"
  | "severity"
  | "publishedDate"
  | "dueDate";

export type SortDirection = "asc" | "desc";

const SEVERITY_RANK: Record<Severity, number> = {
  pass: 0,
  info: 1,
  warning: 2,
  high: 3,
  critical: 4
};

export function getRecordFieldValue(record: DiffRecord, field: string): string {
  const snapshot = record.latest ?? record.baseline;
  const value = snapshot?.[field];
  if (value === undefined || value === null) return "";
  return String(value);
}

export function formatDocumentSummary(record: DiffRecord): string {
  const docSummary = record.documentDiffs.BidDocuments;
  if (!docSummary) return "-";
  return `${docSummary.addedCount} added · ${docSummary.removedCount} removed · ${docSummary.modifiedCount} modified`;
}

function getDocumentChangeCount(record: DiffRecord): number {
  const docSummary = record.documentDiffs.BidDocuments;
  if (!docSummary) return -1;
  return docSummary.addedCount + docSummary.removedCount + docSummary.modifiedCount;
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function compareDates(a: string, b: string, direction: SortDirection): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const result = a.localeCompare(b);
  return direction === "asc" ? result : -result;
}

function compareNumbers(a: number, b: number): number {
  return a - b;
}

export function compareRecordIds(
  aId: string,
  bId: string,
  recordsById: Record<string, DiffRecord>,
  column: RecordSortColumn,
  direction: SortDirection
): number {
  const a = recordsById[aId];
  const b = recordsById[bId];
  if (!a || !b) return 0;

  let result = 0;
  switch (column) {
    case "status":
      result = compareStrings(a.status, b.status);
      break;
    case "recordKey":
      result = compareStrings(a.recordKey, b.recordKey);
      break;
    case "title":
      result = compareStrings(getRecordFieldValue(a, "Title"), getRecordFieldValue(b, "Title"));
      break;
    case "changedFields":
      result = compareNumbers(a.changedFieldCount, b.changedFieldCount);
      break;
    case "documentChanges":
      result = compareNumbers(getDocumentChangeCount(a), getDocumentChangeCount(b));
      break;
    case "severity":
      result = compareNumbers(SEVERITY_RANK[a.severity], SEVERITY_RANK[b.severity]);
      break;
    case "publishedDate": {
      const dateCompare = compareDates(
        getRecordFieldValue(a, "PublishedDate"),
        getRecordFieldValue(b, "PublishedDate"),
        direction
      );
      if (dateCompare !== 0) return dateCompare;
      return compareStrings(a.recordKey, b.recordKey);
    }
    case "dueDate": {
      const dateCompare = compareDates(getRecordFieldValue(a, "DueDate"), getRecordFieldValue(b, "DueDate"), direction);
      if (dateCompare !== 0) return dateCompare;
      return compareStrings(a.recordKey, b.recordKey);
    }
  }

  if (result === 0) {
    result = compareStrings(a.recordKey, b.recordKey);
  }

  return direction === "asc" ? result : -result;
}

export function sortRecordIds(
  ids: string[],
  recordsById: Record<string, DiffRecord>,
  column: RecordSortColumn,
  direction: SortDirection
): string[] {
  return [...ids].sort((a, b) => compareRecordIds(a, b, recordsById, column, direction));
}
