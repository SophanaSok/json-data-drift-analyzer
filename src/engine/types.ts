export type RecordStatus = "added" | "removed" | "changed" | "unchanged";

export type ChangeKind = "added" | "removed" | "modified" | "emptied" | "restored";

export type Severity = "pass" | "info" | "warning" | "high" | "critical";

export type BidDocument = {
  title: string | null;
  url: string | null;
  hash: string | null;
};

export type DocumentChangeKind = "added" | "removed" | "modified" | "incomplete";

export type DocumentChange = {
  documentId: string;
  kind: DocumentChangeKind;
  baseline?: BidDocument;
  latest?: BidDocument;
  changedFields: Array<"title" | "url" | "hash">;
};

export type DocumentDiffSummary = {
  baselineCount: number;
  latestCount: number;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  incompleteCount: number;
  unchangedCount: number;
  changes: DocumentChange[];
};

export type FieldChange = {
  path: string;
  kind: ChangeKind;
  baselineValue: unknown;
  latestValue: unknown;
};

export type DiffRecord = {
  id: string;
  recordKey: string;
  status: RecordStatus;
  baseline?: Record<string, unknown>;
  latest?: Record<string, unknown>;
  changedFields: FieldChange[];
  changedFieldCount: number;
  documentDiffs: Record<string, DocumentDiffSummary>;
  severity: Severity;
  qualityIssueIds: string[];
};

export type FieldStats = {
  field: string;
  baselinePresentCount: number;
  baselinePresentRate: number;
  latestPresentCount: number;
  latestPresentRate: number;
  populationChange: number;
  emptyRegressionCount: number;
  typeSummaryBaseline: Record<string, number>;
  typeSummaryLatest: Record<string, number>;
  severity: Severity;
};

export type EmptyRule = {
  allowEmptyArray?: boolean;
  placeholders?: string[];
};

export type QualityProfile = {
  id: string;
  version: number;
  name: string;
  requiredFields: string[];
  optionalEmptyFields: string[];
  emptyRules: Record<string, EmptyRule>;
  identityDefault: string[];
  fieldGroups: Array<{ id: string; name: string; fields: string[]; thresholdDrop: number; minAffectedFields: number; severity: Severity; narrative: string }>;
};

export type ComparisonConfig = {
  collectionPath: string;
  identityFields: string[];
  ignoredFields: string[];
  profileId: string;
};

export type QualityIssue = {
  id: string;
  kind: string;
  severity: Severity;
  title: string;
  description: string;
  relatedFields: string[];
  relatedRecordIds: string[];
};

export type AnalysisIndexes = {
  byStatus: Record<RecordStatus, Set<string>>;
  byField: Record<string, Set<string>>;
  byChangeKind: Record<ChangeKind, Set<string>>;
  bySeverity: Record<Severity, Set<string>>;
  byQualityIssue: Record<string, Set<string>>;
  byDocumentState: Record<"added" | "removed" | "modified" | "incomplete" | "hashMismatch" | "decreasedCount", Set<string>>;
};

export type AnalysisSorts = {
  byRecordKey: string[];
  bySeverity: string[];
  byChangedFieldCount: string[];
};

export type AnalysisSummary = {
  baselineRecordCount: number;
  latestRecordCount: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
  qualityGate: "Pass" | "Warning" | "Failed" | "Quarantined";
};

export type AnalysisMetadata = {
  baselineFileName: string;
  latestFileName: string;
  collectionPath: string;
  identityFields: string[];
  ignoredFields: string[];
  generatedAt: string;
};

export type AnalysisResult = {
  analysisKey: string;
  metadata: AnalysisMetadata;
  recordsById: Record<string, DiffRecord>;
  allRecordIds: string[];
  fieldStats: FieldStats[];
  qualityIssues: QualityIssue[];
  summary: AnalysisSummary;
  indexes: AnalysisIndexes;
  sorts: AnalysisSorts;
  narrative: string;
  searchIndexJson: string;
};

export type FilterState = {
  status: RecordStatus | "all";
  field: string | null;
  kind: ChangeKind | "all";
  severity: Severity | "all";
  qualityIssueId: string | null;
  documentState: keyof AnalysisIndexes["byDocumentState"] | "all";
  onlyQualityFailures: boolean;
  hasEmptyLatest: boolean;
  search: string;
};
