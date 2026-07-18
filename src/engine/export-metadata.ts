import type { DateOrderingIssue, ExportDateField, ExportDates } from "./types";

export type { DateOrderingIssue, ExportDateField, ExportDates };

const EXPORT_DATE_FIELDS: ExportDateField[] = ["Refreshed", "Created"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDateValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function extractExportDates(data: unknown): ExportDates {
  if (!isRecord(data)) return {};

  const dates: ExportDates = {};
  for (const field of EXPORT_DATE_FIELDS) {
    const value = normalizeDateValue(data[field]);
    if (value) dates[field] = value;
  }
  return dates;
}

export function parseExportDate(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function findDateOrderingIssues(baseline: ExportDates, latest: ExportDates): DateOrderingIssue[] {
  const issues: DateOrderingIssue[] = [];

  for (const field of EXPORT_DATE_FIELDS) {
    const baselineValue = baseline[field];
    const latestValue = latest[field];
    if (!baselineValue || !latestValue) continue;

    const baselineTimestamp = parseExportDate(baselineValue);
    const latestTimestamp = parseExportDate(latestValue);
    if (baselineTimestamp === null || latestTimestamp === null) continue;

    if (baselineTimestamp >= latestTimestamp) {
      issues.push({ field, baseline: baselineValue, latest: latestValue });
    }
  }

  return issues;
}

export function formatExportDates(dates: ExportDates): string {
  const parts = EXPORT_DATE_FIELDS.flatMap((field) => (dates[field] ? [`${field}: ${dates[field]}`] : []));
  return parts.length > 0 ? parts.join(" · ") : "No export dates found";
}
