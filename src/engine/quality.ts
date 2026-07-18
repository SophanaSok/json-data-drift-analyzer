import { isEmpty } from "./empty";
import type { DiffRecord, FieldStats, QualityIssue, QualityProfile, Severity } from "./types";

function getSeverityFromPopulationDrop(drop: number, affected: number, baselineRate: number, latestRate: number): Severity {
  if (baselineRate >= 0.8 && latestRate <= 0.2 && affected >= 25) {
    return "critical";
  }
  if (drop >= 0.3 && affected >= 25) {
    return "high";
  }
  if (drop >= 0.1) {
    return "warning";
  }
  return "pass";
}

export function computeFieldStats(
  baselineRecords: Array<Record<string, unknown>>,
  latestRecords: Array<Record<string, unknown>>,
  profile: QualityProfile
): FieldStats[] {
  const fields = new Set<string>();
  for (const record of [...baselineRecords, ...latestRecords]) {
    Object.keys(record).forEach((key) => fields.add(key));
  }

  const stats: FieldStats[] = [];
  for (const field of fields) {
    let baselinePresentCount = 0;
    let latestPresentCount = 0;
    let emptyRegressionCount = 0;
    const typeSummaryBaseline: Record<string, number> = {};
    const typeSummaryLatest: Record<string, number> = {};

    const length = Math.max(baselineRecords.length, latestRecords.length);
    for (let index = 0; index < length; index += 1) {
      const baselineValue = baselineRecords[index]?.[field];
      const latestValue = latestRecords[index]?.[field];
      if (!isEmpty(baselineValue, profile.emptyRules[field])) baselinePresentCount += 1;
      if (!isEmpty(latestValue, profile.emptyRules[field])) latestPresentCount += 1;
      if (!isEmpty(baselineValue, profile.emptyRules[field]) && isEmpty(latestValue, profile.emptyRules[field])) {
        emptyRegressionCount += 1;
      }
      if (baselineValue !== undefined) typeSummaryBaseline[Array.isArray(baselineValue) ? "array" : typeof baselineValue] = (typeSummaryBaseline[Array.isArray(baselineValue) ? "array" : typeof baselineValue] ?? 0) + 1;
      if (latestValue !== undefined) typeSummaryLatest[Array.isArray(latestValue) ? "array" : typeof latestValue] = (typeSummaryLatest[Array.isArray(latestValue) ? "array" : typeof latestValue] ?? 0) + 1;
    }

    const baselinePresentRate = baselineRecords.length ? baselinePresentCount / baselineRecords.length : 0;
    const latestPresentRate = latestRecords.length ? latestPresentCount / latestRecords.length : 0;
    const populationChange = latestPresentRate - baselinePresentRate;
    let severity = getSeverityFromPopulationDrop(baselinePresentRate - latestPresentRate, emptyRegressionCount, baselinePresentRate, latestPresentRate);
    if (profile.requiredFields.includes(field) && latestPresentRate <= 0.05) {
      severity = "critical";
    }

    stats.push({
      field,
      baselinePresentCount,
      baselinePresentRate,
      latestPresentCount,
      latestPresentRate,
      populationChange,
      emptyRegressionCount,
      typeSummaryBaseline,
      typeSummaryLatest,
      severity
    });
  }

  return stats.sort((a, b) => a.field.localeCompare(b.field));
}

export function buildQualityIssues(
  fieldStats: FieldStats[],
  recordsById: Record<string, DiffRecord>,
  profile: QualityProfile,
  duplicateKeys: string[],
  baselineCount: number,
  latestCount: number
): QualityIssue[] {
  const issues: QualityIssue[] = [];

  if (latestCount < baselineCount) {
    issues.push({
      id: "record-count-reduction",
      kind: "record-count-reduction",
      severity: "warning",
      title: "Record count reduced",
      description: `Latest records dropped from ${baselineCount} to ${latestCount}`,
      relatedFields: [],
      relatedRecordIds: []
    });
  }

  if (duplicateKeys.length > 0) {
    issues.push({
      id: "duplicate-record-keys",
      kind: "duplicate-record-keys",
      severity: "critical",
      title: "Duplicate record identity keys",
      description: `Found ${duplicateKeys.length} duplicate record keys`,
      relatedFields: profile.identityDefault,
      relatedRecordIds: duplicateKeys
    });
  }

  for (const stat of fieldStats) {
    if (stat.severity === "pass") continue;
    issues.push({
      id: `field-population-${stat.field}`,
      kind: "field-population",
      severity: stat.severity,
      title: `${stat.field} population regression`,
      description: `${stat.field} fill rate changed from ${(stat.baselinePresentRate * 100).toFixed(1)}% to ${(stat.latestPresentRate * 100).toFixed(1)}% (${(stat.populationChange * 100).toFixed(1)}pp)`,
      relatedFields: [stat.field],
      relatedRecordIds: Object.values(recordsById)
        .filter((record) => record.changedFields.some((change) => change.path === stat.field))
        .map((record) => record.id)
    });
  }

  for (const group of profile.fieldGroups) {
    const severeDrops = fieldStats.filter((stat) => group.fields.includes(stat.field) && stat.baselinePresentRate - stat.latestPresentRate >= group.thresholdDrop);
    if (severeDrops.length >= group.minAffectedFields) {
      issues.push({
        id: `group-${group.id}`,
        kind: "field-group-incident",
        severity: group.severity,
        title: `${group.name} incident`,
        description: group.narrative,
        relatedFields: severeDrops.map((item) => item.field),
        relatedRecordIds: Object.keys(recordsById)
      });
    }
  }

  return issues;
}
