/**
 * Unit tests for the source loader and adapter types.
 *
 * Tests verify:
 * - Both Bellingham fixture files parse correctly
 * - Record path ($.Export) is correctly located
 * - Profile identity fields exist where expected
 * - Blank vs absent vs whitespace-only values are distinguished
 * - The two blankness policies diverge exactly where documented
 */

import { describe, expect, it } from "vitest";
import {
  analyzeBlankValue,
  classifyFieldValue,
  inspectRecordsPath,
  isBackfillEligibleField,
  isBackfillEligibleValue,
  loadFixtureFromText,
  parseJSON,
  stripBOM,
  validateIdentityFields,
  verifyIdentityFieldsExist
} from "./fixture-loader";
import type { SourceProfile } from "./adapter-types";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";
import referenceRaw from "../test/fixtures/bellingham-reference.json?raw";
import candidateRaw from "../test/fixtures/bellingham-candidate.json?raw";

const reference = referenceData as unknown as Record<string, unknown>;
const candidate = candidateData as unknown as Record<string, unknown>;
const referenceRecords = reference.Export as Array<Record<string, unknown>>;
const candidateRecords = candidate.Export as Array<Record<string, unknown>>;

// Sample Bellingham ProcureWare profile (derived from bellingham-source-profile.proposed.json)
const bellinghamProfile: SourceProfile = {
  id: "bellingham-procureware",
  version: 1,
  collectionPath: "Export",
  primaryKey: ["AgentID", "BidURL"],
  fallbackKeys: [["AgentID", "ProjectCode"]],
  dedupeKey: ["AgentID", "BidURL"],
  hardRequiredFields: ["AgentID", "ProjectCode", "BidURL"],
  safeBackfillFields: [],
  manualReviewFields: [
    "Title",
    "BidStatus",
    "BidType",
    "PublishedDate",
    "DueDate",
    "AwardDate",
    "ContactEmail",
    "ContactPhone",
    "Description",
    "BidDocuments",
    "BidDocumentHashes",
    "ContractValue"
  ],
  excludedFields: ["Created", "Refreshed"],
  minimumMatchRate: 0.95
};

describe("fixture-loader: BOM handling", () => {
  it("detects and strips UTF-8 BOM", () => {
    const contentWithBOM = '﻿{"Export": []}';
    const result = stripBOM(contentWithBOM);
    expect(result.bomStripped).toBe(true);
    expect(result.content).toBe('{"Export": []}');
  });

  it("leaves content unchanged when no BOM present", () => {
    const contentWithoutBOM = '{"Export": []}';
    const result = stripBOM(contentWithoutBOM);
    expect(result.bomStripped).toBe(false);
    expect(result.content).toBe(contentWithoutBOM);
  });

  it("parses JSON with BOM successfully", () => {
    const contentWithBOM = '﻿{"Export": [{"ProjectCode": "TEST-001"}]}';
    const result = parseJSON(contentWithBOM, "test-file.json");
    expect(result.success).toBe(true);
    expect(result.bomStripped).toBe(true);
    expect(result.dataset?.Export).toHaveLength(1);
  });

  it("reports parse errors gracefully", () => {
    const invalidJSON = '{"Export": invalid}';
    const result = parseJSON(invalidJSON, "invalid.json");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unexpected token");
    expect(result.source).toBe("invalid.json");
    expect(result.bomStripped).toBe(false);
  });

  it("reports bomStripped accurately when parsing fails after stripping a BOM", () => {
    // "BOM removed but JSON still invalid" must be distinguishable from "no BOM";
    // they point at different problems in the export pipeline.
    const bomThenInvalid = '﻿{"Export": invalid}';
    const result = parseJSON(bomThenInvalid, "bom-invalid.json");

    expect(result.success).toBe(false);
    expect(result.bomStripped).toBe(true);
    expect(result.error).toContain("Unexpected token");
  });
});

