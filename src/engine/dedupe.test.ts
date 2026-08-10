import { describe, expect, it } from "vitest";
import { runDedupe, type DedupeResult } from "./dedupe";
import { runRecovery } from "./recovery";
import { matchRecords } from "./matchRecords";
import { runQa } from "./qa";
import type { SourceProfile } from "./adapter-types";
import { BELLINGHAM_PROCUREWARE } from "../profiles";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const FIXED_NOW = "2026-08-10T00:00:00.000Z";

/** The approved Bellingham policy, loaded from the single source of truth. */
const bellinghamProfile: SourceProfile = BELLINGHAM_PROCUREWARE;

/** Generic profile — dedupe key differs from the primary key so grouping is exercised. */
const genericProfile: SourceProfile = {
  id: "generic-source",
  version: 2,
  collectionPath: "$",
  primaryKey: ["Id"],
  fallbackKeys: [],
  dedupeKey: ["Group"],
  hardRequiredFields: ["Id", "Group"],
  safeBackfillFields: [],
  manualReviewFields: [],
  excludedFields: [],
  minimumMatchRate: 0
};

const rec = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  Id: "a",
  Group: "g1",
  ...overrides
});

/** Full pipeline: match -> QA -> recover -> dedupe. Dedupe cannot run any earlier. */
function pipeline(
  reference: Array<Record<string, unknown>>,
  candidate: Array<Record<string, unknown>>,
  profile: SourceProfile = genericProfile,
  recoveryOptions = {}
): DedupeResult {
  const matchReport = matchRecords(reference, candidate, profile);
  const qa = runQa(reference, candidate, profile, { matchReport, generatedAt: FIXED_NOW });
  const recovery = runRecovery(candidate, reference, profile, matchReport, qa.findings, {
    generatedAt: FIXED_NOW,
    sourceRun: "candidate.json",
    referenceRun: "reference.json",
    ...recoveryOptions
  });
  return runDedupe(recovery, candidate, profile, { generatedAt: FIXED_NOW });
}

describe("dedupe: ordering and key selection", () => {
  it("consumes a recovery result, so it cannot run before recovery", () => {
    // Structural guarantee: the entry point's first parameter is a RecoveryResult.
    // This test documents the contract that the type enforces at compile time.
    const result = pipeline([], [rec()]);
    expect(result.summary.participantCount).toBe(1);
  });

  it("groups on the configured dedupe key, not the primary key", () => {
    // Distinct Ids (the primary key), shared Group (the dedupe key).
    const candidate = [rec({ Id: "a", Group: "same" }), rec({ Id: "b", Group: "same" })];
    const result = pipeline([], candidate);

    expect(result.dedupeKeyFields).toEqual(["Group"]);
    expect(result.summary.duplicateGroupCount).toBe(1);
    expect(result.summary.retainedCount).toBe(1);
  });

  it("does not group records that differ on the dedupe key", () => {
    const candidate = [rec({ Id: "a", Group: "g1" }), rec({ Id: "b", Group: "g2" })];
    const result = pipeline([], candidate);

    expect(result.summary.duplicateGroupCount).toBe(0);
    expect(result.summary.retainedCount).toBe(2);
    expect(result.removed).toHaveLength(0);
  });

  it("normalizes the key before grouping", () => {
    // Same group after trim and NFC; grouped despite differing bytes.
    const candidate = [rec({ Id: "a", Group: "  g1  " }), rec({ Id: "b", Group: "g1" })];
    const result = pipeline([], candidate);
    expect(result.summary.duplicateGroupCount).toBe(1);
  });
});

describe("dedupe: exact duplicates", () => {
  // Ids stay distinct so the records are valid: repeating the PRIMARY key would make
  // the match ambiguous and recovery would exclude them before dedupe ever ran.
  it("keeps one record and removes the rest", () => {
    const candidate = [rec({ Id: "a" }), rec({ Id: "b" }), rec({ Id: "c" })];
    const result = pipeline([], candidate);

    expect(result.summary.retainedCount).toBe(1);
    expect(result.summary.removedCount).toBe(2);
    expect(result.groups[0].memberCount).toBe(3);
  });

  it("keeps the earliest when everything else ties", () => {
    const candidate = [rec({ Id: "a" }), rec({ Id: "b" })];
    const result = pipeline([], candidate);

    expect(result.groups[0].winner.candidateIndex).toBe(0);
    expect(result.removed[0].reason).toBe("duplicate_lost_to_earlier_record");
    expect(result.removed[0].detail).toContain("index 0 before 1");
  });

  it("excludes rather than dedupes when the primary key itself repeats", () => {
    // Ambiguous identity is a matching problem, not a duplication one.
    const candidate = [rec({ Id: "a" }), rec({ Id: "a" })];
    const result = pipeline([], candidate);

    expect(result.summary.retainedCount).toBe(0);
    expect(result.summary.carriedExcludedCount + result.summary.removedCount).toBe(2);
    expect(result.summary.accountedFor).toBe(true);
  });
});

