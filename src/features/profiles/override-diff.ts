/**
 * What a local override actually changes, computed by comparing the repo
 * profile against the resolved profile. Rendered on the Profiles page so an
 * override is reviewable as a diff, not archaeology across two JSON blobs.
 */

import type { RegisteredSourceProfile } from "../../engine/adapter-types";

export type ProfileDiffEntry =
  | { kind: "list"; path: string; added: string[]; removed: string[] }
  | { kind: "value"; path: string; from: unknown; to: unknown };

/**
 * Field lists where membership is the policy and order is presentation.
 * Everything else — including the composite keys, where order IS policy —
 * compares as a whole value.
 */
const LIST_PATHS = [
  "hardRequiredFields",
  "safeBackfillFields",
  "manualReviewFields",
  "excludedFields",
  "dateSensitiveFields",
  "quality.requiredFields",
  "quality.optionalEmptyFields",
  "notes"
] as const;

const VALUE_PATHS = [
  "collectionPath",
  "primaryKey",
  "fallbackKeys",
  "dedupeKey",
  "minimumMatchRate",
  "recordCountTolerance",
  "candidateOnlyPolicy",
  "validation",
  "corroboration",
  "exportGate",
  "detection",
  "displayName",
  "agency",
  "quality.identityDefault",
  "quality.emptyRules",
  "quality.fieldGroups",
  "quality.documentFieldPairs",
  "quality.searchSourceFields"
] as const;

export function diffProfiles(
  before: RegisteredSourceProfile,
  after: RegisteredSourceProfile
): ProfileDiffEntry[] {
  const entries: ProfileDiffEntry[] = [];

  for (const path of LIST_PATHS) {
    const beforeList = (readPath(before, path) ?? []) as string[];
    const afterList = (readPath(after, path) ?? []) as string[];
    const beforeSet = new Set(beforeList);
    const afterSet = new Set(afterList);
    const added = afterList.filter((item) => !beforeSet.has(item));
    const removed = beforeList.filter((item) => !afterSet.has(item));
    if (added.length > 0 || removed.length > 0) {
      entries.push({ kind: "list", path, added, removed });
    }
  }

  for (const path of VALUE_PATHS) {
    const from = readPath(before, path);
    const to = readPath(after, path);
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      entries.push({ kind: "value", path, from, to });
    }
  }

  return entries;
}

function readPath(profile: RegisteredSourceProfile, path: string): unknown {
  const record = profile as unknown as Record<string, Record<string, unknown> | unknown>;
  if (path.startsWith("quality.")) {
    return (record.quality as Record<string, unknown>)[path.slice("quality.".length)];
  }
  return record[path];
}
