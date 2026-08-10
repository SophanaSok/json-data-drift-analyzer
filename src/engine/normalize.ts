import { isBlankStrict } from "./empty";

/**
 * Normalize a value for use in an identity key.
 *
 * Applies only transformations that cannot change semantic identity:
 * - Unicode NFC, so canonically-equivalent spellings compare equal.
 * - Outer whitespace trimmed. Interior whitespace is preserved — collapsing it
 *   would merge genuinely different values.
 * - For absolute http(s) URLs: scheme and host lowercased and default ports
 *   dropped, both of which RFC 3986 defines as insignificant. Path, query, and
 *   fragment are preserved exactly, including case and any trailing slash, because
 *   those ARE significant and rewriting them could merge distinct resources.
 *
 * Case is deliberately NOT normalized for non-URL values. Whether a code like
 * "34B-2026" is case-insensitive is a source business rule, and AGENTS.md rule 1
 * forbids inventing one.
 *
 * @returns the normalized string, or null when the value cannot serve as an
 *   identity component (absent, blank, or a non-scalar)
 */
export function normalizeIdentityValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  // Objects and arrays have no stable scalar identity; reject rather than guess.
  if (typeof value === "object") {
    return null;
  }

  const asText = typeof value === "string" ? value : String(value);
  if (isBlankStrict(asText)) {
    return null;
  }

  return normalizeUrlIfAbsolute(asText.trim().normalize("NFC"));
}

function normalizeUrlIfAbsolute(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return value;
    }
    // The URL parser lowercases scheme and host and removes default ports, while
    // leaving path, query, and fragment untouched.
    return url.href;
  } catch {
    // Not a URL — a bare code, a title, an id. Use it as-is.
    return value;
  }
}

export type IdentityKey = {
  /** Stable key string, or null when the record cannot be keyed on these fields. */
  key: string | null;
  /** Fields absent from the record entirely. */
  missingFields: string[];
  /** Fields present but blank, whitespace-only, or non-scalar. */
  blankFields: string[];
  /** Normalized component values, in field order. */
  values: Array<string | null>;
};

/**
 * Build a composite identity key from the given fields.
 *
 * Components are serialized with JSON.stringify rather than joined on a separator,
 * so a value containing the separator cannot forge a collision — ["a::b", "c"] and
 * ["a", "b::c"] produce different keys.
 *
 * @returns a key plus the diagnostics needed to explain a null key
 */
export function buildIdentityKey(record: Record<string, unknown>, fields: string[]): IdentityKey {
  const missingFields: string[] = [];
  const blankFields: string[] = [];
  const values: Array<string | null> = [];

  for (const field of fields) {
    if (!(field in record)) {
      missingFields.push(field);
      values.push(null);
      continue;
    }

    const normalized = normalizeIdentityValue(record[field]);
    if (normalized === null) {
      blankFields.push(field);
    }
    values.push(normalized);
  }

  const complete = fields.length > 0 && values.every((value) => value !== null);
  return {
    key: complete ? JSON.stringify(values) : null,
    missingFields,
    blankFields,
    values
  };
}

export function getCollection(input: unknown, path: string): Array<Record<string, unknown>> {
  const source = path === "$" ? input : (input as Record<string, unknown> | undefined)?.[path];
  if (!Array.isArray(source)) {
    return [];
  }
  return source.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
}

export function normalizeRecord(record: Record<string, unknown>, ignoredFields: string[]): Record<string, unknown> {
  const ignored = new Set(ignoredFields);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !ignored.has(key)));
}
