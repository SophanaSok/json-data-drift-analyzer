import { describe, expect, it } from "vitest";
import { applyOverridesToRecovery, auditRecoveredRecord, resolveBackfillableFields, runRecovery, type RecoveryResult } from "./recovery";
import { buildRecordProvenance, resolveFieldProvenance } from "./provenance";
import { matchRecords } from "./matchRecords";
import { runRecoveryReview } from "./review";
import { runQa } from "./qa";
import type { SourceProfile } from "./adapter-types";
import { BELLINGHAM_PROCUREWARE } from "../profiles";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const FIXED_NOW = "2026-08-10T00:00:00.000Z";
const RUNS = { generatedAt: FIXED_NOW, sourceRun: "candidate.json", referenceRun: "reference.json" };
const LATER_DECISION = "2026-08-10T02:00:00.000Z";

/** The approved Bellingham policy, loaded from the single source of truth. */
const bellinghamProfile: SourceProfile = BELLINGHAM_PROCUREWARE;

/** Alias retained for readability: the approved contact fields ARE the v2 policy. */
const approvedContactProfile: SourceProfile = bellinghamProfile;

/** The pre-approval v1 policy, kept to prove the gate is what permits backfill. */
const unapprovedProfile: SourceProfile = { ...bellinghamProfile, version: 1, safeBackfillFields: [] };

/** Generic profile — no source-specific field names. */
const genericProfile: SourceProfile = {
  id: "generic-source",
  version: 2,
  collectionPath: "$",
  primaryKey: ["Id"],
  fallbackKeys: [],
  dedupeKey: ["Id"],
  hardRequiredFields: ["Id"],
  safeBackfillFields: ["Note"],
  manualReviewFields: [],
  excludedFields: [],
  minimumMatchRate: 0
};

const rec = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  Id: "a",
  Note: "kept",
  ...overrides
});

function recover(
  reference: Array<Record<string, unknown>>,
  candidate: Array<Record<string, unknown>>,
  profile: SourceProfile = genericProfile,
  options = {}
): RecoveryResult {
  const matchReport = matchRecords(reference, candidate, profile);
  const qa = runQa(reference, candidate, profile, { matchReport, generatedAt: FIXED_NOW });
  return runRecovery(candidate, reference, profile, matchReport, qa.findings, { ...RUNS, ...options });
}

describe("recovery: profile gates which fields may be backfilled", () => {
  it("permits nothing when safeBackfillFields is empty", () => {
    const resolved = resolveBackfillableFields(unapprovedProfile);
    expect(resolved.allowed).toEqual([]);
    expect(resolved.rule6Approved).toEqual([]);
  });

  it("permits exactly the four approved fields at v4", () => {
    const resolved = resolveBackfillableFields(bellinghamProfile);
    expect(resolved.allowed).toEqual(["ContactPhone", "ContactEmail", "BidType", "Title"]);
    // No approval so far has approved a rule 6 field.
    expect(resolved.rule6Approved).toEqual([]);
  });

  it("withholds date-sensitive fields that lack explicit approval", () => {
    const resolved = resolveBackfillableFields(bellinghamProfile);
    expect(resolved.withheld).toEqual(["AwardDate", "BidStatus", "ContractValue", "DueDate", "PublishedDate"]);
  });

  it("treats listing a date-sensitive field in safeBackfillFields as the rule 6 approval", () => {
    const approved: SourceProfile = { ...bellinghamProfile, safeBackfillFields: ["DueDate"] };
    const resolved = resolveBackfillableFields(approved);

    expect(resolved.allowed).toEqual(["DueDate"]);
    expect(resolved.rule6Approved).toEqual(["DueDate"]);
    expect(resolved.withheld).not.toContain("DueDate");
  });

  it("never permits an excluded field, even if also listed as backfillable", () => {
    const conflicting: SourceProfile = { ...genericProfile, safeBackfillFields: ["Note"], excludedFields: ["Note"] };
    expect(resolveBackfillableFields(conflicting).allowed).toEqual([]);
  });
});

