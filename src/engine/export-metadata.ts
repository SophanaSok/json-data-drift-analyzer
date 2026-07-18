import type { DateOrderingIssue, ExportDateField, ExportDates } from "./types";

export type { DateOrderingIssue, ExportDateField, ExportDates };

const EXPORT_DATE_FIELDS: ExportDateField[] = ["Refreshed", "Created"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchExportDateField(key: string): ExportDateField | undefined {
  const normalized = key.trim().toLowerCase();
  if (normalized === "refreshed") return "Refreshed";
  if (normalized === "created") return "Created";
  return undefined;
}

function parseDotNetDate(value: string): number | null {
  const match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]);
}

function coerceDateValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const dotNetTimestamp = parseDotNetDate(trimmed);
  if (dotNetTimestamp !== null) {
    return new Date(dotNetTimestamp).toISOString();
  }

  return trimmed;
}

function collectDatesFromRecord(record: Record<string, unknown>): ExportDates {
  const dates: ExportDates = {};
  for (const [key, value] of Object.entries(record)) {
    const field = matchExportDateField(key);
    if (!field) continue;
    const normalized = coerceDateValue(value);
    if (normalized) dates[field] = normalized;
  }
  return dates;
}

export function extractExportDates(data: unknown): ExportDates {
  if (!isRecord(data)) return {};

  const dates = collectDatesFromRecord(data);
  if (dates.Refreshed && dates.Created) return dates;

  for (const value of Object.values(data)) {
    if (!isRecord(value)) continue;
    const nested = collectDatesFromRecord(value);
    for (const field of EXPORT_DATE_FIELDS) {
      if (!dates[field] && nested[field]) dates[field] = nested[field];
    }
  }

  return dates;
}

export function parseExportDate(value: string): number | null {
  const dotNetTimestamp = parseDotNetDate(value);
  if (dotNetTimestamp !== null) return dotNetTimestamp;

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

    if (baselineTimestamp < latestTimestamp) {
      issues.push({ field, baseline: baselineValue, latest: latestValue });
    }
  }

  return issues;
}

export function formatExportDates(dates: ExportDates): string {
  const parts = EXPORT_DATE_FIELDS.flatMap((field) => (dates[field] ? [`${field}: ${dates[field]}`] : []));
  return parts.length > 0 ? parts.join(" · ") : "No export dates found";
}
