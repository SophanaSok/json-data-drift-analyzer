import { describe, expect, it } from "vitest";
import { matchRecords, type MatchReport, type MatchStatus } from "./matchRecords";
import { buildIdentityKey, normalizeIdentityValue } from "./normalize";
import type { SourceProfile } from "./adapter-types";
import { BELLINGHAM_PROCUREWARE } from "../profiles";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

/** The approved policy, so key changes surface here. */
const bellinghamProfile: SourceProfile = BELLINGHAM_PROCUREWARE;

const noFallbackProfile: SourceProfile = { ...bellinghamProfile, fallbackKeys: [] };

/** Minimal synthetic record shaped like the real source. */
const rec = (overrides: Record<string, unknown> = {}) => ({
  AgentID: "1431",
  ProjectCode: "1B-2020",
  BidURL: "https://cob.procureware.com/Bids/00000000-0000-4000-8000-000000000001",
  ...overrides
});

const statuses = (report: MatchReport): MatchStatus[] => report.results.map((result) => result.status);
const only = (report: MatchReport, status: MatchStatus) => report.results.filter((r) => r.status === status);

describe("normalizeIdentityValue", () => {
  it("trims and applies Unicode NFC", () => {
    const decomposed = "Caf\u0065\u0301"; // e + U+0301 combining acute
    const composed = "Caf\u00e9"; // precomposed e-acute
    expect(decomposed).not.toBe(composed);
    expect(normalizeIdentityValue(`  ${decomposed}  `)).toBe(composed);
    expect(normalizeIdentityValue(composed)).toBe(composed);
  });

  it("preserves interior whitespace and case for non-URL values", () => {
    expect(normalizeIdentityValue("34B-2026")).toBe("34B-2026");
    expect(normalizeIdentityValue("34b-2026")).toBe("34b-2026");
    expect(normalizeIdentityValue("Two  Spaces")).toBe("Two  Spaces");
  });

  it("lowercases URL scheme and host but never the path", () => {
    expect(normalizeIdentityValue("HTTPS://COB.PROCUREWARE.COM/Bids/AbC")).toBe(
      "https://cob.procureware.com/Bids/AbC"
    );
  });

  it("drops default ports only", () => {
    expect(normalizeIdentityValue("https://cob.procureware.com:443/Bids/x")).toBe(
      "https://cob.procureware.com/Bids/x"
    );
    expect(normalizeIdentityValue("https://cob.procureware.com:8443/Bids/x")).toBe(
      "https://cob.procureware.com:8443/Bids/x"
    );
  });

  it("preserves query, fragment, and trailing slash as significant", () => {
    expect(normalizeIdentityValue("https://a.test/x?b=1")).toBe("https://a.test/x?b=1");
    expect(normalizeIdentityValue("https://a.test/x#frag")).toBe("https://a.test/x#frag");
    expect(normalizeIdentityValue("https://a.test/x/")).toBe("https://a.test/x/");
    expect(normalizeIdentityValue("https://a.test/x")).not.toBe(normalizeIdentityValue("https://a.test/x/"));
  });

  it("canonicalizes the serialization without changing the resource", () => {
    // Documented, deliberate: URL#href is not byte-preserving. These rewrites are
    // RFC-equivalent, and both sides of a comparison get the same treatment.
    expect(normalizeIdentityValue("https://a.test/x y")).toBe("https://a.test/x%20y");
    expect(normalizeIdentityValue("https://a.test")).toBe("https://a.test/");

    // Equivalent spellings therefore match each other.
    expect(normalizeIdentityValue("https://a.test/x y")).toBe(normalizeIdentityValue("https://a.test/x%20y"));
    expect(normalizeIdentityValue("https://a.test")).toBe(normalizeIdentityValue("https://a.test/"));
  });

  it("returns null for absent, blank, and non-scalar values", () => {
    expect(normalizeIdentityValue(null)).toBeNull();
    expect(normalizeIdentityValue(undefined)).toBeNull();
    expect(normalizeIdentityValue("")).toBeNull();
    expect(normalizeIdentityValue("   ")).toBeNull();
    expect(normalizeIdentityValue({})).toBeNull();
    expect(normalizeIdentityValue([])).toBeNull();
  });

  it("does not treat placeholders as blank — that is a rule 4 question, not a key question", () => {
    expect(normalizeIdentityValue("N/A")).toBe("N/A");
  });
});

