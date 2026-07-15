import type { AnalysisIndexes, AnalysisResult, ChangeKind, DiffRecord, RecordStatus, Severity } from "./types";

function createSetMap<T extends string>(keys: readonly T[]): Record<T, Set<string>> {
  return Object.fromEntries(keys.map((key) => [key, new Set<string>()])) as Record<T, Set<string>>;
}

export function buildIndexes(recordsById: Record<string, DiffRecord>): AnalysisIndexes {
  const byStatus = createSetMap<RecordStatus>(["added", "removed", "changed", "unchanged"] as const);
  const byChangeKind = createSetMap<ChangeKind>(["added", "removed", "modified", "emptied", "restored"] as const);
  const bySeverity = createSetMap<Severity>(["pass", "info", "warning", "high", "critical"] as const);
  const byDocumentState = createSetMap(["added", "removed", "modified", "incomplete", "hashMismatch", "decreasedCount"] as const);
  const byField: Record<string, Set<string>> = {};
  const byQualityIssue: Record<string, Set<string>> = {};

  for (const record of Object.values(recordsById)) {
    byStatus[record.status].add(record.id);
    bySeverity[record.severity].add(record.id);

    for (const change of record.changedFields) {
      byChangeKind[change.kind].add(record.id);
      if (!byField[change.path]) {
        byField[change.path] = new Set<string>();
      }
      byField[change.path].add(record.id);
    }

    for (const [docName, summary] of Object.entries(record.documentDiffs)) {
      if (summary.addedCount > 0) byDocumentState.added.add(record.id);
      if (summary.removedCount > 0) byDocumentState.removed.add(record.id);
      if (summary.modifiedCount > 0) byDocumentState.modified.add(record.id);
      if (summary.incompleteCount > 0) byDocumentState.incomplete.add(record.id);
      if (summary.latestCount < summary.baselineCount) byDocumentState.decreasedCount.add(record.id);
      if (docName.includes("mismatch") || summary.changes.some((change) => change.kind === "incomplete")) {
        byDocumentState.hashMismatch.add(record.id);
      }
    }

    for (const issueId of record.qualityIssueIds) {
      if (!byQualityIssue[issueId]) {
        byQualityIssue[issueId] = new Set<string>();
      }
      byQualityIssue[issueId].add(record.id);
    }
  }

  return { byStatus, byField, byChangeKind, bySeverity, byQualityIssue, byDocumentState };
}

export function buildSorts(recordsById: Record<string, DiffRecord>) {
  const all = Object.values(recordsById);
  return {
    byRecordKey: [...all].sort((a, b) => a.recordKey.localeCompare(b.recordKey)).map((record) => record.id),
    bySeverity: [...all]
      .sort((a, b) => {
        const rank = { critical: 4, high: 3, warning: 2, info: 1, pass: 0 } as const;
        return rank[b.severity] - rank[a.severity] || b.changedFieldCount - a.changedFieldCount;
      })
      .map((record) => record.id),
    byChangedFieldCount: [...all].sort((a, b) => b.changedFieldCount - a.changedFieldCount).map((record) => record.id)
  };
}

export function mergeQualityIssueIndexes(result: AnalysisResult): void {
  for (const issue of result.qualityIssues) {
    if (!result.indexes.byQualityIssue[issue.id]) {
      result.indexes.byQualityIssue[issue.id] = new Set<string>();
    }
    for (const recordId of issue.relatedRecordIds) {
      if (result.recordsById[recordId]) {
        result.indexes.byQualityIssue[issue.id].add(recordId);
      }
    }
  }
}