describe("fixture-loader: real source files carry a BOM", () => {
  // Regression guard: both real exports begin with U+FEFF, which is why a bare
  // JSON.parse on the uploaded text fails. See docs/forensic-bellingham-report.md.
  it("both fixture files start with a UTF-8 BOM", () => {
    expect(referenceRaw.charCodeAt(0)).toBe(0xfeff);
    expect(candidateRaw.charCodeAt(0)).toBe(0xfeff);
  });

  it("a bare JSON.parse rejects the real file text", () => {
    expect(() => JSON.parse(referenceRaw)).toThrow();
    expect(() => JSON.parse(candidateRaw)).toThrow();
  });

  it("loadFixtureFromText recovers both real files", () => {
    const ref = loadFixtureFromText(referenceRaw, "bellingham-reference.json");
    const cand = loadFixtureFromText(candidateRaw, "bellingham-candidate.json");

    expect(ref.success).toBe(true);
    expect(ref.bomStripped).toBe(true);
    expect(ref.dataset?.Export).toHaveLength(500);

    expect(cand.success).toBe(true);
    expect(cand.bomStripped).toBe(true);
    expect(cand.dataset?.Export).toHaveLength(500);
  });
});

describe("fixture-loader: Bellingham fixtures parse", () => {
  it("parses bellingham-reference.json fixture", () => {
    expect(reference.Export).toBeDefined();
    expect(Array.isArray(reference.Export)).toBe(true);
    expect(referenceRecords.length).toBeGreaterThan(0);
  });

  it("parses bellingham-candidate.json fixture", () => {
    expect(candidate.Export).toBeDefined();
    expect(Array.isArray(candidate.Export)).toBe(true);
    expect(candidateRecords.length).toBeGreaterThan(0);
  });

  it("both fixtures have Export array at root level", () => {
    expect(Object.keys(reference)).toEqual(["Export"]);
    expect(Object.keys(candidate)).toEqual(["Export"]);
  });
});

describe("fixture-loader: record path location", () => {
  it("locates $.Export path in Bellingham reference data", () => {
    const result = inspectRecordsPath(reference, bellinghamProfile);

    expect(result.success).toBe(true);
    expect(result.pathInfo?.path).toBe("$.Export");
    expect(result.pathInfo?.found).toBe(true);
    expect(result.pathInfo?.records).toHaveLength(500);
  });

  it("locates $.Export path in Bellingham candidate data", () => {
    const result = inspectRecordsPath(candidate, bellinghamProfile);

    expect(result.success).toBe(true);
    expect(result.pathInfo?.path).toBe("$.Export");
    expect(result.pathInfo?.found).toBe(true);
    expect(result.pathInfo?.records).toHaveLength(500);
  });

  it("resolves whatever path the profile declares", () => {
    const otherProfile: SourceProfile = { ...bellinghamProfile, id: "other-source", collectionPath: "Records" };
    const alternativeDataset = { Records: [{ id: "1" }, { id: "2" }] };
    const result = inspectRecordsPath(alternativeDataset, otherProfile);

    expect(result.success).toBe(true);
    expect(result.pathInfo?.path).toBe("$.Records");
    expect(result.pathInfo?.records).toHaveLength(2);
  });

  it("supports $ for a root-level records array", () => {
    const rootArrayProfile: SourceProfile = { ...bellinghamProfile, collectionPath: "$" };
    const rootArrayDataset = [{ id: "1" }, { id: "2" }, { id: "3" }] as unknown as Record<string, unknown>;
    const result = inspectRecordsPath(rootArrayDataset, rootArrayProfile);

    expect(result.success).toBe(true);
    expect(result.pathInfo?.path).toBe("$");
    expect(result.pathInfo?.records).toHaveLength(3);
  });

  it("never guesses a path the profile did not declare", () => {
    // A root array exists under a different key. Older behaviour picked it up
    // automatically; that inferred a source schema, which AGENTS.md rule 1 forbids.
    const alternativeDataset = { Records: [{ id: "1" }, { id: "2" }] };
    const result = inspectRecordsPath(alternativeDataset, bellinghamProfile);

    expect(result.success).toBe(false);
    expect(result.error).toContain("No records array at 'Export'");
    expect(result.error).toContain("Records");
  });

  it("filters non-object elements out of the records array", () => {
    const messyDataset = { Export: [{ id: "1" }, "not-a-record", null, 42, { id: "2" }] };
    const result = inspectRecordsPath(messyDataset, bellinghamProfile);

    expect(result.success).toBe(true);
    expect(result.pathInfo?.records).toHaveLength(2);
  });

  it("reports the declared path and available root keys when no array is found", () => {
    const invalidDataset = { Metadata: { version: "1.0" } };
    const result = inspectRecordsPath(invalidDataset, bellinghamProfile);

    expect(result.success).toBe(false);
    expect(result.error).toContain("No records array at 'Export'");
    expect(result.error).toContain("bellingham-procureware");
    expect(result.error).toContain("Metadata");
  });

  it("resolves an empty declared array as success with zero records", () => {
    const emptyDataset = { Export: [] };
    const result = inspectRecordsPath(emptyDataset, bellinghamProfile);

    expect(result.success).toBe(true);
    expect(result.pathInfo?.records).toHaveLength(0);
  });
});