describe("buildIdentityKey", () => {
  it("reports missing and blank fields separately", () => {
    const result = buildIdentityKey({ AgentID: "1431", BidURL: "  " }, ["AgentID", "BidURL", "Absent"]);
    expect(result.key).toBeNull();
    expect(result.missingFields).toEqual(["Absent"]);
    expect(result.blankFields).toEqual(["BidURL"]);
  });

  it("cannot be forged by a value containing the separator", () => {
    const a = buildIdentityKey({ x: "a::b", y: "c" }, ["x", "y"]);
    const b = buildIdentityKey({ x: "a", y: "b::c" }, ["x", "y"]);
    expect(a.key).not.toBe(b.key);
  });
});

describe("matchRecords: real Bellingham fixtures", () => {
  const report = matchRecords(referenceRecords, candidateRecords, bellinghamProfile);

  it("matches 499 of 500 records on the primary key", () => {
    expect(report.candidateCount).toBe(500);
    expect(report.referenceCount).toBe(500);
    expect(report.counts.matched_primary).toBe(499);
    expect(report.counts.matched_fallback).toBe(0);
  });

  it("reports one record on each side without a counterpart", () => {
    expect(report.counts.candidate_only).toBe(1);
    expect(report.counts.reference_only).toBe(1);

    const candidateOnly = only(report, "candidate_only")[0]!;
    const referenceOnly = only(report, "reference_only")[0]!;
    expect(candidateRecords[candidateOnly.candidateIndex!]!.ProjectCode).toBe("33B-2026");
    expect(referenceRecords[referenceOnly.referenceIndex!]!.ProjectCode).toBe("3B-2018");
  });

  it("finds no ambiguity or invalid identity in the real data", () => {
    expect(report.counts.ambiguous_primary).toBe(0);
    expect(report.counts.ambiguous_fallback).toBe(0);
    expect(report.counts.invalid_identity).toBe(0);
  });

  it("reports a match rate of 0.998 and clears the profile minimum", () => {
    expect(report.matchRate).toBeCloseTo(0.998, 5);
    expect(report.meetsMinimumMatchRate).toBe(true);
  });

  it("emits one row per candidate plus one per unmatched reference", () => {
    expect(report.results).toHaveLength(candidateRecords.length + 1);
  });

  it("carries evidence on every matched row", () => {
    for (const result of only(report, "matched_primary")) {
      expect(result.candidateIndex).toBeGreaterThanOrEqual(0);
      expect(result.referenceIndex).toBeGreaterThanOrEqual(0);
      expect(result.matchMethod).toBe("primary");
      expect(result.keyFields).toEqual(["AgentID", "BidURL"]);
      expect(result.candidateKey).toBe(result.referenceKey);
    }
  });

  it("never assigns one reference to two candidates", () => {
    const used = only(report, "matched_primary").map((r) => r.referenceIndex);
    expect(new Set(used).size).toBe(used.length);
  });

  it("agrees with the ProjectCode fallback key on every pairing", () => {
    // The forensic report found BidURL and ProjectCode produce identical pairings.
    for (const result of only(report, "matched_primary")) {
      expect(candidateRecords[result.candidateIndex!]!.ProjectCode).toBe(
        referenceRecords[result.referenceIndex!]!.ProjectCode
      );
    }
  });
});