describe("dedupe: same key, different completeness", () => {
  it("prefers the record populating more hard-required fields", () => {
    // Both keyed on Group; the second populates Id as well.
    const candidate = [
      { Id: "", Group: "g1", Note: "sparse" },
      { Id: "b", Group: "g1", Note: "complete" }
    ];
    const result = pipeline([], candidate);

    expect(result.summary.retainedCount).toBe(1);
    expect(result.groups[0].winner.requiredFieldsPresent).toBe(2);
    expect(result.removed[0].removed.requiredFieldsPresent).toBe(1);
  });

  it("falls through to input order when required-field counts match", () => {
    const candidate = [
      { Id: "a", Group: "g1" },
      { Id: "b", Group: "g1", Extra: "x" }
    ];
    // Extra is not hard-required, so completeness ties and order decides.
    expect(pipeline([], candidate).removed[0].reason).toBe("duplicate_lost_to_earlier_record");
  });

  it("beats input order — a later, more complete record wins", () => {
    // Completeness only discriminates between two EXCLUDED records: a valid record
    // populates every hard-required field by definition, or recovery would have
    // excluded it. Both records here are excluded; the fuller one still wins.
    const profile: SourceProfile = {
      ...genericProfile,
      hardRequiredFields: ["Id", "Group", "Title", "Owner"]
    };
    const candidate = [
      { Id: "a", Group: "g1", Title: "", Owner: "" },
      { Id: "b", Group: "g1", Title: "t", Owner: "" }
    ];
    const result = pipeline([], candidate, profile);

    expect(result.groups[0].winner.candidateIndex).toBe(1);
    expect(result.removed[0].reason).toBe("duplicate_lost_to_more_complete_record");
    expect(result.removed[0].detail).toContain("3 hard-required fields against the removed record's 2");
  });
});

describe("dedupe: validity outranks everything", () => {
  it("prefers a valid record over one recovery excluded", () => {
    const profile: SourceProfile = { ...genericProfile, hardRequiredFields: ["Id", "Group", "Title"] };
    // First record lacks Title so recovery excludes it; second is valid.
    const candidate = [
      { Id: "a", Group: "g1", Title: "" },
      { Id: "b", Group: "g1", Title: "present" }
    ];
    const result = pipeline([], candidate, profile);

    expect(result.summary.retainedCount).toBe(1);
    expect(result.groups[0].winner.validity).toBe("valid");
    expect(result.removed[0].reason).toBe("duplicate_lost_to_valid_record");
    expect(result.removed[0].removed.validity).toBe("excluded");
  });

  it("wins even when the excluded record came first and is otherwise fuller", () => {
    const profile: SourceProfile = { ...genericProfile, hardRequiredFields: ["Id", "Group", "Title"] };
    const candidate = [
      { Id: "a", Group: "g1", Title: "", Extra: "lots", More: "data" },
      { Id: "b", Group: "g1", Title: "t" }
    ];
    const result = pipeline([], candidate, profile);
    expect(result.groups[0].winner.candidateIndex).toBe(1);
    expect(result.groups[0].winner.validity).toBe("valid");
  });
});