describe("recovery: successful safe backfill", () => {
  it("fills a blank candidate field from the matched reference", () => {
    const result = recover([rec({ Note: "from reference" })], [rec({ Note: "" })]);
    const record = result.recovered[0];

    expect(record.record.Note).toBe("from reference");
    expect(record.backfilledFields).toEqual(["Note"]);
    expect(record.containsReferenceDerivedValues).toBe(true);
    expect(result.summary.backfilledFieldCount).toBe(1);
    expect(result.summary.recordsWithBackfill).toBe(1);
  });

  it("fills an absent field as well as a blank one", () => {
    const result = recover([rec({ Note: "v" })], [{ Id: "a" }]);
    expect(result.recovered[0].record.Note).toBe("v");
  });

  it("backfills through a fallback match", () => {
    const profile: SourceProfile = { ...genericProfile, primaryKey: ["Url"], fallbackKeys: [["Id"]] };
    const reference = [{ Id: "a", Url: "https://a.test/1", Note: "v" }];
    const candidate = [{ Id: "a", Url: "https://a.test/2", Note: "" }];

    const result = recover(reference, candidate, profile);
    expect(result.recovered[0].matchStatus).toBe("matched_fallback");
    expect(result.recovered[0].record.Note).toBe("v");
  });

  it("does not backfill from a blank reference value", () => {
    const result = recover([rec({ Note: "" })], [rec({ Note: "" })]);
    expect(result.recovered[0].backfilledFields).toEqual([]);
    expect(result.containsReferenceDerivedValues).toBe(false);
  });

  it("does not backfill a field the profile does not list", () => {
    const result = recover([rec({ Other: "v" })], [rec({ Other: "" })]);
    expect(result.recovered[0].backfilledFields).toEqual([]);
    expect(result.recovered[0].record.Other).toBe("");
  });
});

describe("recovery: never overwrites a non-empty candidate value", () => {
  it("leaves a populated candidate value untouched", () => {
    const result = recover([rec({ Note: "reference" })], [rec({ Note: "candidate" })]);

    expect(result.recovered[0].record.Note).toBe("candidate");
    expect(result.recovered[0].backfilledFields).toEqual([]);
    expect(result.provenance).toHaveLength(0);
  });

  it("treats a placeholder as a value, not a blank — rule 3 protects it", () => {
    const result = recover([rec({ Note: "reference" })], [rec({ Note: "N/A" })]);
    expect(result.recovered[0].record.Note).toBe("N/A");
    expect(result.recovered[0].backfilledFields).toEqual([]);
  });

  it("treats a JSON-encoded empty array as a value, not a blank", () => {
    const result = recover([rec({ Note: '[{"a":1}]' })], [rec({ Note: "[]" })]);
    expect(result.recovered[0].record.Note).toBe("[]");
  });
});

describe("recovery: never backfills ambiguous or unkeyable matches", () => {
  it("excludes an ambiguous match rather than backfilling it", () => {
    const result = recover([rec({ Note: "v" }), rec({ Note: "v" })], [rec({ Note: "" })]);

    expect(result.recovered).toHaveLength(0);
    expect(result.excluded[0].reason).toBe("ambiguous_identity");
    expect(result.excluded[0].detail).toContain("ambiguous_primary");
    expect(result.provenance).toHaveLength(0);
  });

  it("excludes a record that cannot be keyed", () => {
    const result = recover([rec({ Note: "v" })], [{ Id: "   ", Note: "" }]);

    expect(result.recovered).toHaveLength(0);
    expect(result.excluded[0].reason).toBe("invalid_identity");
    expect(result.excluded[0].offendingFields).toContain("Id");
  });

  it("cites the QA findings that justified an unkeyable record's exclusion", () => {
    // An unkeyable record has a null recordKey on both sides, so linking findings by
    // key alone silently yields none — for exactly the record whose exclusion most
    // needs justifying.
    const matchReport = matchRecords([rec({ Note: "v" })], [{ Id: "   ", Note: "" }], genericProfile);
    const qa = runQa([rec({ Note: "v" })], [{ Id: "   ", Note: "" }], genericProfile, {
      matchReport,
      generatedAt: FIXED_NOW
    });
    const result = runRecovery([{ Id: "   ", Note: "" }], [rec({ Note: "v" })], genericProfile, matchReport, qa.findings, RUNS);

    const excluded = result.excluded[0];
    expect(excluded.reason).toBe("invalid_identity");
    expect(excluded.findingIds.length).toBeGreaterThan(0);

    const cited = qa.findings.filter((finding) => excluded.findingIds.includes(finding.id));
    expect(cited.some((finding) => finding.category === "identity_match_issue")).toBe(true);
  });
});