describe("matchRecords: normalization affects matching", () => {
  it("matches across host case, default port, and surrounding whitespace", () => {
    const reference = [rec({ BidURL: "https://cob.procureware.com/Bids/abc" })];
    const candidate = [rec({ BidURL: "  HTTPS://COB.PROCUREWARE.COM:443/Bids/abc  " })];

    const report = matchRecords(reference, candidate, noFallbackProfile);
    expect(statuses(report)).toEqual(["matched_primary"]);
  });

  it("matches canonically-equivalent Unicode spellings", () => {
    const reference = [rec({ ProjectCode: "Caf\u0065\u0301-1" })];
    const candidate = [rec({ ProjectCode: "Caf\u00e9-1" })];
    const profile: SourceProfile = { ...noFallbackProfile, primaryKey: ["ProjectCode"] };

    expect(statuses(matchRecords(reference, candidate, profile))).toEqual(["matched_primary"]);
  });

  it("does not match on differing path case — paths are significant", () => {
    const reference = [rec({ BidURL: "https://a.test/Bids/abc" })];
    const candidate = [rec({ BidURL: "https://a.test/bids/abc" })];

    const report = matchRecords(reference, candidate, noFallbackProfile);
    expect(report.counts.matched_primary).toBe(0);
    expect(report.counts.candidate_only).toBe(1);
    expect(report.counts.reference_only).toBe(1);
  });
});

describe("matchRecords: duplicate BidURL", () => {
  it("flags ambiguous_primary when the reference has two records with one BidURL", () => {
    const reference = [rec({ ProjectCode: "1B-2020" }), rec({ ProjectCode: "2B-2020" })];
    const candidate = [rec({ ProjectCode: "1B-2020" })];

    const report = matchRecords(reference, candidate, noFallbackProfile);
    const ambiguous = only(report, "ambiguous_primary");

    expect(report.counts.matched_primary).toBe(0);
    expect(ambiguous.length).toBeGreaterThan(0);
    expect(ambiguous[0]!.ambiguity?.referenceIndexes).toEqual([0, 1]);
    expect(ambiguous[0]!.ambiguity?.side).toBe("reference");
    expect(ambiguous[0]!.referenceIndex).toBeNull();
  });

  it("flags ambiguous_primary when the candidate has two records with one BidURL", () => {
    const reference = [rec()];
    const candidate = [rec({ ProjectCode: "1B-2020" }), rec({ ProjectCode: "2B-2020" })];

    const report = matchRecords(reference, candidate, noFallbackProfile);
    const ambiguous = only(report, "ambiguous_primary");

    expect(report.counts.matched_primary).toBe(0);
    expect(ambiguous).toHaveLength(3); // both candidates, plus the unclaimed reference
    expect(ambiguous[0]!.ambiguity?.candidateIndexes).toEqual([0, 1]);
    expect(ambiguous[0]!.ambiguity?.side).toBe("candidate");
  });

  it("reports side 'both' when each export duplicates the key", () => {
    const reference = [rec(), rec()];
    const candidate = [rec(), rec()];

    const report = matchRecords(reference, candidate, noFallbackProfile);
    expect(only(report, "ambiguous_primary")[0]!.ambiguity?.side).toBe("both");
  });
});

