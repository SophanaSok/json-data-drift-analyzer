import { isEmpty } from "./empty";
import { buildRecordKey } from "./identity";
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
  profile: QualityProfile,
  identityFields: string[]
): FieldStats[] {
  const fields = new Set<string>();
  for (const record of [...baselineRecords, ...latestRecords]) {
    Object.keys(record).forEach((key) => fields.add(key));
  }

  // Pair records by identity, exactly as the diff pass does. Array position is
  // meaningless in reordered exports (the common case), and regression counts
  // computed between unrelated records are noise — noise that fed the severity
  // gate. Aggregate fill rates still cover every record; only the per-record
  // regression pairing is restricted to records present on both sides.
  const latestByKey = new Map<string, Record<string, unknown>>();
  for (const record of latestRecords) {
    const { key } = buildRecordKey(record, identityFields);
    if (key !== null) latestByKey.set(key, record);
  }
  const matchedPairs: Array<[Record<string, unknown>, Record<string, unknown>]> = [];
  for (const record of baselineRecords) {
    const { key } = buildRecordKey(record, identityFields);
    const latest = key !== null ? latestByKey.get(key) : undefined;
    if (latest) matchedPairs.push([record, latest]);
  }

  const stats: FieldStats[] = [];
  for (const field of fields) {
    let baselinePresentCount = 0;
    let latestPresentCount = 0;
    let emptyRegressionCount = 0;
    const typeSummaryBaseline: Record<string, number> = {};
    const typeSummaryLatest: Record<string, number> = {};

    for (const record of baselineRecords) {
      const value = record[field];
      if (!isEmpty(value, profile.emptyRules[field])) baselinePresentCount += 1;
      if (value !== undefined) {
        const type = Array.isArray(value) ? "array" : typeof value;
        typeSummaryBaseline[type] = (typeSummaryBaseline[type] ?? 0) + 1;
      }
    }
    for (const record of latestRecords) {
      const value = record[field];
      if (!isEmpty(value, profile.emptyRules[field])) latestPresentCount += 1;
      if (value !== undefined) {
        const type = Array.isArray(value) ? "array" : typeof value;
        typeSummaryLatest[type] = (typeSummaryLatest[type] ?? 0) + 1;
      }
    }
    for (const [baselineRecord, latestRecord] of matchedPairs) {
      if (!isEmpty(baselineRecord[field], profile.emptyRules[field]) && isEmpty(latestRecord[field], profile.emptyRules[field])) {
        emptyRegressionCount += 1;
      }
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
  latestCount: number,
  identityFields: string[] = [],
  unkeyedRecordIds: string[] = []
): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // A wrong collection path yields zero records on both sides — which used to
  // read as a clean "Pass" over nothing. An empty comparison proves nothing and
  // must quarantine, loudly, with the likely cause named.
  if (baselineCount === 0 && latestCount === 0) {
    issues.push({
      id: "empty-collection",
      kind: "empty-collection",
      severity: "critical",
      title: "No records found in either file",
      description:
        "The collection path matched no records in either file. Check the collection path setting — a wrong path selects nothing and the comparison is meaningless.",
      relatedFields: [],
      relatedRecordIds: []
    });
  }

  if (unkeyedRecordIds.length > 0) {
    // Every record unkeyed means the identity configuration itself is broken (a
    // typo'd field name does exactly this) — quarantine rather than warn.
    const allUnkeyed = unkeyedRecordIds.length >= baselineCount + latestCount;
    issues.push({
      id: "unkeyed-records",
      kind: "unkeyed-records",
      severity: allUnkeyed ? "critical" : "warning",
      title: allUnkeyed ? "No record could be identity-keyed" : "Records missing identity values",
      description: allUnkeyed
        ? `None of the ${unkeyedRecordIds.length} records produced an identity key from [${identityFields.join(", ")}] — check the identity field names.`
        : `${unkeyedRecordIds.length} record(s) have missing or blank identity values and cannot be matched across runs; they are shown as added/removed.`,
      relatedFields: identityFields,
      relatedRecordIds: unkeyedRecordIds
    });
  }

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

  // One pass over the records instead of one full scan per regressed field:
  // on a wide systemic loss the per-field scans multiply into most of the
  // issue-construction time.
  const recordIdsByChangedField = new Map<string, string[]>();
  for (const record of Object.values(recordsById)) {
    for (const change of record.changedFields) {
      const ids = recordIdsByChangedField.get(change.path);
      if (!ids) {
        recordIdsByChangedField.set(change.path, [record.id]);
      } else if (ids[ids.length - 1] !== record.id) {
        // Consecutive check suffices: records are visited one at a time.
        ids.push(record.id);
      }
    }
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
      relatedRecordIds: recordIdsByChangedField.get(stat.field) ?? []
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
