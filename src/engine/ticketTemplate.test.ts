import { describe, expect, it } from "vitest";
import {
  assertNoCredentials,
  assertNoInventedSelectors,
  buildTicketDraft,
  deriveLabels,
  deriveSeverity,
  deriveTitle,
  formatEvidenceValue,
  type TicketFindingGroup,
  type TicketInput
} from "./ticketTemplate";
import { runRecoveryReview } from "./review";
import { BELLINGHAM_PROCUREWARE } from "../profiles";
import type { Finding } from "./findings";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const FIXED_NOW = "2026-08-10T00:00:00.000Z";

const review = runRecoveryReview(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE, {
  generatedAt: FIXED_NOW,
  sourceRun: "lambda-20260715-candidate.json",
  referenceRun: "lambda-20260714-reference.json"
});

/** Groups the fixture's real findings the way a caller would. */
function groupsFromFindings(findings: Finding[], outOf: number): TicketFindingGroup[] {
  const groups = new Map<string, TicketFindingGroup>();
  for (const finding of findings) {
    if (finding.category !== "field_regression") continue;
    const key = `${finding.category}|${finding.fieldPath}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else
      groups.set(key, {
        category: finding.category,
        severity: finding.severity,
        field: finding.fieldPath,
        count: 1,
        outOf
      });
  }
  return [...groups.values()];
}

const findingGroups = groupsFromFindings(review.qa.findings, review.match.counts.matched_primary);

/** Three real regressions, taken from the fixture findings. */
const examples = review.qa.findings
  .filter((finding) => finding.category === "field_regression" && finding.fieldPath === "Title")
  .slice(0, 3)
  .map((finding) => ({
    recordKey: finding.recordKey as string,
    identityLabel: undefined,
    field: finding.fieldPath as string,
    expected: finding.referenceValue,
    actual: finding.candidateValue
  }));

const baseInput: TicketInput = {
  profile: BELLINGHAM_PROCUREWARE,
  run: {
    generatedAt: FIXED_NOW,
    candidate: {
      name: "lambda-20260715-candidate.json",
      timestamp: "2026-07-15 10:01:07",
      sha256: "a".repeat(64),
      hashUnavailableReason: null
    },
    reference: {
      name: "lambda-20260714-reference.json",
      timestamp: "2026-07-14 21:48:33",
      sha256: "b".repeat(64),
      hashUnavailableReason: null
    },
    sourceIdentification: [
      { label: "Agent", value: "Bellingham WA - PW-02" },
      { label: "Agent ID", value: "1431" }
    ],
    candidateRecordCount: review.match.candidateCount,
    referenceRecordCount: review.match.referenceCount,
    matchedRecordCount: review.match.counts.matched_primary,
    matchRate: review.match.matchRate
  },
  findingGroups,
  examples,
  recovery: {
    performed: review.recovery.summary.backfilledFieldCount > 0,
    backfilledFieldCount: review.recovery.summary.backfilledFieldCount,
    recordsWithBackfill: review.recovery.summary.recordsWithBackfill,
    backfillableFields: review.recovery.summary.backfillableFields,
    withheldFields: review.recovery.summary.dateSensitiveFieldsWithheld
  }
};

const draft = buildTicketDraft(baseInput);

describe("ticket template: shape", () => {
  it("returns a title, description, labels, and severity", () => {
    expect(typeof draft.title).toBe("string");
    expect(typeof draft.markdownDescription).toBe("string");
    expect(Array.isArray(draft.suggestedLabels)).toBe(true);
    expect(draft.severity).toBe("high");
  });

  it("is deterministic for identical inputs", () => {
    expect(buildTicketDraft(baseInput)).toEqual(draft);
  });

  it("names the source and the leading regression in the title", () => {
    // Title, BidStatus, DueDate, and PublishedDate all lost 499 values, so the
    // alphabetical tie-break decides the leader — deterministic, not arbitrary.
    expect(draft.title).toContain("bellingham-procureware");
    expect(draft.title).toMatch(/BidStatus and \d+ other fields unpopulated in 499 of 499 records \(100\.0%\)/);
  });

  it("breaks a count tie by field name, so the title never varies between runs", () => {
    const tied = deriveTitle({
      ...baseInput,
      findingGroups: [
        { category: "field_regression", severity: "high", field: "Zeta", count: 5, outOf: 10 },
        { category: "field_regression", severity: "high", field: "Alpha", count: 5, outOf: 10 }
      ]
    });
    expect(tied).toContain("Alpha and 1 other field ");
  });

  it("suggests sorted, deduplicated labels", () => {
    expect(draft.suggestedLabels).toEqual([...draft.suggestedLabels].sort());
    expect(new Set(draft.suggestedLabels).size).toBe(draft.suggestedLabels.length);
    expect(draft.suggestedLabels).toContain("source:bellingham-procureware");
    expect(draft.suggestedLabels).toContain("field-regression");
    expect(draft.suggestedLabels).toContain("severity:high");
  });

  it("takes severity from the highest finding severity present", () => {
    expect(deriveSeverity([{ category: "field_regression", severity: "medium", field: "A", count: 1, outOf: 1 }])).toBe("medium");
    expect(
      deriveSeverity([
        { category: "field_regression", severity: "medium", field: "A", count: 1, outOf: 1 },
        { category: "required_field_missing", severity: "critical", field: "B", count: 1, outOf: 1 }
      ])
    ).toBe("critical");
    expect(deriveSeverity([])).toBe("info");
  });
});

describe("ticket template: required content", () => {
  const markdown = draft.markdownDescription;

  it("identifies the source and the reporting bot", () => {
    expect(markdown).toContain("JSON Data Drift Analyzer");
    expect(markdown).toContain("bellingham-procureware` v4");
    expect(markdown).toContain("Bellingham WA - PW-02");
  });

  it("reports both run timestamps and hashes", () => {
    expect(markdown).toContain("2026-07-15 10:01:07");
    expect(markdown).toContain("2026-07-14 21:48:33");
    expect(markdown).toContain("a".repeat(64));
    expect(markdown).toContain("b".repeat(64));
  });

  it("reports counts and percentages", () => {
    expect(markdown).toContain("| `Title` | 499 | 100.0% |");
    expect(markdown).toContain("| `ContactPhone` | 171 | 34.3% |");
    expect(markdown).toContain("99.80% match rate");
  });

  it("lists the affected JSON fields", () => {
    expect(markdown).toContain("### Affected JSON fields");
    for (const field of ["Title", "BidStatus", "BidType", "DueDate", "PublishedDate", "AwardDate"]) {
      expect(markdown).toContain(`\`${field}\``);
    }
  });

  it("shows evidence with record identity and expected versus actual", () => {
    expect(markdown).toContain("## Evidence");
    expect(markdown).toContain("Expected (reference):");
    expect(markdown).toContain("Actual (candidate):");
    expect(markdown).toContain(examples[0]!.recordKey);
  });

  it("states business impact", () => {
    expect(markdown).toContain("## Business impact");
    expect(markdown).toContain("Downstream consumers");
  });

  it("gives a deterministic recommended action", () => {
    expect(markdown).toContain("## Recommended action");
    expect(markdown).toContain("1. Confirm whether the affected fields are still present");
  });

  it("gives reproduction instructions naming the profile and keys", () => {
    expect(markdown).toContain("## Reproduction");
    expect(markdown).toContain("collection path to `Export`");
    expect(markdown).toContain("`AgentID` + `BidURL`");
  });
});