describe("matchRecords: fallback keys", () => {
  const differentUrl = { BidURL: "https://cob.procureware.com/Bids/00000000-0000-4000-8000-0000000000ff" };

  it("falls back to ProjectCode when the primary key finds nothing", () => {
    const reference = [rec()];
    const candidate = [rec(differentUrl)];

    const report = matchRecords(reference, candidate, bellinghamProfile);
    const matched = only(report, "matched_fallback")[0]!;

    expect(report.counts.matched_fallback).toBe(1);
    expect(matched.matchMethod).toBe("fallback");
    expect(matched.keyFields).toEqual(["AgentID", "ProjectCode"]);
    expect(matched.referenceIndex).toBe(0);
  });

  it("does not fall back when the profile permits no fallback keys", () => {
    const reference = [rec()];
    const candidate = [rec(differentUrl)];

    const report = matchRecords(reference, candidate, noFallbackProfile);
    expect(report.counts.matched_fallback).toBe(0);
    expect(report.counts.candidate_only).toBe(1);
    expect(report.counts.reference_only).toBe(1);
    expect(report.fallbackKeysUsed).toEqual([]);
  });

  it("flags ambiguous_fallback when the fallback key yields two reference matches", () => {
    const reference = [
      rec({ BidURL: "https://a.test/Bids/1" }),
      rec({ BidURL: "https://a.test/Bids/2" })
    ];
    const candidate = [rec({ BidURL: "https://a.test/Bids/3" })];

    const report = matchRecords(reference, candidate, bellinghamProfile);
    const ambiguous = only(report, "ambiguous_fallback")[0]!;

    expect(report.counts.matched_fallback).toBe(0);
    expect(ambiguous.ambiguity?.keyFields).toEqual(["AgentID", "ProjectCode"]);
    expect(ambiguous.ambiguity?.referenceIndexes).toEqual([0, 1]);
    expect(ambiguous.referenceIndex).toBeNull();
  });

  it("flags ambiguous_fallback when two candidates share a fallback key", () => {
    const reference = [rec({ BidURL: "https://a.test/Bids/1" })];
    const candidate = [
      rec({ BidURL: "https://a.test/Bids/2" }),
      rec({ BidURL: "https://a.test/Bids/3" })
    ];

    const report = matchRecords(reference, candidate, bellinghamProfile);
    expect(report.counts.ambiguous_fallback).toBe(2);
    expect(report.counts.matched_fallback).toBe(0);
  });

  it("does not let a fallback re-claim a reference already matched on the primary key", () => {
    // Both candidates share ProjectCode; the first matches reference 0 on BidURL.
    const reference = [rec()];
    const candidate = [rec(), rec(differentUrl)];

    const report = matchRecords(reference, candidate, bellinghamProfile);

    expect(report.counts.matched_primary).toBe(1);
    expect(report.counts.matched_fallback).toBe(0);
    expect(report.counts.candidate_only).toBe(1);

    const usedReferences = report.results
      .filter((r) => r.referenceIndex !== null && r.matchMethod !== null)
      .map((r) => r.referenceIndex);
    expect(new Set(usedReferences).size).toBe(usedReferences.length);
  });

  it("flags ambiguous_fallback even when one colliding reference was claimed on the primary key", () => {
    // The regression this covers: fallback uniqueness used to be judged only over
    // still-unclaimed references, so with refs 0 and 1 sharing the fallback key and
    // ref 0 claimed in pass 1, ref 1 looked unique and was silently paired — and
    // backfilled from — without any ambiguity flag.
    const reference = [
      rec({ BidURL: "https://a.test/Bids/1" }),
      rec({ BidURL: "https://a.test/Bids/2" })
    ];
    const candidate = [
      rec({ BidURL: "https://a.test/Bids/1" }), // primary-matches reference 0
      rec({ BidURL: "https://a.test/Bids/3" }) // changed URL; falls back on ProjectCode
    ];

    const report = matchRecords(reference, candidate, bellinghamProfile);
    const ambiguous = only(report, "ambiguous_fallback")[0]!;

    expect(report.counts.matched_primary).toBe(1);
    expect(report.counts.matched_fallback).toBe(0);
    expect(ambiguous.candidateIndex).toBe(1);
    // The evidence names EVERY reference carrying the key, the claimed one included.
    expect(ambiguous.ambiguity?.referenceIndexes).toEqual([0, 1]);
  });

  it("leaves a candidate unmatched when the sole fallback carrier is already claimed", () => {
    // One reference, claimed on the primary key by candidate 0. Candidate 1's
    // fallback key points only at it: that means "no counterpart", never "take
    // the leftover".
    const reference = [rec()];
    const candidate = [rec(), rec(differentUrl)];

    const report = matchRecords(reference, candidate, bellinghamProfile);
    expect(report.counts.matched_fallback).toBe(0);
    expect(report.counts.ambiguous_fallback).toBe(0);
    expect(report.counts.candidate_only).toBe(1);
  });

  it("skips a fallback the candidate cannot be keyed on", () => {
    const reference = [rec()];
    const candidate = [rec({ ...differentUrl, ProjectCode: "   " })];

    const report = matchRecords(reference, candidate, bellinghamProfile);
    expect(report.counts.matched_fallback).toBe(0);
    expect(report.counts.candidate_only).toBe(1);
  });
});

