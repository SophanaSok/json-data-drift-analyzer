/**
 * Best-effort source detection: which registered profile does an uploaded
 * dataset belong to?
 *
 * Two matchers, both driven by per-profile data rather than engine heuristics
 * (AGENTS.md rule 1):
 *
 * 1. **Identity** — `detection.identityValues` names record fields and the
 *    values that identify this source, e.g. `{ AgentID: ["1431"], AgentName:
 *    ["Bellingham WA - PW-02"] }`. A record matches only when EVERY listed
 *    field holds one of its accepted values. Fields are ANDed because a single
 *    id is not unique in observed exports: two different bots shared
 *    `AgentID` 1234 on 2026-08-27, distinguishable only by `AgentName`. A
 *    declared identity is authoritative: when the records carry the identity
 *    fields and they do not match, the profile does not match, even if URLs
 *    would. When the records lack the identity fields entirely (a different
 *    schema), the URL matcher runs for that profile instead.
 * 2. **URL prefix** — URL-bearing field values start with one of the profile's
 *    prefixes. Both halves default from data the profile already carries
 *    (`urlFields` from `quality.searchSourceFields.url`, `urlPrefixes` from
 *    `[sourceUrl]`), so a source detects with zero extra configuration until
 *    it shares a portal with another (several SciQuest/Jaggaer sources share
 *    one host), at which point identity values are the only way apart.
 *
 * Across profiles, identity matches outrank URL matches: if any profile
 * matched by identity, only identity matches are reported. A profile that
 * merely shares a host with the identified source is not a competing
 * suggestion.
 *
 * The result is advisory (rule 5 in spirit): it ranks suggestions for the
 * picker; it never silently overrides a person's selection, and ambiguity is
 * reported as ambiguity rather than resolved by a tiebreak.
 */

import { getCollection } from "../engine/normalize";
import type { RegisteredSourceProfile } from "../engine/adapter-types";

/** How many records to inspect per profile — enough to survive a few malformed rows. */
const DETECTION_SAMPLE_SIZE = 25;

export type ProfileDetectionMatch =
  | {
      profileId: string;
      method: "identity";
      /** The identity fields and the record values that satisfied them, in profile order. */
      matchedValues: Array<{ field: string; value: string }>;
    }
  | {
      profileId: string;
      method: "url";
      /** The record field whose value matched. */
      matchedField: string;
      /** The prefix it matched on. */
      matchedPrefix: string;
    };

export type DetectionResult =
  | { status: "match"; match: ProfileDetectionMatch }
  | { status: "ambiguous"; matches: ProfileDetectionMatch[] }
  | { status: "none" };

/** One-line, user-facing statement of what a match matched on. */
export function describeDetectionMatch(match: ProfileDetectionMatch): string {
  if (match.method === "identity") {
    return match.matchedValues.map(({ field, value }) => `${field} is ${JSON.stringify(value)}`).join(" and ");
  }
  return `${match.matchedField} starts with ${match.matchedPrefix}`;
}

/**
 * Test every profile against the dataset. Never throws: a malformed dataset
 * or a profile whose collection path finds nothing simply does not match.
 */
export function detectSourceProfile(
  dataset: unknown,
  profiles: RegisteredSourceProfile[]
): DetectionResult {
  const matches: ProfileDetectionMatch[] = [];
  for (const profile of profiles) {
    const match = matchProfile(dataset, profile);
    if (match) {
      matches.push(match);
    }
  }
  const identityMatches = matches.filter((match) => match.method === "identity");
  const ranked = identityMatches.length > 0 ? identityMatches : matches;
  if (ranked.length === 1) {
    const [match] = ranked;
    if (match) return { status: "match", match };
  }
  if (ranked.length > 1) return { status: "ambiguous", matches: ranked };
  return { status: "none" };
}

function matchProfile(dataset: unknown, profile: RegisteredSourceProfile): ProfileDetectionMatch | null {
  const records = getCollection(dataset, profile.collectionPath).slice(0, DETECTION_SAMPLE_SIZE);
  if (records.length === 0) return null;

  const identity = matchIdentity(records, profile);
  if (identity !== "not-applicable") return identity;
  return matchUrl(records, profile);
}

/**
 * `"not-applicable"` when the profile declares no identity or no sampled
 * record carries all of its identity fields; `null` when the records carry
 * them and none matches.
 */
function matchIdentity(
  records: Array<Record<string, unknown>>,
  profile: RegisteredSourceProfile
): ProfileDetectionMatch | null | "not-applicable" {
  const identityValues = profile.detection?.identityValues;
  if (!identityValues) return "not-applicable";
  const fields = Object.keys(identityValues);
  if (fields.length === 0) return "not-applicable";

  let applicable = false;
  for (const record of records) {
    const present = fields.every((field) => typeof record[field] === "string");
    if (!present) continue;
    applicable = true;
    const matchedValues: Array<{ field: string; value: string }> = [];
    for (const field of fields) {
      const value = record[field] as string;
      const accepted = identityValues[field] ?? [];
      if (!accepted.includes(value)) break;
      matchedValues.push({ field, value });
    }
    if (matchedValues.length === fields.length) {
      return { profileId: profile.id, method: "identity", matchedValues };
    }
  }
  return applicable ? null : "not-applicable";
}

function matchUrl(records: Array<Record<string, unknown>>, profile: RegisteredSourceProfile): ProfileDetectionMatch | null {
  const urlFields = profile.detection?.urlFields ?? [profile.quality.searchSourceFields.url];
  const urlPrefixes = profile.detection?.urlPrefixes ?? [profile.sourceUrl];
  if (urlFields.length === 0 || urlPrefixes.length === 0) {
    return null;
  }
  for (const record of records) {
    for (const field of urlFields) {
      const value = record[field];
      if (typeof value !== "string" || value.length === 0) continue;
      for (const prefix of urlPrefixes) {
        if (prefix.length > 0 && value.startsWith(prefix)) {
          return { profileId: profile.id, method: "url", matchedField: field, matchedPrefix: prefix };
        }
      }
    }
  }
  return null;
}
