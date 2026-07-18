import type {
  AnalysisMetadata,
  DateOrderingIssue,
  ExportDateField,
  ExportDateInspection,
  ExportDates,
  FileOrderAssessment
} from "./types";

export type {
  DateOrderingIssue,
  ExportDateField,
  ExportDateInspection,
  ExportDates,
  FileOrderAssessment
};

const EXPORT_DATE_FIELDS: ExportDateField[] = ["Refreshed", "Created"];
const DATE_FIELD_ALIASES: Record<ExportDateField, string[]> = {
  Refreshed: ["Refreshed", "RefreshedDate", "refreshed", "refreshedDate"],
  Created: ["Created", "CreatedDate", "created", "createdDate"]
};
const METADATA_KEYS = ["Metadata", "metadata", "ExportMetadata", "exportMetadata"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDateValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readDateField(record: Record<string, unknown>, field: ExportDateField): string | undefined {
  for (const key of DATE_FIELD_ALIASES[field]) {
    const value = normalizeDateValue(record[key]);
    if (value) return value;
  }
  return undefined;
}

function firstRecord(data: unknown, collectionPath: string): Record<string, unknown> | undefined {
  if (Array.isArray(data)) {
    return data.find(isRecord);
  }
  if (!isRecord(data)) return undefined;

  const collection = collectionPath === "$" ? data : data[collectionPath];
  if (!Array.isArray(collection)) return undefined;
  return collection.find(isRecord);
}

export function inspectExportDates(data: unknown, collectionPath = "Export"): ExportDateInspection {
  const inspection: ExportDateInspection = { dates: {}, sources: {} };
  if (!isRecord(data) && !Array.isArray(data)) return inspection;

  const root = isRecord(data) ? data : undefined;
  const metadata = root
    ? METADATA_KEYS.map((key) => root[key]).find(isRecord)
    : undefined;
  const record = firstRecord(data, collectionPath);

  for (const field of EXPORT_DATE_FIELDS) {
    const rootValue = root ? readDateField(root, field) : undefined;
    const metadataValue = metadata ? readDateField(metadata, field) : undefined;
    const recordValue = record ? readDateField(record, field) : undefined;

    if (rootValue) {
      inspection.dates[field] = rootValue;
      inspection.sources[field] = "root";
    } else if (metadataValue) {
      inspection.dates[field] = metadataValue;
      inspection.sources[field] = "metadata";
    } else if (recordValue) {
      inspection.dates[field] = recordValue;
      inspection.sources[field] = "first-record";
    }
  }

  return inspection;
}

export function extractExportDates(data: unknown, collectionPath = "Export"): ExportDates {
  return inspectExportDates(data, collectionPath).dates;
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

export function hasDateOrderingIssue(issues: DateOrderingIssue[]): boolean {
  return issues.length > 0;
}

export function assessFileOrder(
  baselineData: unknown,
  latestData: unknown,
  baselineFileName: string,
  latestFileName: string,
  collectionPath = "Export"
): FileOrderAssessment {
  const baseline = inspectExportDates(baselineData, collectionPath);
  const latest = inspectExportDates(latestData, collectionPath);
  const issues = findDateOrderingIssues(baseline.dates, latest.dates);
  const comparableFields = EXPORT_DATE_FIELDS.filter((field) => {
    const baselineValue = baseline.dates[field];
    const latestValue = latest.dates[field];
    return Boolean(
      baselineValue &&
      latestValue &&
      parseExportDate(baselineValue) !== null &&
      parseExportDate(latestValue) !== null
    );
  });

  return {
    baselineFileName,
    latestFileName,
    baseline,
    latest,
    issues,
    comparableFields,
    status: issues.length > 0 ? "reversed" : comparableFields.length > 0 ? "correct" : "unverified"
  };
}

export function getAnalysisDateOrderingIssues(metadata: AnalysisMetadata): DateOrderingIssue[] {
  if (metadata.dateOrderingIssues) {
    return metadata.dateOrderingIssues;
  }

  return findDateOrderingIssues(metadata.baselineExportDates ?? {}, metadata.latestExportDates ?? {});
}

export const BASELINE_DATE_NEWER_TOAST_MESSAGE =
  "The selected baseline appears newer than the latest file. Review the persistent file-order warning.";