describe("fixture-loader: identity fields", () => {
  it("verifies AgentID and BidURL exist in all Bellingham reference records", () => {
    const result = verifyIdentityFieldsExist(referenceRecords, bellinghamProfile);

    expect(result.allPresent).toBe(true);
    expect(result.fieldPresence.AgentID.present).toBe(500);
    expect(result.fieldPresence.AgentID.missing).toBe(0);
    expect(result.fieldPresence.BidURL.present).toBe(500);
    expect(result.fieldPresence.BidURL.missing).toBe(0);
  });

  it("verifies AgentID and BidURL exist in all Bellingham candidate records", () => {
    const result = verifyIdentityFieldsExist(candidateRecords, bellinghamProfile);

    expect(result.allPresent).toBe(true);
    expect(result.fieldPresence.AgentID.present).toBe(500);
    expect(result.fieldPresence.AgentID.missing).toBe(0);
    expect(result.fieldPresence.BidURL.present).toBe(500);
    expect(result.fieldPresence.BidURL.missing).toBe(0);
  });

  it("validates identity fields on individual records", () => {
    const validRecord = { AgentID: "1431", BidURL: "https://example.com/bid/123" };
    const result = validateIdentityFields(validRecord, bellinghamProfile);

    expect(result.valid).toBe(true);
    expect(result.missingFields).toHaveLength(0);
    expect(result.blankFields).toHaveLength(0);
  });

  it("detects missing identity fields", () => {
    const incompleteRecord = { AgentID: "1431" }; // Missing BidURL
    const result = validateIdentityFields(incompleteRecord, bellinghamProfile);

    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain("BidURL");
  });

  it("detects blank identity fields", () => {
    const blankRecord = { AgentID: "1431", BidURL: "" };
    const result = validateIdentityFields(blankRecord, bellinghamProfile);

    expect(result.valid).toBe(false);
    expect(result.blankFields).toContain("BidURL");
  });

  it("treats a placeholder identity value as present (strict policy, documented)", () => {
    // Deliberate: identity validation uses strict blankness, so "-" is a value.
    // If placeholder identities should be rejected, that needs an explicit profile rule.
    const placeholderRecord = { AgentID: "1431", BidURL: "-" };
    const result = validateIdentityFields(placeholderRecord, bellinghamProfile);

    expect(result.valid).toBe(true);
    expect(result.blankFields).toHaveLength(0);
  });
});

describe("fixture-loader: blankness policies diverge as documented", () => {
  const placeholderRecord = { Title: "N/A" };
  const emptyArrayRecord = { Documents: [] };

  it("classifies a placeholder as blank under with-placeholders, present under strict", () => {
    expect(classifyFieldValue(placeholderRecord, "Title")).toBe("blank");
    expect(classifyFieldValue(placeholderRecord, "Title", { policy: "with-placeholders" })).toBe("blank");
    expect(classifyFieldValue(placeholderRecord, "Title", { policy: "strict" })).toBe("present");
  });

  it("classifies an empty array as blank under with-placeholders, present under strict", () => {
    expect(classifyFieldValue(emptyArrayRecord, "Documents")).toBe("blank");
    expect(classifyFieldValue(emptyArrayRecord, "Documents", { policy: "strict" })).toBe("present");
  });

  it("honours field-level empty rules under with-placeholders", () => {
    expect(classifyFieldValue(emptyArrayRecord, "Documents", { rule: { allowEmptyArray: true } })).toBe("present");
  });

  it("agrees on null, empty string, and whitespace-only under both policies", () => {
    for (const policy of ["strict", "with-placeholders"] as const) {
      expect(classifyFieldValue({ Title: null }, "Title", { policy })).toBe("blank");
      expect(classifyFieldValue({ Title: "" }, "Title", { policy })).toBe("blank");
      expect(classifyFieldValue({ Title: "   " }, "Title", { policy })).toBe("blank");
      expect(classifyFieldValue({ Title: "Real" }, "Title", { policy })).toBe("present");
      expect(classifyFieldValue({ Title: "Real" }, "Missing", { policy })).toBe("missing");
    }
  });
});

