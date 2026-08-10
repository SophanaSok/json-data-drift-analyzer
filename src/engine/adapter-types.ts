/**
 * Source profile-driven adapter types for json-data-drift-analyzer.
 *
 * These types support source-specific configuration without assuming a universal schema.
 * Each source (e.g., bellingham-procureware) defines its own profile.
 */

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

  /**
   * Optional per-field validation rules. The QA engine validates only what is
   * configured here — it never infers which fields are dates, URLs, or JSON from
   * their names (AGENTS.md rule 1).
   */
  validation?: FieldValidationRules;

  /**
   * Optional tolerance for record-count drift against the reference, as a fraction
   * of the reference count (0.05 = 5%). Absent, count differences are reported at
   * informational severity rather than judged against an invented threshold.
   */
  recordCountTolerance?: number;

  /**
   * Fields this source treats as date- or state-sensitive (AGENTS.md rule 6).
   *
   * Listing a field here refuses it for automatic backfill. Rule 6 requires
   * per-source explicit approval, so such a field becomes backfillable only when it
   * ALSO appears in `safeBackfillFields` — and that combination is recorded in the
   * audit trail as an explicit rule 6 approval rather than passing silently.
   *
   * The list is data, never code: no field name is baked into the engine.
   */
  dateSensitiveFields?: string[];

  /**
   * What a recovered artifact should do with candidate records that have no
   * reference counterpart. Defaults to "keep": dropping records the candidate run
   * genuinely scraped would lose data, which is the more damaging error.
   */
  candidateOnlyPolicy?: "keep" | "exclude";

  /**
   * Optional safety gate governing whether a recovered data artifact may be
   * exported. Reports and audits are always exportable — withholding the evidence
   * of a problem helps nobody. Both checks default to enabled.
   */
  exportGate?: {
    /** Block the recovered artifact when the match rate is below minimumMatchRate. */
    blockOnBelowMinimumMatchRate?: boolean;
    /** Block the recovered artifact when any critical QA finding exists. */
    blockOnCriticalFindings?: boolean;
  };

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
// Findings
// ============================================================================
//
// The Finding vocabulary lives in ./findings.ts. Earlier drafts of Finding,
// FindingCategory, and FindingsSummary lived here, were referenced by nothing, and
// used a different shape and severity scale than the QA engine produces. They were
// removed rather than left to collide with the real ones.

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