describe("dedupe: candidate-sourced beats reference-recovered", () => {
  const profile: SourceProfile = { ...genericProfile, safeBackfillFields: ["Note"] };

  it("prefers the record that needed no backfill", () => {
    // Reference supplies Note for the record whose Note is blank.
    const reference = [{ Id: "a", Group: "g1", Note: "from reference" }];
    const candidate = [
      { Id: "a", Group: "g1", Note: "" },
      { Id: "b", Group: "g1", Note: "scraped" }
    ];
    const result = pipeline(reference, candidate, profile);

    expect(result.groups[0].winner.containsReferenceDerivedValues).toBe(false);
    expect(result.groups[0].winner.candidateIndex).toBe(1);
    expect(result.removed[0].reason).toBe("duplicate_lost_to_candidate_sourced_record");
    expect(result.removed[0].removed.containsReferenceDerivedValues).toBe(true);
  });

  it("still sees reference-derived values on a record recovery later excluded", () => {
    // Recovery backfills Note, then excludes the record for a missing hard-required
    // Title. The provenance still exists, so the candidate-sourced criterion applies.
    const excludingProfile: SourceProfile = {
      ...genericProfile,
      hardRequiredFields: ["Id", "Group", "Title"],
      safeBackfillFields: ["Note"]
    };
    const reference = [{ Id: "a", Group: "g1", Note: "from reference", Title: "t" }];
    const candidate = [
      { Id: "a", Group: "g1", Note: "", Title: "" },
      { Id: "b", Group: "g1", Note: "", Title: "" }
    ];

    const result = pipeline(reference, candidate, excludingProfile);
    const backfilled = result.groups[0].removed
      .map((entry) => entry.removed)
      .concat(result.groups[0].winner)
      .find((participant) => participant.candidateIndex === 0);

    expect(backfilled?.validity).toBe("excluded");
    expect(backfilled?.containsReferenceDerivedValues).toBe(true);
  });

  it("does not apply when neither record was backfilled", () => {
    const candidate = [
      { Id: "a", Group: "g1", Note: "x" },
      { Id: "b", Group: "g1", Note: "y" }
    ];
    const result = pipeline([], candidate, profile);
    expect(result.removed[0].reason).toBe("duplicate_lost_to_earlier_record");
  });
});

describe("dedupe: blank and unkeyable keys", () => {
  // Group is not hard-required here, so a blank dedupe key does not itself make the
  // record invalid — which is exactly the case worth testing.
  const blankKeyProfile: SourceProfile = { ...genericProfile, hardRequiredFields: ["Id"] };

  it("never groups records whose dedupe key is blank", () => {
    const candidate = [
      { Id: "a", Group: "" },
      { Id: "b", Group: "   " },
      { Id: "c", Group: null }
    ];
    const result = pipeline([], candidate, blankKeyProfile);

    expect(result.summary.unkeyableCount).toBe(3);
    expect(result.summary.duplicateGroupCount).toBe(0);
    expect(result.removed).toHaveLength(0);
  });

  it("retains unkeyable records rather than discarding them", () => {
    const candidate = [{ Id: "a", Group: "" }, rec({ Id: "b", Group: "g1" })];
    const result = pipeline([], candidate, blankKeyProfile);
    expect(result.summary.retainedCount).toBe(2);
  });

  it("does not treat two blank keys as equal to each other", () => {
    // Blank is absence of evidence, not evidence of sameness.
    const candidate = [
      { Id: "a", Group: "" },
      { Id: "b", Group: "" }
    ];
    const result = pipeline([], candidate, blankKeyProfile);
    expect(result.summary.retainedCount).toBe(2);
    expect(result.summary.removedCount).toBe(0);
  });

  it("treats an empty dedupeKey configuration as unkeyable, never as one big group", () => {
    const profile: SourceProfile = { ...genericProfile, dedupeKey: [] };
    const result = pipeline([], [rec({ Id: "a" }), rec({ Id: "b" })], profile);

    expect(result.summary.unkeyableCount).toBe(2);
    expect(result.summary.removedCount).toBe(0);
  });
});