describe("recovery: prohibited date-sensitive fields", () => {
  const reference = [{ Id: "a", Note: "n", DueDate: "8/4/2026 11:00 AM" }];
  const candidate = [{ Id: "a", Note: "n", DueDate: "" }];

  it("refuses a date-sensitive field that is not explicitly approved", () => {
    const profile: SourceProfile = {
      ...genericProfile,
      safeBackfillFields: ["DueDate"],
      dateSensitiveFields: ["DueDate"]
    };
    // Listing it in safeBackfillFields IS the approval, so this variant DOES apply.
    expect(resolveBackfillableFields(profile).allowed).toEqual(["DueDate"]);

    const withheldProfile: SourceProfile = {
      ...genericProfile,
      safeBackfillFields: [],
      dateSensitiveFields: ["DueDate"]
    };
    const result = recover(reference, candidate, withheldProfile);

    expect(result.recovered[0].record.DueDate).toBe("");
    expect(result.recovered[0].backfilledFields).toEqual([]);
    expect(result.summary.dateSensitiveFieldsWithheld).toEqual(["DueDate"]);
  });

  it("records the rule 6 approval in the audit trail when one exists", () => {
    const profile: SourceProfile = {
      ...genericProfile,
      safeBackfillFields: ["DueDate"],
      dateSensitiveFields: ["DueDate"]
    };
    const result = recover(reference, candidate, profile);
    const entry = result.provenance.find((item) => item.field === "DueDate");

    expect(result.recovered[0].record.DueDate).toBe("8/4/2026 11:00 AM");
    expect(entry?.ruleId).toContain("rule6");
    expect(entry?.reason).toContain("rule 6");
  });

  it("withholds every unapproved rule 6 field on the real profile", () => {
    const result = recover(referenceRecords, candidateRecords, bellinghamProfile);
    expect(result.summary.dateSensitiveFieldsWithheld).toEqual([
      "AwardDate",
      "BidStatus",
      "ContractValue",
      "DueDate",
      "PublishedDate"
    ]);
  });
});

describe("recovery: candidate-only record policy", () => {
  const reference = [rec({ Id: "a" })];
  const candidate = [rec({ Id: "a" }), rec({ Id: "b" })];

  it("keeps candidate-only records by default", () => {
    const result = recover(reference, candidate);

    expect(result.candidateOnly).toHaveLength(1);
    expect(result.candidateOnly[0].policy).toBe("keep");
    expect(result.recovered.map((r) => r.candidateIndex)).toContain(1);
    expect(result.summary.excludedByReason.candidate_only_policy).toBe(0);
  });

  it("excludes them when the profile says so", () => {
    const profile: SourceProfile = { ...genericProfile, candidateOnlyPolicy: "exclude" };
    const result = recover(reference, candidate, profile);

    expect(result.candidateOnly[0].policy).toBe("exclude");
    expect(result.summary.excludedByReason.candidate_only_policy).toBe(1);
    expect(result.recovered.map((r) => r.candidateIndex)).not.toContain(1);
  });

  it("never backfills a kept candidate-only record — it has no reference", () => {
    const result = recover(reference, [rec({ Id: "b", Note: "" })]);
    const kept = result.recovered.find((r) => r.candidateIndex === 0);

    expect(kept?.backfilledFields).toEqual([]);
    expect(kept?.record.Note).toBe("");
  });

  it("does not reinstate reference-only records into the artifact", () => {
    const result = recover([rec({ Id: "a" }), rec({ Id: "zzz" })], [rec({ Id: "a" })]);
    const ids = result.recovered.map((r) => r.record.Id);
    expect(ids).not.toContain("zzz");
  });
});