describe("ticket template: cautious root-cause language", () => {
  const markdown = draft.markdownDescription;

  it("hedges rather than asserting a cause", () => {
    expect(markdown).toContain("Observed behaviour suggests");
    expect(markdown).toContain("**The cause is not established from this data.**");
  });

  it("does not claim a source-site change or name any selector", () => {
    expect(markdown).not.toMatch(/\bHTML (?:changed|change)\b/i);
    expect(markdown).not.toMatch(/querySelector|getElementsBy/);
    expect(markdown).toContain("No selector, element, or page structure is asserted here");
  });

  it("quotes supplied root-cause evidence and attributes it", () => {
    const withEvidence = buildTicketDraft({
      ...baseInput,
      suppliedRootCauseEvidence: ["Scraper log 2026-07-15: header block parser returned 0 nodes"]
    });
    expect(withEvidence.markdownDescription).toContain("quoted as received");
    expect(withEvidence.markdownDescription).toContain("> Scraper log 2026-07-15");
  });

  it("permits a selector only when supplied evidence contains it", () => {
    const supplied = 'Vendor support reply: the bid header now renders under div.bid-summary';
    expect(() =>
      buildTicketDraft({ ...baseInput, suppliedRootCauseEvidence: [supplied] })
    ).not.toThrow();
  });

  it("refuses a selector that no supplied evidence contains", () => {
    expect(() => assertNoInventedSelectors("The parser lost div.bid-header on the detail page.", [])).toThrow(
      /not present in supplied evidence/
    );
    expect(() => assertNoInventedSelectors('Use document.querySelector(".x") to fix.', [])).toThrow();
  });

  it("does not trip on ordinary prose or URLs", () => {
    expect(() =>
      assertNoInventedSelectors("See https://cob.procureware.com/Bids/abc#section for the record.", [])
    ).not.toThrow();
  });
});