describe("dedupe: nothing disappears silently", () => {
  it("accounts for every participant exactly once", () => {
    const profile: SourceProfile = { ...genericProfile, hardRequiredFields: ["Id", "Group", "Title"] };
    const candidate = [
      { Id: "a", Group: "g1", Title: "t" },
      { Id: "b", Group: "g1", Title: "t" },
      { Id: "c", Group: "g2", Title: "" },
      { Id: "d", Group: "", Title: "t" }
    ];
    const result = pipeline([], candidate, profile);

    expect(result.summary.accountedFor).toBe(true);
    expect(result.summary.retainedCount + result.summary.removedCount + result.summary.carriedExcludedCount).toBe(
      result.summary.participantCount
    );
  });

  it("logs every removal with key, winner, loser, and reason", () => {
    const candidate = [rec({ Id: "a" }), rec({ Id: "b" })];
    const result = pipeline([], candidate);
    const entry = result.removed[0];

    expect(entry.dedupeKey).toBeTruthy();
    expect(entry.winner.candidateIndex).toBe(0);
    expect(entry.removed.candidateIndex).toBe(1);
    expect(entry.reason).toBeTruthy();
    expect(entry.detail).toBeTruthy();
    expect(entry.removed.candidateIndex).toBe(1);
  });

  it("exposes every duplicate group, not just the removals", () => {
    const candidate = [rec({ Id: "a" }), rec({ Id: "b" }), rec({ Id: "c", Group: "g2" })];
    const result = pipeline([], candidate);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].memberCount).toBe(2);
    expect(result.groups[0].removed).toHaveLength(1);
  });

  it("carries recovery exclusions through instead of dropping them", () => {
    const profile: SourceProfile = { ...genericProfile, hardRequiredFields: ["Id", "Group", "Title"] };
    const result = pipeline([], [{ Id: "a", Group: "g1", Title: "" }], profile);

    expect(result.summary.retainedCount).toBe(0);
    expect(result.summary.carriedExcludedCount).toBe(1);
    expect(result.summary.accountedFor).toBe(true);
  });
});

describe("dedupe: determinism", () => {
  it("produces identical output for identical inputs", () => {
    const candidate = [rec({ Id: "a" }), rec({ Id: "b" }), rec({ Id: "c", Group: "g2" })];
    const a = pipeline([], candidate);
    const b = pipeline([], candidate);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("breaks a total tie the same way every time", () => {
    const candidate = [rec({ Id: "a" }), rec({ Id: "a" }), rec({ Id: "a" })];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = pipeline([], candidate);
      expect(result.groups[0].winner.candidateIndex).toBe(0);
      expect(result.removed.map((entry) => entry.removed.candidateIndex)).toEqual([1, 2]);
    }
  });

  it("orders the removal log by input position", () => {
    const candidate = [rec({ Id: "a" }), rec({ Id: "b" }), rec({ Id: "c" }), rec({ Id: "d" })];
    const result = pipeline([], candidate);
    expect(result.removed.map((entry) => entry.removed.candidateIndex)).toEqual([1, 2, 3]);
  });

  it("retains records in stable input order", () => {
    const candidate = [
      rec({ Id: "a", Group: "g1" }),
      rec({ Id: "b", Group: "g2" }),
      rec({ Id: "c", Group: "g3" })
    ];
    const result = pipeline([], candidate);
    expect(result.retained.map((entry) => entry.candidateIndex)).toEqual([0, 1, 2]);
  });
});

describe("dedupe: real Bellingham fixtures", () => {
  const result = pipeline(referenceRecords, candidateRecords, bellinghamProfile);

  it("finds no duplicates — the dedupe key is unique across the export", () => {
    expect(result.summary.participantCount).toBe(500);
    expect(result.summary.duplicateGroupCount).toBe(0);
    expect(result.summary.removedCount).toBe(0);
    expect(result.summary.retainedCount).toBe(500);
  });

  it("keys every record — none fall through as unkeyable", () => {
    expect(result.summary.unkeyableCount).toBe(0);
  });

  it("accounts for every record", () => {
    expect(result.summary.accountedFor).toBe(true);
  });

  it("does not merge the recurring annual solicitations that share a title", () => {
    // 28 title groups exist in the reference, e.g. six "Aluminum Sulfate (Liquid)"
    // procurements spanning 2018-2026. Dedupe keys on AgentID+BidURL, never Title,
    // so these survive as distinct records.
    const aluminium = candidateRecords.filter((record) => record.ProjectCode === "36B-2026");
    expect(aluminium).toHaveLength(1);
    expect(result.summary.retainedCount).toBe(500);
  });

  it("keeps the source-system clone as its own record", () => {
    // 48B-2025-Clone-Clone has its own GUID, so it is a distinct ProcureWare record.
    const retainedIndexes = new Set(result.retained.map((entry) => entry.candidateIndex));
    const cloneIndex = candidateRecords.findIndex((record) => record.ProjectCode === "48B-2025-Clone-Clone");

    expect(cloneIndex).toBeGreaterThanOrEqual(0);
    expect(retainedIndexes.has(cloneIndex)).toBe(true);
  });
});