describe("fixture-loader: rule 4 backfill eligibility gate", () => {
  it("treats null, undefined, empty, and whitespace-only as eligible", () => {
    expect(isBackfillEligibleValue(null)).toBe(true);
    expect(isBackfillEligibleValue(undefined)).toBe(true);
    expect(isBackfillEligibleValue("")).toBe(true);
    expect(isBackfillEligibleValue("   ")).toBe(true);
    expect(isBackfillEligibleValue("\t\n")).toBe(true);
  });

  it("treats an absent key as eligible", () => {
    expect(isBackfillEligibleField({}, "Title")).toBe(true);
    expect(isBackfillEligibleField({ Title: "" }, "Title")).toBe(true);
  });

  it("refuses placeholders — rule 3 protects published values from auto-overwrite", () => {
    for (const placeholder of ["n/a", "N/A", "none", "unknown", "-", "NA"]) {
      expect(isBackfillEligibleValue(placeholder), `${placeholder} must not be auto-backfillable`).toBe(false);
    }
  });

  it("refuses the JSON-in-string empty array used by this source", () => {
    // Candidate BidDocuments of "[]" is a non-blank string. Records 15B-2021 and
    // 7B-2026 lost their document arrays this way and are review-only, not backfillable.
    expect(isBackfillEligibleValue("[]")).toBe(false);
    expect(isBackfillEligibleField({ BidDocuments: "[]" }, "BidDocuments")).toBe(false);
  });

  it("refuses any real value", () => {
    expect(isBackfillEligibleValue("Cordata Park Phase 2")).toBe(false);
    expect(isBackfillEligibleValue(0)).toBe(false);
    expect(isBackfillEligibleValue(false)).toBe(false);
    expect(isBackfillEligibleValue([])).toBe(false);
  });

  it("disagrees with the reporting policy exactly where documented", () => {
    const record = { Title: "N/A" };
    expect(classifyFieldValue(record, "Title")).toBe("blank");
    expect(isBackfillEligibleField(record, "Title")).toBe(false);
  });

  it("marks all 500 candidate records eligible for each of the eight regressed fields", () => {
    const regressed = [
      "Title",
      "BidStatus",
      "BidType",
      "PublishedDate",
      "DueDate",
      "AwardDate",
      "ContactEmail",
      "ContactPhone"
    ];

    for (const field of regressed) {
      const eligible = candidateRecords.filter((r) => isBackfillEligibleField(r, field));
      expect(eligible, `${field} should be backfill-eligible in all candidate records`).toHaveLength(500);
    }
  });

  it("marks identity and document fields ineligible across the candidate set", () => {
    for (const field of ["AgentID", "BidURL", "ProjectCode", "BidDocuments", "BidDocumentHashes"]) {
      const eligible = candidateRecords.filter((r) => isBackfillEligibleField(r, field));
      expect(eligible, `${field} should never be backfill-eligible`).toHaveLength(0);
    }
  });
});

describe("fixture-loader: field value state classification", () => {
  it("classifies present values correctly", () => {
    const record = { Title: "Test Project", BidStatus: "Open" };

    expect(classifyFieldValue(record, "Title")).toBe("present");
    expect(classifyFieldValue(record, "BidStatus")).toBe("present");
    expect(classifyFieldValue(record, "NonExistent")).toBe("missing");
  });

  it("classifies missing fields", () => {
    const record = { Title: "Test" };
    expect(classifyFieldValue(record, "NonExistent")).toBe("missing");
  });

  it("classifies null as blank", () => {
    const record = { Title: null };
    expect(classifyFieldValue(record, "Title")).toBe("blank");
  });

  it("classifies empty string as blank", () => {
    const record = { Title: "" };
    expect(classifyFieldValue(record, "Title")).toBe("blank");
  });

  it("classifies whitespace-only string as blank", () => {
    const record = { Title: "   ", Description: "\t\n" };
    expect(classifyFieldValue(record, "Title")).toBe("blank");
    expect(classifyFieldValue(record, "Description")).toBe("blank");
  });

  it("classifies placeholder values as blank", () => {
    const record = {
      Title: "n/a",
      Description: "N/A",
      Status: "none",
      Notes: "unknown",
      Code: "-"
    };

    expect(classifyFieldValue(record, "Title")).toBe("blank");
    expect(classifyFieldValue(record, "Description")).toBe("blank");
    expect(classifyFieldValue(record, "Status")).toBe("blank");
    expect(classifyFieldValue(record, "Notes")).toBe("blank");
    expect(classifyFieldValue(record, "Code")).toBe("blank");
  });

  it("classifies empty array as blank", () => {
    const record = { Documents: [] };
    expect(classifyFieldValue(record, "Documents")).toBe("blank");
  });

  it("classifies non-empty array as present", () => {
    const record = { Documents: [{ title: "Spec.pdf" }] };
    expect(classifyFieldValue(record, "Documents")).toBe("present");
  });
});

