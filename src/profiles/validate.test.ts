import { describe, expect, it } from "vitest";
import { validateBase, validateDelta, validateOverrideDelta, type ValidationResult } from "./validate";

const goodQuality = {
  requiredFields: ["ProjectCode"],
  optionalEmptyFields: [],
  emptyRules: { BidDocuments: { allowEmptyArray: true } },
  identityDefault: ["ProjectCode"],
  fieldGroups: [
    {
      id: "g",
      name: "Group",
      fields: ["Title"],
      thresholdDrop: 0.5,
      minAffectedFields: 1,
      severity: "critical",
      narrative: "n"
    }
  ],
  documentFieldPairs: [{ docs: "BidDocuments", hashes: "BidDocumentHashes" }],
  searchSourceFields: { title: "Title", status: "BidStatus", type: "BidType", url: "BidURL" }
};

const goodBase = {
  collectionPath: "Export",
  primaryKey: ["Id"],
  fallbackKeys: [["Code"]],
  dedupeKey: ["Id"],
  hardRequiredFields: ["Id"],
  manualReviewFields: [],
  excludedFields: [],
  minimumMatchRate: 0.95,
  quality: goodQuality
};

const goodDelta = {
  id: "example-source",
  sourceUrl: "https://bids.example.gov",
  version: 1,
  safeBackfillFields: []
};

function problemsOf(result: ValidationResult<unknown>): string {
  return result.ok ? "" : result.problems.join(" ");
}

describe("validateBase", () => {
  it("accepts a complete base", () => {
    expect(validateBase(goodBase)).toEqual({ ok: true, value: goodBase });
  });

  it("requires the shared policy keys and a full quality section", () => {
    const { minimumMatchRate: _dropped, ...withoutRate } = goodBase;
    expect(problemsOf(validateBase(withoutRate))).toContain('missing required key "minimumMatchRate"');

    const { searchSourceFields: _q, ...partialQuality } = goodQuality;
    expect(problemsOf(validateBase({ ...goodBase, quality: partialQuality }))).toContain(
      'quality section is missing required key "searchSourceFields"'
    );
  });

  it("rejects delta-only keys — identity and approvals never live in the base", () => {
    for (const key of ["id", "sourceUrl", "version", "safeBackfillFields", "notes", "detection"]) {
      expect(problemsOf(validateBase({ ...goodBase, [key]: [] }))).toContain(`Unknown key "${key}"`);
    }
  });

  it("rejects non-objects", () => {
    expect(validateBase(null).ok).toBe(false);
    expect(validateBase([goodBase]).ok).toBe(false);
    expect(validateBase("{}").ok).toBe(false);
  });
});

describe("validateDelta", () => {
  it("accepts a minimal delta", () => {
    expect(validateDelta(goodDelta)).toEqual({ ok: true, value: goodDelta });
  });

  it("accepts a delta overriding base policy and quality sub-keys", () => {
    const result = validateDelta({
      ...goodDelta,
      minimumMatchRate: 0.9,
      excludedFields: ["Created"],
      quality: { requiredFields: ["Id"] },
      detection: { urlPrefixes: ["https://bids.example.gov"] }
    });
    expect(result.ok).toBe(true);
  });

  it("requires an explicit safeBackfillFields, even when empty", () => {
    const { safeBackfillFields: _dropped, ...withoutApprovals } = goodDelta;
    const problems = problemsOf(validateDelta(withoutApprovals));
    expect(problems).toContain("safeBackfillFields");
    expect(problems).toContain("[] when no field is approved");
  });

  it("rejects a misspelled key instead of silently granting nothing", () => {
    const problems = problemsOf(validateDelta({ ...goodDelta, safeBackfilFields: ["Title"] }));
    expect(problems).toContain('Unknown key "safeBackfilFields"');
  });

  it("rejects wrong-typed values", () => {
    expect(problemsOf(validateDelta({ ...goodDelta, version: "1" }))).toContain("positive integer");
    expect(problemsOf(validateDelta({ ...goodDelta, version: 0 }))).toContain("positive integer");
    expect(problemsOf(validateDelta({ ...goodDelta, safeBackfillFields: "Title" }))).toContain("string array");
    expect(problemsOf(validateDelta({ ...goodDelta, fallbackKeys: ["Code"] }))).toContain(
      "array of string arrays"
    );
    expect(problemsOf(validateDelta({ ...goodDelta, candidateOnlyPolicy: "drop" }))).toContain(
      'must be "keep" or "exclude"'
    );
  });

  it("rejects an unparseable sourceUrl", () => {
    expect(problemsOf(validateDelta({ ...goodDelta, sourceUrl: "not a url" }))).toContain(
      "does not parse as a URL"
    );
    expect(problemsOf(validateDelta({ ...goodDelta, sourceUrl: "" }))).toContain("non-empty");
  });

  it("validates nested sections and rejects their unknown keys", () => {
    expect(problemsOf(validateDelta({ ...goodDelta, validation: { dateFields: [1] } }))).toContain(
      "validation.dateFields"
    );
    expect(problemsOf(validateDelta({ ...goodDelta, detection: { urlField: ["BidURL"] } }))).toContain(
      'detection has unknown key "urlField"'
    );
    expect(
      problemsOf(validateDelta({ ...goodDelta, quality: { fieldGroups: [{ id: "g" }] } }))
    ).toContain('quality.fieldGroups[0] is missing "name"');
    expect(
      problemsOf(
        validateDelta({
          ...goodDelta,
          quality: { fieldGroups: [{ ...goodQuality.fieldGroups[0], severity: "fatal" }] }
        })
      )
    ).toContain("severity is invalid");
  });
});

describe("validateOverrideDelta", () => {
  it("accepts a policy tweak", () => {
    expect(validateOverrideDelta({ minimumMatchRate: 0.9, safeBackfillFields: [] }).ok).toBe(true);
  });

  it("refuses to re-identify or re-version the profile", () => {
    for (const key of ["id", "sourceUrl", "version"]) {
      expect(problemsOf(validateOverrideDelta({ [key]: "x" }))).toContain(`Unknown key "${key}"`);
    }
  });
});