describe("matchRecords: duplicate ProjectCode", () => {
  it("is harmless while the primary key stays unique", () => {
    const reference = [
      rec({ BidURL: "https://a.test/Bids/1", ProjectCode: "SAME" }),
      rec({ BidURL: "https://a.test/Bids/2", ProjectCode: "SAME" })
    ];
    const candidate = [
      rec({ BidURL: "https://a.test/Bids/1", ProjectCode: "SAME" }),
      rec({ BidURL: "https://a.test/Bids/2", ProjectCode: "SAME" })
    ];

    const report = matchRecords(reference, candidate, bellinghamProfile);
    expect(report.counts.matched_primary).toBe(2);
    expect(report.counts.ambiguous_fallback).toBe(0);
  });
});

describe("matchRecords: missing and blank keys", () => {
  it("reports invalid_identity for a candidate missing a key field", () => {
    const { BidURL: _omitted, ...withoutUrl } = rec();
    const report = matchRecords([rec()], [withoutUrl], noFallbackProfile);
    const invalid = only(report, "invalid_identity")[0]!;

    expect(invalid.candidateIndex).toBe(0);
    expect(invalid.invalidIdentity?.missingFields).toEqual(["BidURL"]);
    expect(invalid.invalidIdentity?.blankFields).toEqual([]);
    expect(invalid.candidateKey).toBeNull();
  });

  it("reports invalid_identity for blank and whitespace-only key values", () => {
    const report = matchRecords([rec()], [rec({ BidURL: "" }), rec({ AgentID: "  \t " })], noFallbackProfile);
    const invalid = only(report, "invalid_identity");

    expect(invalid).toHaveLength(2);
    expect(invalid[0]!.invalidIdentity?.blankFields).toEqual(["BidURL"]);
    expect(invalid[1]!.invalidIdentity?.blankFields).toEqual(["AgentID"]);
  });

  it("reports invalid_identity on the reference side too", () => {
    const report = matchRecords([rec({ BidURL: null })], [rec()], noFallbackProfile);

    expect(only(report, "invalid_identity")[0]!.referenceIndex).toBe(0);
    expect(report.counts.candidate_only).toBe(1);
  });

  it("never matches an unkeyable record", () => {
    const report = matchRecords([rec({ BidURL: "" })], [rec({ BidURL: "" })], noFallbackProfile);
    expect(report.counts.matched_primary).toBe(0);
    expect(report.counts.invalid_identity).toBe(2);
  });
});

describe("matchRecords: report shape", () => {
  it("handles empty inputs without dividing by zero", () => {
    const report = matchRecords([], [], bellinghamProfile);
    expect(report.matchRate).toBe(0);
    expect(report.results).toEqual([]);
    expect(report.meetsMinimumMatchRate).toBe(false);
  });

  it("fails the minimum match rate when too little matches", () => {
    const reference = [rec()];
    const candidate = [rec(), rec({ BidURL: "https://a.test/Bids/z", ProjectCode: "OTHER" })];

    const report = matchRecords(reference, candidate, noFallbackProfile);
    expect(report.matchRate).toBe(0.5);
    expect(report.meetsMinimumMatchRate).toBe(false);
  });

  it("carries profile identity for the audit trail", () => {
    const report = matchRecords([rec()], [rec()], bellinghamProfile);
    expect(report.profileId).toBe("bellingham-procureware");
    // Tracks the canonical profile: an approval that bumps the version surfaces here.
    expect(report.profileVersion).toBe(bellinghamProfile.version);
    expect(report.primaryKey).toEqual(["AgentID", "BidURL"]);
  });

  it("counts every result exactly once", () => {
    const report = matchRecords(referenceRecords, candidateRecords, bellinghamProfile);
    const total = Object.values(report.counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(report.results.length);
  });

  it("does not mutate the input records", () => {
    const reference = [rec()];
    const candidate = [rec()];
    const referenceSnapshot = JSON.stringify(reference);
    const candidateSnapshot = JSON.stringify(candidate);

    matchRecords(reference, candidate, bellinghamProfile);

    expect(JSON.stringify(reference)).toBe(referenceSnapshot);
    expect(JSON.stringify(candidate)).toBe(candidateSnapshot);
  });
});