describe("ticket template: safety", () => {
  it("truncates long evidence values and says how much was omitted", () => {
    const long = "x".repeat(400);
    const formatted = formatEvidenceValue(long);

    expect(formatted.length).toBeLessThan(long.length);
    expect(formatted).toContain("chars omitted");
  });

  it("marks blank and absent values rather than printing nothing", () => {
    expect(formatEvidenceValue("")).toBe("_(blank)_");
    expect(formatEvidenceValue("   ")).toBe("_(blank)_");
    expect(formatEvidenceValue(null)).toBe("_(absent)_");
    expect(formatEvidenceValue(undefined)).toBe("_(absent)_");
  });

  it("flattens newlines so one value cannot forge extra markdown", () => {
    expect(formatEvidenceValue("line1\nline2")).toBe("line1 line2");
  });

  it("never includes a full record payload", () => {
    // Only the named field's value can appear, and only truncated.
    const record = candidateRecords[0]!;
    expect(draft.markdownDescription).not.toContain(JSON.stringify(record));
    expect(draft.markdownDescription).not.toContain(String(record.Description));
  });

  it("reports the true omission count when the caller passes only a sample", () => {
    // A caller that pre-truncates would otherwise make the ticket claim nothing was
    // left out — the silent truncation this field exists to prevent.
    const markdown = buildTicketDraft({
      ...baseInput,
      examples: baseInput.examples.slice(0, 3),
      totalExamplesAvailable: 3399
    }).markdownDescription;

    expect(markdown).toContain("3396 further example(s) omitted");
  });

  it("caps evidence at three examples and says what it omitted", () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      recordKey: `key-${index}`,
      field: "Title",
      expected: `value ${index}`,
      actual: ""
    }));
    const markdown = buildTicketDraft({ ...baseInput, examples: many }).markdownDescription;

    expect(markdown).toContain("key-2");
    expect(markdown).not.toContain("key-3");
    expect(markdown).toContain("4 further example(s) omitted");
  });

  it("refuses to emit a credential", () => {
    expect(() => assertNoCredentials("Authorization: Bearer abcdef1234567890")).toThrow(/bearer token/i);
    expect(() => assertNoCredentials("api_key=sk-live-999")).toThrow();
    expect(() => assertNoCredentials("-----BEGIN RSA PRIVATE KEY-----")).toThrow();
    expect(() => assertNoCredentials("Nothing sensitive here.")).not.toThrow();
  });

  it("throws rather than emitting a credential smuggled in through evidence", () => {
    expect(() =>
      buildTicketDraft({
        ...baseInput,
        examples: [{ recordKey: "k", field: "Title", expected: "Authorization: Bearer sk-abcdefgh12345", actual: "" }]
      })
    ).toThrow(/bearer token/i);
  });

  it("carries no credential in the real fixture draft", () => {
    expect(() => assertNoCredentials(draft.markdownDescription)).not.toThrow();
  });
});