describe("recovery: hard-required exclusion applied after recovery", () => {
  it("excludes a record still missing a required field once recovery is done", () => {
    const profile: SourceProfile = { ...genericProfile, hardRequiredFields: ["Id", "Title"] };
    const result = recover([rec({ Title: "t" })], [rec({ Title: "" })], profile);

    expect(result.recovered).toHaveLength(0);
    expect(result.excluded[0].reason).toBe("hard_required_field_missing");
    expect(result.excluded[0].offendingFields).toEqual(["Title"]);
  });

  it("keeps a record whose required field was repaired by the backfill", () => {
    const profile: SourceProfile = {
      ...genericProfile,
      hardRequiredFields: ["Id", "Title"],
      safeBackfillFields: ["Title"]
    };
    const result = recover([rec({ Title: "t" })], [rec({ Title: "" })], profile);

    expect(result.excluded).toHaveLength(0);
    expect(result.recovered[0].record.Title).toBe("t");
    expect(result.recovered[0].backfilledFields).toEqual(["Title"]);
  });

  it("evaluates the requirement after recovery, not before", () => {
    // Ordering proof: pre-recovery the record fails; post-recovery it passes.
    const profile: SourceProfile = {
      ...genericProfile,
      hardRequiredFields: ["Id", "Title"],
      safeBackfillFields: ["Title"]
    };
    const matchReport = matchRecords([rec({ Title: "t" })], [rec({ Title: "" })], profile);
    const qa = runQa([rec({ Title: "t" })], [rec({ Title: "" })], profile, { matchReport, generatedAt: FIXED_NOW });

    expect(qa.findings.some((f) => f.category === "required_field_missing")).toBe(true);

    const result = runRecovery([rec({ Title: "" })], [rec({ Title: "t" })], profile, matchReport, qa.findings, RUNS);
    expect(result.excluded).toHaveLength(0);
  });
});

describe("recovery: provenance and rule 9", () => {
  it("labels every output value, defaulting unchanged fields to candidate", () => {
    const result = recover([rec({ Note: "from reference" })], [rec({ Note: "" })]);
    const audit = auditRecoveredRecord(result, result.recovered[0].recordKey);

    expect(audit?.fields.Note).toBe("reference_backfill");
    expect(audit?.fields.Id).toBe("candidate");
    expect(audit?.nonCandidateFields).toEqual(["Note"]);
    expect(audit?.containsReferenceDerivedValues).toBe(true);
  });

  it("never presents a reference-derived value as candidate-scraped", () => {
    const result = recover([rec({ Note: "from reference" })], [rec({ Note: "" })]);
    const key = result.recovered[0].recordKey;

    expect(resolveFieldProvenance(key, "Note", result.provenance)).toBe("reference_backfill");
    expect(result.containsReferenceDerivedValues).toBe(true);
  });

  it("reports no reference-derived values when nothing was backfilled", () => {
    const result = recover([rec({ Note: "r" })], [rec({ Note: "c" })]);
    expect(result.containsReferenceDerivedValues).toBe(false);
    expect(auditRecoveredRecord(result, result.recovered[0].recordKey)?.containsReferenceDerivedValues).toBe(false);
  });

  it("carries the full rule 7 audit tuple on every entry", () => {
    const result = recover([rec({ Note: "from reference" })], [rec({ Note: "" })]);
    const entry = result.provenance[0];

    expect(entry.sourceRun).toBe("candidate.json");
    expect(entry.referenceRun).toBe("reference.json");
    expect(entry.matchingKey).toEqual(["Id"]);
    expect(entry.profileId).toBe("generic-source");
    expect(entry.profileVersion).toBe(2);
    expect(entry.timestamp).toBe(FIXED_NOW);
    expect(entry.originalValue).toBe("");
    expect(entry.outputValue).toBe("from reference");
    expect(entry.reason).toBeTruthy();
    expect(entry.matchStatus).toBe("matched_primary");
    expect(entry.actor).toBe("auto");
  });

  it("records a manual override as user-actioned and distinct from backfill", () => {
    const matchReport = matchRecords([rec({ Note: "r" })], [rec({ Note: "c" })], genericProfile);
    const qa = runQa([rec({ Note: "r" })], [rec({ Note: "c" })], genericProfile, { matchReport, generatedAt: FIXED_NOW });
    const key = matchReport.results[0].candidateKey as string;

    const result = runRecovery([rec({ Note: "c" })], [rec({ Note: "r" })], genericProfile, matchReport, qa.findings, {
      ...RUNS,
      manualOverrides: [{ recordKey: key, field: "Note", value: "chosen", reason: "operator decision" }]
    });

    const entry = result.provenance[0];
    expect(result.recovered[0].record.Note).toBe("chosen");
    expect(result.recovered[0].overriddenFields).toEqual(["Note"]);
    expect(entry.source).toBe("manual_override");
    expect(entry.actor).toBe("user");
    expect(entry.reason).toBe("operator decision");
    // A person may overwrite a non-blank value; rule 3 binds automation.
    expect(entry.originalValue).toBe("c");
  });

  it("resolves a field overridden after a backfill to manual_override, not the backfill", () => {
    const profile: SourceProfile = { ...genericProfile, safeBackfillFields: ["Note"] };
    const reference = [rec({ Note: "from reference" })];
    const candidate = [rec({ Note: "" })];

    const matchReport = matchRecords(reference, candidate, profile);
    const qa = runQa(reference, candidate, profile, { matchReport, generatedAt: FIXED_NOW });
    const key = matchReport.results[0].candidateKey as string;

    const result = runRecovery(candidate, reference, profile, matchReport, qa.findings, {
      ...RUNS,
      manualOverrides: [{ recordKey: key, field: "Note", value: "operator value", reason: "operator decision" }]
    });

    // Two events for one field; the later one is what the value actually is.
    expect(result.provenance.filter((entry) => entry.field === "Note")).toHaveLength(2);
    expect(result.recovered[0].record.Note).toBe("operator value");
    expect(resolveFieldProvenance(key, "Note", result.provenance)).toBe("manual_override");
    expect(auditRecoveredRecord(result, key)?.fields.Note).toBe("manual_override");
  });

  it("records the key that actually produced the pairing, not always the primary key", () => {
    const profile: SourceProfile = {
      ...genericProfile,
      primaryKey: ["Url"],
      fallbackKeys: [["Id"]],
      safeBackfillFields: ["Note"]
    };
    const reference = [{ Id: "a", Url: "https://a.test/1", Note: "v" }];
    const candidate = [{ Id: "a", Url: "https://a.test/2", Note: "" }];

    const matchReport = matchRecords(reference, candidate, profile);
    const qa = runQa(reference, candidate, profile, { matchReport, generatedAt: FIXED_NOW });
    const result = runRecovery(candidate, reference, profile, matchReport, qa.findings, RUNS);

    expect(result.recovered[0].matchStatus).toBe("matched_fallback");
    expect(result.provenance[0].matchingKey).toEqual(["Id"]);
  });

  it("refuses a manual override with a blank reason", () => {
    const matchReport = matchRecords([rec()], [rec()], genericProfile);
    const qa = runQa([rec()], [rec()], genericProfile, { matchReport, generatedAt: FIXED_NOW });
    const key = matchReport.results[0].candidateKey as string;

    expect(() =>
      runRecovery([rec()], [rec()], genericProfile, matchReport, qa.findings, {
        ...RUNS,
        manualOverrides: [{ recordKey: key, field: "Note", value: "x", reason: "   " }]
      })
    ).toThrow(/reason is required/);
  });

  it("builds a total field map for a record", () => {
    const result = recover([rec({ Note: "from reference" })], [rec({ Note: "" })]);
    const record = result.recovered[0];
    const provenance = buildRecordProvenance(record.recordKey, record.record, result.provenance);

    expect(Object.keys(provenance.fields).sort()).toEqual(Object.keys(record.record).sort());
  });
});

