/**
 * Source profile-driven adapter types for json-data-drift-analyzer.
 *
 * These types support source-specific configuration without assuming a universal schema.
 * Each source (e.g., bellingham-procureware) defines its own profile.
 */

import type { EmptyRule, Severity } from "./types";

// ============================================================================
// Source Profile Types
// ============================================================================

/**
 * Quality-analysis configuration for a source — which fields must be present,
 * which are legitimately empty, how fields group into failure narratives, and
 * where search draws its text from. Formerly the standalone `QualityProfile`
 * (minus id/version/name, which the owning `SourceProfile` provides): folding
 * it in gives each source ONE policy identity and version for the audit trail.
 */
export type QualitySection = {
  requiredFields: string[];
  optionalEmptyFields: string[];
  emptyRules: Record<string, EmptyRule>;
  identityDefault: string[];
  fieldGroups: Array<{
    id: string;
    name: string;
    fields: string[];
    thresholdDrop: number;
    minAffectedFields: number;
    severity: Severity;
    narrative: string;
  }>;
  /**
   * List-valued fields diffed at document level, paired with their hash fields.
   * Lives on the profile so engine code carries no source field names.
   */
  documentFieldPairs: Array<{ docs: string; hashes: string }>;
  /** Source-record fields fed into the search index, by search role. */
  searchSourceFields: { title: string; status: string; type: string; url: string };
};

/**
 * How to recognize a source's exports from record content alone. Both halves
 * default from other profile data — `urlFields` from
 * `quality.searchSourceFields.url`, `urlPrefixes` from `[sourceUrl]` — so most
 * sources auto-detect with no extra configuration. Detection is advisory: it
 * suggests a profile, it never selects one silently over a manual choice. The
 * lists are data, never code (AGENTS.md rule 1).
 */
export type ProfileDetectionHints = {
  /**
   * Record fields and the exact values that identify this source, e.g.
   * `{ "AgentID": ["1431"], "AgentName": ["Bellingham WA - PW-02"] }`. A
   * record matches only when every listed field holds an accepted value —
   * fields are ANDed, because a bot id alone is not unique in observed
   * exports. When declared, this outranks URL matching for the profile.
   */
  identityValues?: Record<string, string[]>;
  /** Record fields whose values identify the source. */
  urlFields?: string[];
  /** Value prefixes that identify this source. */
  urlPrefixes?: string[];
};

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
   * Configuration for the advisory corroboration signal (see
   * src/engine/corroboration.ts). Absent, no signal is produced.
   *
   * It lives on the profile because both halves are source-specific: which
   * fields still carry prose after a regression, and how that prose introduces
   * a deadline. AGENTS.md rule 1 keeps such knowledge out of engine code.
   */
  corroboration?: {
    /** Candidate fields whose surviving text may restate a lost value. */
    textFields: string[];
    /**
     * Phrases that introduce a deadline. A date not preceded by one of these
     * is ignored — otherwise a pre-bid meeting or completion date reads as a
     * disagreement about the due date.
     */
    deadlineCues: string[];
  };

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

/**
 * The pinned policy identity a resolved profile carries (AGENTS.md rule 7).
 *
 * Engine functions accept `SourceProfile & PolicyStamp` so a fully resolved
 * profile flows through unchanged while pure-engine tests may omit the stamp;
 * artifacts record `policyHash: null` when no stamp was supplied. The numeric
 * `version` alone cannot pin policy content once a profile is base + delta +
 * optional local override — the hash is what provenance and staleness compare.
 */
export type PolicyStamp = {
  /** FNV-1a 64 hash of the canonically serialized resolved profile. */
  policyHash?: string;
  /** Revision of the applied local override; 0 when none. */
  overrideRevision?: number;
};

/**
 * A source profile as the registry serves it: recovery policy plus the
 * source's identity metadata and quality-analysis configuration.
 *
 * The recovery/QA engine keeps consuming plain `SourceProfile` — it has no
 * business reading URLs or quality thresholds — while the registry, picker,
 * detection, and worker payload deal in this richer shape.
 */
export type RegisteredSourceProfile = SourceProfile & {
  /**
   * Canonical origin URL of the source this profile governs (e.g.
   * "https://cob.procureware.com"). Unique across profiles. Identity and
   * detection metadata only — the app never fetches it (AGENTS.md rule 8).
   */
  sourceUrl: string;

  /** Human-readable picker label; falls back to `id` when absent. */
  displayName?: string;

  /** Optional owning-agency name, searchable in the profile picker. */
  agency?: string;

  detection?: ProfileDetectionHints;

  /**
   * Quality-analysis configuration for this source. Required: the drift
   * engine's judgments (required fields, empty rules, field groups) are
   * per-source policy, not app defaults.
   */
  quality: QualitySection;
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
