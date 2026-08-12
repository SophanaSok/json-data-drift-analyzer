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
import type { WorkerStep } from "../workers/protocol";

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

/**
 * The record's baseline-side body.
 *
 * Stored bodies exist only on removed records (and in results cached before bodies
 * were slimmed, which this reads first). For everything else the baseline is derived:
 * it IS the latest body when the record is unchanged, and otherwise it is the latest
 * body with every changed path set back to its baselineValue. deepDiff recurses into
 * a path only when both sides are plain objects, so every intermediate segment of a
 * dotted path exists as an object on the latest side.
 *
 * @returns a NEW object (or the stored/latest reference when nothing differs);
 *   undefined for added records, which have no baseline side
 */
export function baselineSnapshot(record: DiffRecord): Record<string, unknown> | undefined {
  if (record.baseline) return record.baseline;
  if (record.status === "added" || !record.latest) return undefined;
  if (record.status === "unchanged") return record.latest;

  const snapshot =
    typeof structuredClone === "function"
      ? structuredClone(record.latest)
      : (JSON.parse(JSON.stringify(record.latest)) as Record<string, unknown>);

  for (const change of record.changedFields) {
    if (change.path === "$record") continue;
    revertPath(snapshot, change.path.split("."), change.baselineValue);
  }
  return snapshot;
}

function revertPath(target: Record<string, unknown>, segments: string[], baselineValue: unknown): void {
  // split(".") never yields an empty array, and recursion only descends while rest
  // is non-empty, so a head segment always exists.
  const [head, ...rest] = segments as [string, ...string[]];
  if (rest.length === 0) {
    if (baselineValue === undefined) delete target[head];
    else target[head] = baselineValue;
    return;
  }
  const next = target[head];
  if (next === null || typeof next !== "object" || Array.isArray(next)) {
    // Defensive: deepDiff only nests through objects present on both sides, so this
    // should not occur; materializing the parent beats silently dropping the value.
    const created: Record<string, unknown> = {};
    target[head] = created;
    revertPath(created, rest, baselineValue);
    return;
  }
  revertPath(next as Record<string, unknown>, rest, baselineValue);
}

type KeyedRecord = {
  /** Map key: collision-proof identity key, or a unique synthetic id when unkeyable. */
  id: string;
  /** Human-readable identity, shown as the record's key in the UI and exports. */
  label: string;
  /** True when the identity fields could not produce a stable key for this record. */
  unkeyed: boolean;
  record: Record<string, unknown>;
};

/**
 * Key one side's records for matching.
 *
 * Records whose identity fields are missing, blank, or non-scalar cannot be
 * matched — they used to all collapse under the key "" (one survivor, the rest
 * silently dropped; a typo'd identity field collapsed the WHOLE analysis into one
 * record). Each now gets a unique synthetic id so it stays visible as its own
 * added/removed record, and the unkeyed count is surfaced as a quality issue.
 */
function keyRecords(
  records: Array<Record<string, unknown>>,
  identityFields: string[],
  side: "baseline" | "latest"
): KeyedRecord[] {
  return records.map((record, index) => {
    const { key, label } = buildRecordKey(record, identityFields);
    if (key !== null) {
      return { id: key, label, unkeyed: false, record };
    }
    return {
      id: `$unkeyed:${side}:${index}`,
      label: `(no identity — ${side} record #${index + 1})`,
      unkeyed: true,
      record
    };
  });
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
  onProgress?: (step: WorkerStep) => void;
}): AnalysisResult {
  const profile = input.profile ?? defaultProfile;
  const onProgress = input.onProgress ?? (() => {});
  // No "Parsing files" step here: this function receives already-parsed data. The
  // caller that actually parses reports that step, so a parse failure surfaces
  // under the right label instead of after it.
  onProgress("Reading export metadata");
  const baselineExportDates = extractExportDates(input.baselineData, input.config.collectionPath);
  const latestExportDates = extractExportDates(input.latestData, input.config.collectionPath);
  const dateOrderingIssues = findDateOrderingIssues(baselineExportDates, latestExportDates);
  onProgress("Detecting record collection");
  const baselineRecords = getCollection(input.baselineData, input.config.collectionPath).map((record) => normalizeRecord(record, input.config.ignoredFields));
  const latestRecords = getCollection(input.latestData, input.config.collectionPath).map((record) => normalizeRecord(record, input.config.ignoredFields));

  onProgress("Matching records");
  const baselineKeyed = keyRecords(baselineRecords, input.config.identityFields, "baseline");
  const latestKeyed = keyRecords(latestRecords, input.config.identityFields, "latest");
  const baselineByKey = new Map(baselineKeyed.map((keyed) => [keyed.id, keyed]));
  const latestByKey = new Map(latestKeyed.map((keyed) => [keyed.id, keyed]));
  const allKeys = new Set([...baselineByKey.keys(), ...latestByKey.keys()]);

  const recordsById: Record<string, DiffRecord> = {};

  // Fields and documents are compared in this single pass, so one honest label
  // covers both. A separate "Comparing documents" step would either fire once per
  // record or announce a phase that does not exist.
  onProgress("Comparing fields and documents");
  for (const key of allKeys) {
    const baselineKeyedRecord = baselineByKey.get(key);
    const latestKeyedRecord = latestByKey.get(key);
    const baseline = baselineKeyedRecord?.record;
    const latest = latestKeyedRecord?.record;
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
    for (const field of profile.documentFieldPairs) {
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
      // Display form of the identity; the id above is the collision-proof key.
      recordKey: (latestKeyedRecord ?? baselineKeyedRecord)?.label ?? key,
      status,
      // The baseline body is stored ONLY for removed records, which have no latest
      // side. For every other status it is derivable — identical to latest when
      // unchanged, reconstructable from latest + changedFields when changed (see
      // baselineSnapshot) — and embedding it doubled the record payload that gets
      // structured-cloned to the main thread and written to IndexedDB.
      baseline: status === "removed" ? baseline : undefined,
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

  onProgress("Profiling field health");
  const fieldStats = computeFieldStats(baselineRecords, latestRecords, profile, input.config.identityFields);
  const unkeyedRecordIds = [...baselineKeyed, ...latestKeyed].filter((keyed) => keyed.unkeyed).map((keyed) => keyed.id);
  const qualityIssues = buildQualityIssues(
    fieldStats,
    recordsById,
    profile,
    duplicateKeys,
    baselineRecords.length,
    latestRecords.length,
    input.config.identityFields,
    unkeyedRecordIds
  );

  for (const issue of qualityIssues) {
    for (const recordId of issue.relatedRecordIds) {
      if (recordsById[recordId]) {
        recordsById[recordId].qualityIssueIds.push(issue.id);
        if (issue.severity === "critical") recordsById[recordId].severity = "critical";
      }
    }
  }

  onProgress("Building fast indexes");
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
  const searchIndex = buildSearchIndex(recordsById, qualityIssues, profile);

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