describe("fixture-loader: blank value subtype analysis", () => {
  it("distinguishes null from undefined", () => {
    expect(analyzeBlankValue(null)).toEqual({ isBlank: true, subtype: "null" });
    expect(analyzeBlankValue(undefined)).toEqual({ isBlank: true, subtype: "undefined" });
  });

  it("distinguishes empty string from whitespace-only", () => {
    expect(analyzeBlankValue("")).toEqual({ isBlank: true, subtype: "empty-string" });
    expect(analyzeBlankValue("   ")).toEqual({ isBlank: true, subtype: "whitespace-only" });
    expect(analyzeBlankValue("\t\n")).toEqual({ isBlank: true, subtype: "whitespace-only" });
  });

  it("detects placeholder values", () => {
    expect(analyzeBlankValue("n/a")).toEqual({ isBlank: true, subtype: "placeholder" });
    expect(analyzeBlankValue("N/A")).toEqual({ isBlank: true, subtype: "placeholder" });
    expect(analyzeBlankValue("none")).toEqual({ isBlank: true, subtype: "placeholder" });
    expect(analyzeBlankValue("unknown")).toEqual({ isBlank: true, subtype: "placeholder" });
    expect(analyzeBlankValue("-")).toEqual({ isBlank: true, subtype: "placeholder" });
  });

  it("detects empty arrays", () => {
    expect(analyzeBlankValue([])).toEqual({ isBlank: true, subtype: "empty-array" });
  });

  it("returns non-blank for valid values", () => {
    expect(analyzeBlankValue("Valid Title")).toEqual({ isBlank: false, subtype: null });
    expect(analyzeBlankValue(123)).toEqual({ isBlank: false, subtype: null });
    expect(analyzeBlankValue([{ title: "Doc" }])).toEqual({ isBlank: false, subtype: null });
  });
});

describe("fixture-loader: Bellingham fixture field states", () => {
  it("confirms Title is blank in all candidate records (regression evidence)", () => {
    const blankTitles = candidateRecords.filter((r) => classifyFieldValue(r, "Title") === "blank");
    expect(blankTitles).toHaveLength(500);
  });

  it("confirms BidStatus is blank in all candidate records (regression evidence)", () => {
    const blankStatuses = candidateRecords.filter((r) => classifyFieldValue(r, "BidStatus") === "blank");
    expect(blankStatuses).toHaveLength(500);
  });

  it("confirms Title is present in all reference records", () => {
    const presentTitles = referenceRecords.filter((r) => classifyFieldValue(r, "Title") === "present");
    expect(presentTitles).toHaveLength(500);
  });

  it("confirms AgentID and BidURL are never blank in either fixture", () => {
    const refIdentityBlank = referenceRecords.filter(
      (r) => classifyFieldValue(r, "AgentID") === "blank" || classifyFieldValue(r, "BidURL") === "blank"
    );
    const candIdentityBlank = candidateRecords.filter(
      (r) => classifyFieldValue(r, "AgentID") === "blank" || classifyFieldValue(r, "BidURL") === "blank"
    );

    expect(refIdentityBlank).toHaveLength(0);
    expect(candIdentityBlank).toHaveLength(0);
  });

  it("confirms the eight regressed fields are blank in all 500 candidate records", () => {
    const regressed = [
      "Title",
      "BidStatus",
      "BidType",
      "PublishedDate",
      "DueDate",
      "AwardDate",
      "ContactEmail",
      "ContactPhone"
    ];

    for (const field of regressed) {
      const blank = candidateRecords.filter((r) => classifyFieldValue(r, field, { policy: "strict" }) === "blank");
      expect(blank, `${field} should be blank in all candidate records`).toHaveLength(500);
    }
  });
});