describe("ticket template: recovery status", () => {
  it("states what recovery restored, and that it was not scraped", () => {
    expect(draft.markdownDescription).toContain("A recovered artifact was produced: 1407 value(s)");
    expect(draft.markdownDescription).toContain("must not be treated as freshly scraped");
  });

  it("names the fields policy withheld", () => {
    expect(draft.markdownDescription).toContain("Deliberately not recovered:");
    expect(draft.markdownDescription).toContain("`DueDate`");
  });

  it("states plainly when no recovery happened, with the reason", () => {
    const markdown = buildTicketDraft({
      ...baseInput,
      recovery: {
        performed: false,
        backfilledFieldCount: 0,
        recordsWithBackfill: 0,
        backfillableFields: [],
        withheldFields: [],
        notPerformedReason: "No field is approved for automatic backfill for this source."
      }
    }).markdownDescription;

    expect(markdown).toContain("**No recovery was performed.**");
    expect(markdown).toContain("No field is approved");
    expect(markdown).toContain("the missing values remain missing");
  });

  it("falls back to a stated reason rather than silence", () => {
    const markdown = buildTicketDraft({
      ...baseInput,
      recovery: { performed: false, backfilledFieldCount: 0, recordsWithBackfill: 0, backfillableFields: [], withheldFields: [] }
    }).markdownDescription;

    expect(markdown).toContain("No field is approved for automatic backfill for this source.");
  });
});

describe("ticket template: degraded inputs", () => {
  it("says a hash is unavailable and why, rather than omitting the row", () => {
    const markdown = buildTicketDraft({
      ...baseInput,
      run: {
        ...baseInput.run,
        candidate: { name: "candidate.json", timestamp: null, sha256: null, hashUnavailableReason: "insecure context" }
      }
    }).markdownDescription;

    expect(markdown).toContain("unavailable — insecure context");
    expect(markdown).toContain("_(not reported)_");
  });

  it("handles a clean run with no findings", () => {
    const clean = buildTicketDraft({ ...baseInput, findingGroups: [], examples: [] });

    expect(clean.severity).toBe("info");
    expect(clean.title).toContain("no field-level issues found");
    expect(clean.markdownDescription).toContain("No field-level issues were found.");
    expect(clean.markdownDescription).toContain("No representative examples were supplied.");
  });

  it("reports dataset-level groups that have no field", () => {
    const markdown = buildTicketDraft({
      ...baseInput,
      findingGroups: [
        ...findingGroups,
        { category: "record_count_anomaly", severity: "info", field: null, count: 1, outOf: 500 }
      ]
    }).markdownDescription;

    expect(markdown).toContain("### Dataset-level issues");
    expect(markdown).toContain("record count anomaly");
  });

  it("uses an identity label when the caller supplies one", () => {
    const markdown = buildTicketDraft({
      ...baseInput,
      examples: [{ recordKey: "key", identityLabel: "34B-2026", field: "Title", expected: "Bridge work", actual: "" }]
    }).markdownDescription;

    expect(markdown).toContain("**34B-2026 (`key`)**");
  });

  it("labels a title correctly when only one field is affected", () => {
    const single = deriveTitle({
      ...baseInput,
      findingGroups: [{ category: "field_regression", severity: "high", field: "Title", count: 10, outOf: 20 }]
    });
    expect(single).toContain("Title unpopulated in 10 of 20 records (50.0%)");
    expect(single).not.toContain("other field");
  });

  it("adds a recovery label only when recovery ran", () => {
    expect(deriveLabels(baseInput, "high")).toContain("recovery-applied");
    expect(
      deriveLabels({ ...baseInput, recovery: { ...baseInput.recovery, performed: false } }, "high")
    ).not.toContain("recovery-applied");
  });
});