describe("recovery: immutability", () => {
  it("does not mutate the candidate or reference inputs", () => {
    const reference = [rec({ Note: "from reference" })];
    const candidate = [rec({ Note: "" })];
    const before = JSON.stringify([reference, candidate]);

    recover(reference, candidate);

    expect(JSON.stringify([reference, candidate])).toBe(before);
  });

  it("returns records that share no structure with the inputs", () => {
    const candidate = [rec({ Nested: { a: 1 } })];
    const result = recover([rec({ Note: "v" })], candidate);

    expect(result.recovered[0].record).not.toBe(candidate[0]);
    expect(result.recovered[0].record.Nested).not.toBe(candidate[0].Nested);

    (result.recovered[0].record.Nested as { a: number }).a = 99;
    expect((candidate[0].Nested as { a: number }).a).toBe(1);
  });
});

describe("recovery: determinism", () => {
  it("produces identical output for identical inputs", () => {
    const a = recover([rec({ Note: "from reference" })], [rec({ Note: "" })]);
    const b = recover([rec({ Note: "from reference" })], [rec({ Note: "" })]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is deterministic on the real fixtures", () => {
    const a = recover(referenceRecords, candidateRecords, approvedContactProfile);
    const b = recover(referenceRecords, candidateRecords, approvedContactProfile);
    expect(JSON.stringify(a.summary)).toBe(JSON.stringify(b.summary));
    expect(a.provenance.map((e) => `${e.recordKey}|${e.field}`)).toEqual(
      b.provenance.map((e) => `${e.recordKey}|${e.field}`)
    );
  });

  it("orders backfilled fields independently of profile listing order", () => {
    const forward: SourceProfile = { ...bellinghamProfile, safeBackfillFields: ["ContactPhone", "ContactEmail"] };
    const reversed: SourceProfile = { ...bellinghamProfile, safeBackfillFields: ["ContactEmail", "ContactPhone"] };

    const a = recover(referenceRecords, candidateRecords, forward);
    const b = recover(referenceRecords, candidateRecords, reversed);
    expect(a.provenance.map((e) => `${e.recordKey}|${e.field}`)).toEqual(
      b.provenance.map((e) => `${e.recordKey}|${e.field}`)
    );
  });
});

describe("recovery: real Bellingham fixtures", () => {
  it("backfills nothing under the pre-approval v1 policy", () => {
    // The gate, not the data, is what permits recovery: same inputs, no approval.
    const result = recover(referenceRecords, candidateRecords, unapprovedProfile);

    expect(result.summary.backfillableFields).toEqual([]);
    expect(result.summary.backfilledFieldCount).toBe(0);
    expect(result.containsReferenceDerivedValues).toBe(false);
    expect(result.provenance).toHaveLength(0);
    // The artifact is still produced: 500 candidate records, none excluded.
    expect(result.summary.recoveredCount).toBe(500);
    expect(result.summary.excludedCount).toBe(0);
  });

  it("recovers exactly the approved fields at v4", () => {
    const result = recover(referenceRecords, candidateRecords, bellinghamProfile);

    expect(result.summary.backfillableFields).toEqual(["ContactPhone", "ContactEmail", "BidType", "Title"]);
    // 499 Title + 495 BidType + 242 ContactEmail + 171 ContactPhone.
    expect(result.summary.backfilledFieldCount).toBe(1407);
    expect(result.containsReferenceDerivedValues).toBe(true);
    expect(result.summary.recoveredCount).toBe(500);
    expect(result.summary.excludedCount).toBe(0);
  });

  it("stamps the approving profile version on every provenance entry", () => {
    // Rule 7: a decision audited under v1 was made under a policy permitting no
    // backfill at all, and is not valid under v2.
    const result = recover(referenceRecords, candidateRecords, bellinghamProfile);
    for (const entry of result.provenance) {
      expect(entry.profileVersion).toBe(bellinghamProfile.version);
    }
  });

  it("copies each matched record's own value, never a modal one", () => {
    // The single purchasing@cob.org record must not be rewritten to bids@cob.org.
    const result = recover(referenceRecords, candidateRecords, bellinghamProfile);
    const emails = new Set(
      result.provenance.filter((entry) => entry.field === "ContactEmail").map((entry) => String(entry.outputValue))
    );

    expect(emails.size).toBeGreaterThan(1);
    expect(emails).toContain("purchasing@cob.org");
  });

  it("keeps the one candidate-only record under the default policy", () => {
    const result = recover(referenceRecords, candidateRecords, bellinghamProfile);
    expect(result.summary.candidateOnlyCount).toBe(1);
    expect(result.summary.recoveredCount).toBe(500);
  });

  it("recovers each approved field for exactly the records that lost it", () => {
    const result = recover(referenceRecords, candidateRecords, approvedContactProfile);

    const byField = new Map<string, number>();
    for (const entry of result.provenance) {
      byField.set(entry.field, (byField.get(entry.field) ?? 0) + 1);
    }

    // Matches the per-field regression counts in the forensic report exactly.
    expect(byField.get("ContactEmail")).toBe(242);
    expect(byField.get("ContactPhone")).toBe(171);
    expect(byField.get("BidType")).toBe(495);
    expect(byField.get("Title")).toBe(499);
    expect(result.summary.backfilledFieldCount).toBe(1407);
    expect(result.containsReferenceDerivedValues).toBe(true);
  });

  it("leaves every unapproved regressed field untouched", () => {
    const result = recover(referenceRecords, candidateRecords, approvedContactProfile);
    const touched = new Set(result.provenance.map((entry) => entry.field));

    // The rule 6 fields remain unrecovered at v4.
    for (const field of ["BidStatus", "PublishedDate", "DueDate", "AwardDate"]) {
      expect(touched.has(field), `${field} must not be recovered`).toBe(false);
    }
  });

  it("marks every backfilled value as reference-derived, never candidate", () => {
    const result = recover(referenceRecords, candidateRecords, approvedContactProfile);
    for (const entry of result.provenance) {
      expect(entry.source).toBe("reference_backfill");
      expect(entry.actor).toBe("auto");
      expect(entry.matchStatus).toBe("matched_primary");
    }
  });
});

describe("recovery: applying overrides to a finished result", () => {
  // The review UI holds a finished RecoveryResult but not the raw record arrays, so
  // recorded decisions are applied post-hoc. These tests prove the applied artifact
  // and its audit trail move together — the decision log and the export can never
  // silently disagree.
  const baseResult = () => recover([rec({ Note: "from reference" })], [rec({ Note: "" })]);
  const key = () => baseResult().recovered[0].recordKey;

  it("applies an override to the recovered record with full provenance", () => {
    const result = baseResult();
    const applied = applyOverridesToRecovery(
      result,
      [{ recordKey: key(), field: "Note", value: "operator value", reason: "operator decision", timestamp: LATER_DECISION }],
      genericProfile
    );

    expect(applied.appliedCount).toBe(1);
    expect(applied.unapplied).toEqual([]);

    const record = applied.recovery.recovered[0];
    expect(record.record.Note).toBe("operator value");
    expect(record.overriddenFields).toEqual(["Note"]);
    expect(applied.recovery.summary.overriddenFieldCount).toBe(1);

    const entry = applied.recovery.provenance.find((item) => item.source === "manual_override");
    expect(entry?.actor).toBe("user");
    expect(entry?.reason).toBe("operator decision");
    expect(entry?.outputValue).toBe("operator value");
    // The decision's own time, not the analysis time.
    expect(entry?.timestamp).toBe(LATER_DECISION);
  });

  it("does not mutate the input result", () => {
    const result = baseResult();
    const before = JSON.stringify(result);
    applyOverridesToRecovery(
      result,
      [{ recordKey: key(), field: "Note", value: "changed", reason: "r" }],
      genericProfile
    );
    expect(JSON.stringify(result)).toBe(before);
  });

  it("reports an override addressing no recovered record instead of dropping it", () => {
    const applied = applyOverridesToRecovery(
      baseResult(),
      [{ recordKey: "no-such-key", field: "Note", value: "x", reason: "r" }],
      genericProfile
    );

    expect(applied.appliedCount).toBe(0);
    expect(applied.unapplied).toHaveLength(1);
    expect(applied.unapplied[0].reason).toMatch(/No recovered record/);
    expect(applied.recovery.unappliedOverrides).toHaveLength(1);
  });

  it("refuses an override that would blank a hard-required field", () => {
    const applied = applyOverridesToRecovery(
      baseResult(),
      [{ recordKey: key(), field: "Id", value: "", reason: "r" }],
      genericProfile
    );

    expect(applied.appliedCount).toBe(0);
    expect(applied.unapplied[0].reason).toMatch(/hard-required/);
    expect(applied.recovery.recovered[0].record.Id).toBe("a");
  });

  it("refuses an override with a blank reason", () => {
    expect(() =>
      applyOverridesToRecovery(baseResult(), [{ recordKey: key(), field: "Note", value: "x", reason: " " }], genericProfile)
    ).toThrow(/reason is required/);
  });

  it("refuses to apply decisions resolved under a different profile version", () => {
    expect(() =>
      applyOverridesToRecovery(
        baseResult(),
        [{ recordKey: key(), field: "Note", value: "x", reason: "r" }],
        { ...genericProfile, version: genericProfile.version + 1 }
      )
    ).toThrow(/Re-run the analysis/);
  });
});

describe("recovery: no backfill from an ambiguous fallback group", () => {
  it("excludes the record instead of backfilling from the leftover sibling", () => {
    // Two references share the fallback key; one is claimed by a primary match.
    // The masked version of this used to pair the second candidate with the
    // leftover sibling and backfill Note from it.
    const profile: SourceProfile = {
      ...genericProfile,
      primaryKey: ["Url"],
      fallbackKeys: [["Id"]],
      hardRequiredFields: []
    };
    const reference = [
      { Id: "k", Url: "https://a.test/1", Note: "original" },
      { Id: "k", Url: "https://a.test/2", Note: "sibling" }
    ];
    const candidate = [
      { Id: "k", Url: "https://a.test/1", Note: "kept" },
      { Id: "k", Url: "https://a.test/3", Note: "" }
    ];

    const result = recover(reference, candidate, profile);

    const excluded = result.excluded.find((entry) => entry.candidateIndex === 1);
    expect(excluded?.reason).toBe("ambiguous_identity");
    expect(result.summary.backfilledFieldCount).toBe(0);
    // Nothing in the artifact carries the sibling's value.
    expect(result.recovered.every((entry) => entry.record.Note !== "sibling")).toBe(true);
  });
});

describe("recovery: findings lookup stays fast and complete at scale", () => {
  it("links an ambiguous-fallback exclusion to its finding through the fallback key", () => {
    // The finding for an ambiguous fallback carries the FALLBACK key, while the
    // record's identity is its primary key — the lookup must match on both, and
    // the grouped index must preserve that behaviour.
    const profile: SourceProfile = {
      ...genericProfile,
      primaryKey: ["Url"],
      fallbackKeys: [["Id"]],
      hardRequiredFields: []
    };
    const reference = [
      { Id: "k", Url: "https://a.test/1", Note: "original" },
      { Id: "k", Url: "https://a.test/2", Note: "sibling" }
    ];
    const candidate = [
      { Id: "k", Url: "https://a.test/1", Note: "kept" },
      { Id: "k", Url: "https://a.test/3", Note: "" }
    ];

    const matchReport = matchRecords(reference, candidate, profile);
    const qa = runQa(reference, candidate, profile, { matchReport, generatedAt: FIXED_NOW });
    const result = runRecovery(candidate, reference, profile, matchReport, qa.findings, RUNS);

    const excluded = result.excluded.find((entry) => entry.reason === "ambiguous_identity")!;
    const ambiguityFindingIds = qa.findings
      .filter((finding) => finding.category === "identity_match_issue")
      .map((finding) => finding.id);

    expect(ambiguityFindingIds.length).toBeGreaterThan(0);
    // The exclusion cites the ambiguity finding — plus everything else QA knows
    // about the colliding key, such as the duplicate-key findings.
    expect(excluded.findingIds).toEqual(expect.arrayContaining(ambiguityFindingIds));
  });

  it("processes 8,000 fully-regressed records well under the old quadratic time", () => {
    // Coarse tripwire, deliberately generous: the per-record findings lookup used
    // to filter the full findings array once per record — O(records x findings),
    // ~4.7s for this input on a fast dev machine and far worse on slower ones.
    // The grouped index runs it in well under a second there, but on a slow
    // machine with the full suite running in parallel the linear path has been
    // measured at ~3.6s wall — so the bound is 6s: still several times under
    // what the quadratic version costs in the same conditions, without flaking
    // on contention.
    const size = 8000;
    const record = (index: number, blank: boolean): Record<string, unknown> => ({
      AgentID: "1431",
      ProjectCode: `${index}B-2026`,
      BidURL: `https://cob.procureware.com/Bids/${index}`,
      Title: blank ? "" : `Project ${index}`,
      BidType: blank ? "" : "RFP",
      BidStatus: blank ? "" : "Awarded",
      DueDate: blank ? "" : "7/29/2026",
      PublishedDate: blank ? "" : "1/1/2026",
      AwardDate: blank ? "" : "8/1/2026",
      ContactEmail: blank ? "" : "bids@cob.org",
      ContactPhone: blank ? "" : "(360) 778-7750"
    });
    const reference = Array.from({ length: size }, (_, index) => record(index, false));
    const candidate = Array.from({ length: size }, (_, index) => record(index, true));

    const started = performance.now();
    const review = runRecoveryReview(reference, candidate, bellinghamProfile, { generatedAt: FIXED_NOW });
    const elapsed = performance.now() - started;

    expect(review.recovery.recovered).toHaveLength(size);
    // A fully-regressed run is exactly the systemic-loss case, so per-record
    // regression findings arrive as capped exemplar samples (500 per wiped
    // field) rather than one object per cell — the pre-sampling behavior put
    // ~64k finding objects in this array and OOMed a tab at 100k records. The
    // exact totals live on the systemic findings.
    const systemic = review.qa.findings.filter((finding) => finding.category === "systemic_field_regression");
    expect(systemic.length).toBe(8);
    for (const finding of systemic) {
      expect(finding.evidence.regressed).toBe(size);
    }
    const regressions = review.qa.findings.filter((finding) => finding.category === "field_regression");
    expect(regressions.length).toBe(8 * 500);
    expect(elapsed).toBeLessThan(6000);
  });
});
