/**
 * Source profile-driven adapter types for json-data-drift-analyzer.
 *
 * These types support source-specific configuration without assuming a universal schema.
 * Each source (e.g., bellingham-procureware) defines its own profile.
 */

import type { Severity } from "./types";

// ============================================================================
// Source Profile Types
// ============================================================================

/**
 * A source profile defines how to interpret and validate data from a specific
 * procurement data source. Profiles are source-specific and must not assume
 * a universal schema.
 */
export type SourceProfile = {
  /** Unique identifier for this source profile (e.g., "bellingham-procureware") */
  id: string;

  /**
   * Profile version. Required: AGENTS.md rule 7 mandates that every finding,
   * recovery action, export, and Trello draft record the rule/profile version,
   * and `Finding.profileVersion` has no other source. Bump on any change to the
   * fields below — decisions audited against v1 are not valid under v2.
   */
  version: number;

  /**
   * Path to the records array within the raw dataset.
   *
   * Follows the same convention as `ComparisonConfig.collectionPath`: a root key
   * name (e.g. `"Export"`), or `"$"` when the root itself is the array. Required —
   * the records path must be declared, never inferred (AGENTS.md rule 1).
   */
  collectionPath: string;

  /** Primary composite key fields for record identity matching */
  primaryKey: string[];

  /** Fallback composite keys when primary key fails (array of field arrays) */
  fallbackKeys: string[][];

  /** Composite key fields for deduplication within a single export */
  dedupeKey: string[];

  /** Fields that must be non-empty for a record to be valid */
  hardRequiredFields: string[];

  /** Fields permitted for automatic backfill from reference to candidate */
  safeBackfillFields: string[];

  /** Fields requiring manual review before any recovery action */
  manualReviewFields: string[];

  /** Fields excluded from drift comparison (e.g., run timestamps) */
  excludedFields: string[];

  /** Minimum match rate threshold (0.0-1.0) for accepting the comparison */
  minimumMatchRate: number;

  /** Optional notes documenting profile decisions and assumptions */
  notes?: string[];
};

// ============================================================================
// Raw Source Dataset Types
// ============================================================================

/**
 * A raw source dataset as loaded from a JSON export file.
 * The shape is source-specific; this is a minimal common wrapper.
 *
 * For Bellingham ProcureWare: { "Export": [...] }
 * Other sources may use different root structures.
 */
export type RawSourceDataset = {
  /** The root object containing the records array and optional metadata */
  [rootKey: string]: unknown;
};

/**
 * Inspection result for locating the records array in a raw dataset.
 */
export type RecordsPathInspection = {
  /** The JSON path to the records array (e.g., "$.Export") */
  path: string;

  /** The array of records found at that path */
  records: Array<Record<string, unknown>>;

  /** Whether the path was found successfully */
  found: boolean;

  /** Error message if path was not found */
  error?: string;
};

// ============================================================================
// Normalized Bid Record Types
// ============================================================================

/**
 * A normalized bid record after extraction from a source-specific raw format.
 * This is the internal representation used for comparison and analysis.
 */
export type NormalizedBidRecord = {
  /** Unique record key built from identity fields (see src/engine/identity.ts) */
  recordKey: string;

  /** Source profile id that governed normalization */
  profileId: string;

  /** Original raw record (preserved immutably) */
  raw: Record<string, unknown>;

  /** Normalized field values (string | null) */
  fields: Record<string, string | null>;

  /** Document arrays after parsing JSON-in-string fields */
  documents: Record<string, Array<{ title: string | null; url: string | null; hash: string | null }>>;
};

// ============================================================================
// Field Value State Types
// ============================================================================

/**
 * Classification of a field's value state in a record.
 *
 * - present: Field has a non-empty, non-null value
 * - missing: Field key does not exist in the record
 * - blank: Field exists but is null, empty string, or whitespace-only
 * - invalid: Field exists but fails format validation (e.g., malformed date)
 */
export type FieldValueState = "present" | "missing" | "blank" | "invalid";

/**
 * Detailed field state assessment.
 */
export type FieldState = {
  /** The field name */
  field: string;

  /** The state classification */
  state: FieldValueState;

  /** The raw value (for audit purposes) */
  rawValue: unknown;

  /** Normalized value (string | null) */
  normalizedValue: string | null;

  /** If invalid, the validation rule that failed */
  validationRule?: string;

  /** If invalid, the reason for failure */
  validationReason?: string;
};

// ============================================================================
// Finding Severity and Category Types
// ============================================================================

/**
 * Categories for classifying findings during analysis.
 */
export type FindingCategory =
  | "identity-mismatch"
  | "field-regression"
  | "field-restored"
  | "document-added"
  | "document-removed"
  | "document-modified"
  | "document-incomplete"
  | "duplicate-record"
  | "profile-violation"
  | "parse-error"
  | "path-not-found"
  | "backfill-candidate"
  | "review-required"
  | "date-ordering-issue";

/**
 * A finding represents a specific issue or observation during analysis.
 * Findings are auditable and drive recovery decisions.
 */
export type Finding = {
  /** Unique finding identifier */
  id: string;

  /** Category of the finding */
  category: FindingCategory;

  /** Severity level */
  severity: Severity;

  /** Title/summary of the finding */
  title: string;

  /** Detailed description */
  description: string;

  /** Fields related to this finding */
  relatedFields: string[];

  /** Record keys affected by this finding */
  affectedRecordKeys: string[];

  /** Source profile id that governed this finding */
  profileId: string;

  /** Profile version at time of finding */
  profileVersion: number;

  /** Timestamp when finding was recorded (ISO 8601) */
  timestamp: string;

  /** Original value (for audit) */
  originalValue?: unknown;

  /** Output/recovered value (for audit) */
  outputValue?: unknown;

  /** Reason for the finding/action */
  reason: string;

  /** Reference to source run (file name or run id) */
  sourceRun?: string;

  /** Reference to reference run (file name or run id) */
  referenceRun?: string;

  /** Matching key used for record pairing */
  matchingKey?: string;
};

/**
 * Summary of findings grouped by category and severity.
 */
export type FindingsSummary = {
  /** Total number of findings */
  totalCount: number;

  /** Findings grouped by category */
  byCategory: Record<FindingCategory, number>;

  /** Findings grouped by severity */
  bySeverity: Record<Severity, number>;

  /** All findings (may be large) */
  findings: Finding[];
};

// ============================================================================
// Adapter and Loader Types
// ============================================================================

/**
 * Result of loading and parsing a source JSON file.
 */
export type LoadResult = {
  /** Whether the load was successful */
  success: boolean;

  /** The raw parsed dataset (if successful) */
  dataset?: RawSourceDataset;

  /** Error message (if failed) */
  error?: string;

  /** File name or source identifier */
  source: string;

  /** Whether a BOM was detected and stripped */
  bomStripped: boolean;
};

/**
 * Result of inspecting a dataset for its records path.
 */
export type InspectResult = {
  /** Whether the inspection was successful */
  success: boolean;

  /** Path information (if successful) */
  pathInfo?: RecordsPathInspection;

  /** Error message (if failed) */
  error?: string;
};

/**
 * Configuration for field validation rules.
 */
export type FieldValidationRules = {
  /** Fields that should be validated as dates */
  dateFields?: string[];

  /** Fields that should be validated as URLs */
  urlFields?: string[];

  /** Fields that should be validated as email addresses */
  emailFields?: string[];

  /** Fields that should be validated as phone numbers */
  phoneFields?: string[];

  /** Fields that contain JSON-encoded arrays (JSON-in-string) */
  jsonFields?: string[];
};
