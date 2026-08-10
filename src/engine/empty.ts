import type { EmptyRule } from "./types";

export const DEFAULT_PLACEHOLDERS: ReadonlySet<string> = new Set(["n/a", "na", "none", "unknown", "-"]);

/**
 * Strict blankness as defined by AGENTS.md rule 4: "null, absent, empty, or
 * whitespace-only". Placeholder strings such as "N/A" are deliberately NOT blank
 * under this definition — they are values the source chose to publish, and rule 3
 * protects them from automatic overwrite.
 *
 * Arrays are never strict-blank: an empty array is a structural value, not an
 * absent one. Use `isEmpty` with an `EmptyRule` when array emptiness matters.
 *
 * Use this for backfill eligibility. Use `isEmpty` for data-quality reporting.
 */
export function isBlankStrict(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  return false;
}

export function isEmpty(value: unknown, fieldRule?: EmptyRule): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return true;
    }
    const placeholders = new Set<string>([...(fieldRule?.placeholders ?? []), ...DEFAULT_PLACEHOLDERS]);
    return placeholders.has(trimmed.toLowerCase());
  }
  if (Array.isArray(value)) {
    return value.length === 0 && !fieldRule?.allowEmptyArray;
  }
  return false;
}
