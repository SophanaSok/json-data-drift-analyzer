/**
 * Best-effort source detection: which registered profile does an uploaded
 * dataset belong to?
 *
 * A profile matches when URL-bearing field values in the dataset's records
 * start with one of its URL prefixes. Both halves are per-profile data, never
 * engine heuristics (AGENTS.md rule 1), and both default from data the profile
 * already carries — `urlFields` from `quality.searchSourceFields.url`,
 * `urlPrefixes` from `[sourceUrl]` — so most sources detect with zero extra
 * configuration.
 *
 * The result is advisory (rule 5 in spirit): it ranks suggestions for the
 * picker; it never silently overrides a person's selection, and ambiguity is
 * reported as ambiguity rather than resolved by a tiebreak.
 */

import { getCollection } from "../engine/normalize";
import type { RegisteredSourceProfile } from "../engine/adapter-types";

/** How many records to inspect per profile — enough to survive a few malformed rows. */
const DETECTION_SAMPLE_SIZE = 25;

export type ProfileDetectionMatch = {
  profileId: string;
  /** The record field whose value matched. */
  matchedField: string;
  /** The prefix it matched on. */
  matchedPrefix: string;
};

export type DetectionResult =
  | { status: "match"; match: ProfileDetectionMatch }
  | { status: "ambiguous"; matches: ProfileDetectionMatch[] }
  | { status: "none" };

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
  if (matches.length === 1) {
    const [match] = matches;
    if (match) return { status: "match", match };
  }
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "none" };
}

function matchProfile(dataset: unknown, profile: RegisteredSourceProfile): ProfileDetectionMatch | null {
  const urlFields = profile.detection?.urlFields ?? [profile.quality.searchSourceFields.url];
  const urlPrefixes = profile.detection?.urlPrefixes ?? [profile.sourceUrl];
  if (urlFields.length === 0 || urlPrefixes.length === 0) {
    return null;
  }

  const records = getCollection(dataset, profile.collectionPath).slice(0, DETECTION_SAMPLE_SIZE);
  for (const record of records) {
    for (const field of urlFields) {
      const value = record[field];
      if (typeof value !== "string" || value.length === 0) continue;
      for (const prefix of urlPrefixes) {
        if (prefix.length > 0 && value.startsWith(prefix)) {
          return { profileId: profile.id, matchedField: field, matchedPrefix: prefix };
        }
      }
    }
  }
  return null;
}
