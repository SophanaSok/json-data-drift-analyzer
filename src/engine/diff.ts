import { extractExportDates, findDateOrderingIssues } from "./export-metadata";
import { buildRecordKey, collectDuplicateKeys } from "./identity";
import { buildIndexes, buildSorts, mergeQualityIssueIndexes } from "./indexes";
import { compareDocuments } from "./documents";
import { isEmpty } from "./empty";
import { getCollection, normalizeRecord } from "./normalize";
import { buildNarrative } from "./narrative";
import { defaultProfile } from "./profile";
import { buildQualityIssues, computeFieldStats } from "./quality";
import { buildSearchIndex } from "./search";
import type { AnalysisResult, ChangeKind, ComparisonConfig, DiffRecord, FieldChange, QualityProfile, RecordStatus, Severity } from "./types";

const DOCUMENT_FIELDS: Array<{ docs: string; hashes: string }> = [
  { docs: "BidDocuments", hashes: "BidDocumentHashes" },
  { docs: "AddendumDocuments", hashes: "AddendumDocumentHashes" },
  { docs: "BidTabulations", hashes: "BidTabulationHashes" },
  { docs: "AwardDocuments", hashes: "AwardDocumentHashes" }
];

function classifyChangeKind(path: string, baseline: unknown, latest: unknown, profile: QualityProfile): ChangeKind {
  if (baseline === undefined && latest !== undefined) return "added";
  if (baseline !== undefined && latest === undefined) return "removed";
  const baselineEmpty = isEmpty(baseline, profile.emptyRules[path]);
  const latestEmpty = isEmpty(latest, profile.emptyRules[path]);
  if (!baselineEmpty && latestEmpty) return "emptied";
  if (baselineEmpty && !latestEmpty) return "restored";
  return "modified";
}

function primitive(value: unknown): boolean {
  return value === null || ["string", "number", "boolean", "undefined"].includes(typeof value);
}

function deepDiff(
  baseline: Record<string, unknown>,
  latest: Record<string, unknown>,
  profile: QualityProfile,
  prefix = ""
): FieldChange[] {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(latest)]);
  const changes: FieldChange[] = [];

  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const baselineValue = baseline[key];
    const latestValue = latest[key];

    if (JSON.stringify(baselineValue) === JSON.stringify(latestValue)) continue;

    if (
      primitive(baselineValue) ||
      primitive(latestValue) ||
      Array.isArray(baselineValue) ||
      Array.isArray(latestValue) ||
      typeof baselineValue !== "object" ||
      typeof latestValue !== "object" ||
      baselineValue === null ||
      latestValue === null
    ) {
      changes.push({ path, kind: classifyChangeKind(path, baselineValue, latestValue, profile), baselineValue, latestValue });
      continue;
    }

    changes.push(...deepDiff(baselineValue as Record<string, unknown>, latestValue as Record<string, unknown>, profile, path));
  }

  return changes;
}

function recordSeverity(changes: FieldChange[], requiredFields: string[]): Severity {
  if (changes.some((change) => requiredFields.includes(change.path) && ["emptied", "removed"].includes(change.kind))) return "critical";
  if (changes.some((change) => change.kind === "emptied")) return "high";
  if (changes.length > 0) return "warning";
  return "pass";
}

