import type { EmptyRule } from "./types";

const DEFAULT_PLACEHOLDERS = new Set(["n/a", "na", "none", "unknown", "-"]);

export function isEmpty(value: unknown, fieldRule?: EmptyRule): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return true;
    }
    const placeholders = new Set([...(fieldRule?.placeholders ?? []), ...DEFAULT_PLACEHOLDERS]);
    return placeholders.has(trimmed.toLowerCase());
  }
  if (Array.isArray(value)) {
    return value.length === 0 && !fieldRule?.allowEmptyArray;
  }
  return false;
}
