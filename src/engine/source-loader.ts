/**
 * Source loader for json-data-drift-analyzer. 
 *
 * Provides safe parsing of source JSON files with:
 * - UTF-8 BOM detection and stripping
 * - Record path resolution
 * - Immutable preservation of raw data
 *
 * Pure functions only — no filesystem or module-loader access, so this module is
 * safe to import from browser code as well as tests.
 */

import { isBlankStrict } from "./empty";
import { getCollection } from "./normalize";
import type { InspectResult, LoadResult, RawSourceDataset, SourceProfile } from "./adapter-types";

/**
 * The AGENTS.md rule 4 emptiness gate: is this candidate value blank enough that
 * backfilling over it could ever be automatic?
 *
 * Deliberately takes no policy argument. Rule 4 enumerates "null, absent, empty, or
 * whitespace-only", so strict blankness is the only correct reading here, and no call
 * site may opt into placeholder semantics. A candidate value of "N/A" is a value the
 * source chose to publish; rule 3 forbids overwriting it automatically, so it routes
 * to manual review instead.
 *
 * This answers ONLY the emptiness precondition. Rule 4's other two conditions —
 * exactly one reference match, and the field being permitted by the source profile —
 * are separate checks the caller must also satisfy.
 *
 * @param candidateValue - The value currently in the candidate record
 * @returns true when the value is null, undefined, empty, or whitespace-only
 */
export function isBackfillEligibleValue(candidateValue: unknown): boolean {
  return isBlankStrict(candidateValue);
}

/**
 * Rule 4's emptiness precondition applied to a field of a record, treating an absent
 * key as eligible ("null, absent, empty, or whitespace-only").
 *
 * @param record - The candidate record
 * @param fieldName - The field being considered for backfill
 */
export function isBackfillEligibleField(record: Record<string, unknown>, fieldName: string): boolean {
  if (!(fieldName in record)) {
    return true;
  }
  return isBackfillEligibleValue(record[fieldName]);
}

/**
 * Detect and strip UTF-8 BOM from file content.
 * @param content - Raw file content as string
 * @returns Object with cleaned content and BOM detection flag
 */
export function stripBOM(content: string): { content: string; bomStripped: boolean } {
  if (content.charCodeAt(0) === 0xfeff) {
    return { content: content.slice(1), bomStripped: true };
  }
  return { content, bomStripped: false };
}

/**
 * Parse JSON content safely, handling BOM and parse errors.
 * @param content - Raw file content
 * @param source - Source identifier (file name or description)
 * @returns LoadResult with parsed dataset or error
 */
export function parseJSON(content: string, source: string): LoadResult {
  // Strip outside the try so the flag stays accurate on the failure path too:
  // "BOM removed but JSON still invalid" and "no BOM" are different diagnoses,
  // and this source is exactly where that distinction matters.
  const { content: cleaned, bomStripped } = stripBOM(content);

  try {
    const parsed = JSON.parse(cleaned) as RawSourceDataset;
    return {
      success: true,
      dataset: parsed,
      source,
      bomStripped
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown parse error";
    return {
      success: false,
      error: errorMessage,
      source,
      bomStripped
    };
  }
}

/**
 * Locate the records array declared by the profile's `collectionPath`.
 *
 * The path is taken from the profile and never inferred: guessing a records path
 * the caller did not declare would be inventing a source schema (AGENTS.md rule 1).
 * If the declared path holds no array, this fails and reports the root keys that
 * are actually present so the profile can be corrected.
 *
 * Non-object array elements are filtered out by `getCollection`, so `records` is
 * always an array of objects.
 *
 * @param dataset - Parsed raw dataset
 * @param profile - Source profile declaring `collectionPath`
 * @returns InspectResult with path information
 */
export function inspectRecordsPath(dataset: RawSourceDataset, profile: SourceProfile): InspectResult {
  try {
    const { collectionPath } = profile;
    const source = collectionPath === "$" ? dataset : dataset[collectionPath];

    if (!Array.isArray(source)) {
      const rootKeys = Object.keys(dataset);
      return {
        success: false,
        error: `No records array at '${collectionPath}' declared by profile '${profile.id}'. Dataset root keys: ${rootKeys.join(", ") || "(none)"}`
      };
    }

    return {
      success: true,
      pathInfo: {
        path: collectionPath === "$" ? "$" : `$.${collectionPath}`,
        records: getCollection(dataset, collectionPath),
        found: true
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown inspection error";
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Validate that a record has all identity fields defined in the profile's primary key.
 *
 * Uses STRICT blankness: a placeholder value such as "-" counts as present here. That
 * is a deliberate choice, not an oversight — strict (`isBlankStrict`) versus
 * placeholder-aware (`isEmpty`) blankness deliberately disagree; see `src/engine/empty.ts`. If placeholder identity
 * values should invalidate a record, that is a profile-level policy decision and needs
 * an explicit rule rather than a silent default.
 *
 * @param record - A single bid record
 * @param profile - Source profile with primaryKey definition
 * @returns Object with validation result and missing/blank fields
 */
export function validateIdentityFields(
  record: Record<string, unknown>,
  profile: SourceProfile
): { valid: boolean; missingFields: string[]; blankFields: string[] } {
  const missingFields: string[] = [];
  const blankFields: string[] = [];

  for (const field of profile.primaryKey) {
    if (!(field in record)) {
      missingFields.push(field);
    } else if (isBlankStrict(record[field])) {
      blankFields.push(field);
    }
  }

  return {
    valid: missingFields.length === 0 && blankFields.length === 0,
    missingFields,
    blankFields
  };
}

/**
 * Load a dataset from raw text content, handling BOM.
 * @param content - Raw file content as string
 * @param source - Source identifier
 * @returns LoadResult with parsed dataset or error
 */
export function loadFixtureFromText(content: string, source: string): LoadResult {
  return parseJSON(content, source);
}

/**
 * Count presence/absence of the profile's identity fields across a record set.
 *
 * Uses STRICT blankness, matching `validateIdentityFields`.
 *
 * @param records - Array of bid records
 * @param profile - Source profile with identity key definition
 * @returns Object with verification results
 */
export function verifyIdentityFieldsExist(
  records: Array<Record<string, unknown>>,
  profile: SourceProfile
): {
  allPresent: boolean;
  fieldPresence: Record<string, { present: number; missing: number; blank: number }>;
} {
  const fieldPresence: Record<string, { present: number; missing: number; blank: number }> = {};

  for (const field of profile.primaryKey) {
    fieldPresence[field] = { present: 0, missing: 0, blank: 0 };
  }

  for (const record of records) {
    for (const field of profile.primaryKey) {
      if (!(field in record)) {
        fieldPresence[field]!.missing++;
      } else if (isBlankStrict(record[field])) {
        fieldPresence[field]!.blank++;
      } else {
        fieldPresence[field]!.present++;
      }
    }
  }

  const allPresent = profile.primaryKey.every((field) => fieldPresence[field]!.missing === 0);

  return { allPresent, fieldPresence };
}