export function runAnalysis(input: {
  baselineData: unknown;
  latestData: unknown;
  config: ComparisonConfig;
  baselineFileName: string;
  latestFileName: string;
  analysisKey: string;
  profile?: QualityProfile;
}): AnalysisResult {
  const profile = input.profile ?? defaultProfile;
  const baselineExportDates = extractExportDates(input.baselineData, input.config.collectionPath);
  const latestExportDates = extractExportDates(input.latestData, input.config.collectionPath);
  const dateOrderingIssues = findDateOrderingIssues(baselineExportDates, latestExportDates);
  const baselineRecords = getCollection(input.baselineData, input.config.collectionPath).map((record) => normalizeRecord(record, input.config.ignoredFields));
  const latestRecords = getCollection(input.latestData, input.config.collectionPath).map((record) => normalizeRecord(record, input.config.ignoredFields));

  const baselineByKey = new Map(baselineRecords.map((record) => [buildRecordKey(record, input.config.identityFields), record]));
  const latestByKey = new Map(latestRecords.map((record) => [buildRecordKey(record, input.config.identityFields), record]));
  const allKeys = new Set([...baselineByKey.keys(), ...latestByKey.keys()]);

  const recordsById: Record<string, DiffRecord> = {};

  for (const key of allKeys) {
    const baseline = baselineByKey.get(key);
    const latest = latestByKey.get(key);
    let status: RecordStatus = "unchanged";
    const changedFields: FieldChange[] = [];

    if (!baseline && latest) {
      status = "added";
      changedFields.push({ path: "$record", kind: "added", baselineValue: undefined, latestValue: latest });
    } else if (baseline && !latest) {
      status = "removed";
      changedFields.push({ path: "$record", kind: "removed", baselineValue: baseline, latestValue: undefined });
    } else if (baseline && latest) {
      changedFields.push(...deepDiff(baseline, latest, profile));
      if (changedFields.length > 0) {
        status = "changed";
      }
    }

    const documentDiffs: DiffRecord["documentDiffs"] = {};
    const base = baseline ?? {};
    const current = latest ?? {};
    for (const field of DOCUMENT_FIELDS) {
      const compared = compareDocuments(base[field.docs], current[field.docs], base[field.hashes], current[field.hashes]);
      documentDiffs[field.docs] = compared.summary;
      if (compared.health.danglingHashListValues.length > 0 || compared.health.missingInHashList.length > 0 || compared.health.duplicateHashes.length > 0) {
        documentDiffs[`${field.docs}-mismatch`] = {
          baselineCount: 0,
          latestCount: 0,
          addedCount: 0,
          removedCount: 0,
          modifiedCount: 0,
          incompleteCount: compared.health.missingHashCount,
          unchangedCount: 0,
          changes: []
        };
      }
    }

    recordsById[key] = {
      id: key,
      recordKey: key,
      status,
      baseline,
      latest,
      changedFields,
      changedFieldCount: changedFields.length,
      documentDiffs,
      severity: recordSeverity(changedFields, profile.requiredFields),
      qualityIssueIds: []
    };
  }

  const duplicateBaseline = collectDuplicateKeys(baselineRecords, input.config.identityFields).duplicates;
  const duplicateLatest = collectDuplicateKeys(latestRecords, input.config.identityFields).duplicates;
  const duplicateKeys = [...new Set([...duplicateBaseline, ...duplicateLatest])];

  const fieldStats = computeFieldStats(baselineRecords, latestRecords, profile);
  const qualityIssues = buildQualityIssues(fieldStats, recordsById, profile, duplicateKeys, baselineRecords.length, latestRecords.length);

  for (const issue of qualityIssues) {
    for (const recordId of issue.relatedRecordIds) {
      if (recordsById[recordId]) {
        recordsById[recordId].qualityIssueIds.push(issue.id);
        if (issue.severity === "critical") recordsById[recordId].severity = "critical";
      }
    }
  }

  const indexes = buildIndexes(recordsById);
  const sorts = buildSorts(recordsById);
  const allRecordIds = sorts.byRecordKey;

  const criticalCount = qualityIssues.filter((issue) => issue.severity === "critical").length;
  const warningCount = qualityIssues.filter((issue) => ["warning", "high"].includes(issue.severity)).length;

  const summary = {
    baselineRecordCount: baselineRecords.length,
    latestRecordCount: latestRecords.length,
    addedCount: Object.values(recordsById).filter((record) => record.status === "added").length,
    removedCount: Object.values(recordsById).filter((record) => record.status === "removed").length,
    changedCount: Object.values(recordsById).filter((record) => record.status === "changed").length,
    unchangedCount: Object.values(recordsById).filter((record) => record.status === "unchanged").length,
    qualityGate: criticalCount > 0 ? "Quarantined" : warningCount > 0 ? "Warning" : "Pass"
  } as const;

  const narrative = buildNarrative(qualityIssues, fieldStats);
  const searchIndex = buildSearchIndex(recordsById, qualityIssues);

  const result: AnalysisResult = {
    analysisKey: input.analysisKey,
    metadata: {
      baselineFileName: input.baselineFileName,
      latestFileName: input.latestFileName,
      collectionPath: input.config.collectionPath,
      identityFields: input.config.identityFields,
      ignoredFields: input.config.ignoredFields,
      generatedAt: new Date().toISOString(),
      baselineExportDates,
      latestExportDates,
      dateOrderingIssues
    },
    recordsById,
    allRecordIds,
    fieldStats,
    qualityIssues,
    summary,
    indexes,
    sorts,
    narrative,
    searchIndexJson: JSON.stringify(searchIndex.toJSON())
  };

  mergeQualityIssueIndexes(result);

  return result;
}
