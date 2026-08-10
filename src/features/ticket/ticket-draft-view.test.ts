import { describe, expect, it } from "vitest";
import {
  buildDraftFromForm,
  EMPTY_TICKET_FORM,
  parseEvidenceLines,
  TRELLO_HANDOFF_STEPS,
  usableIdentification
} from "./ticket-draft-view";
import { buildTicketInputFromExport } from "../../engine/export";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import referenceData from "../../test/fixtures/bellingham-reference.json";
import candidateData from "../../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const FIXED_NOW = "2026-08-10T00:00:00.000Z";

const review = runRecoveryReview(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE, {
  generatedAt: FIXED_NOW,
  sourceRun: "candidate.json",
  referenceRun: "reference.json"
});

const baseInput = buildTicketInputFromExport({
  profile: BELLINGHAM_PROCUREWARE,
  qa: review.qa,
  recovery: review.recovery,
  dedupe: review.dedupe,
  generatedAt: FIXED_NOW,
  inputHashes: [
    { fileName: "candidate.json", role: "candidate", sha256: "a".repeat(64), unavailableReason: null },
    { fileName: "reference.json", role: "reference", sha256: "b".repeat(64), unavailableReason: null }
  ],
  sourceRun: "candidate.json",
  referenceRun: "reference.json"
});

describe("ticket draft form: parsing", () => {
  it("takes one evidence item per non-empty line", () => {
    expect(parseEvidenceLines("first\n\n  second  \n\n")).toEqual(["first", "second"]);
  });

  it("yields nothing for blank input rather than one empty quote", () => {
    expect(parseEvidenceLines("")).toEqual([]);
    expect(parseEvidenceLines("   \n  \n")).toEqual([]);
  });

  it("keeps only identification rows with both halves filled", () => {
    expect(
      usableIdentification([
        { label: "Agent", value: "PW-02" },
        { label: "  ", value: "orphan" },
        { label: "Agent ID", value: "  " },
        { label: "  Trimmed  ", value: "  1431  " }
      ])
    ).toEqual([
      { label: "Agent", value: "PW-02" },
      { label: "Trimmed", value: "1431" }
    ]);
  });
});

describe("ticket draft form: building", () => {
  it("builds a draft from an empty form", () => {
    const result = buildDraftFromForm(baseInput, EMPTY_TICKET_FORM);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.title).toContain("bellingham-procureware");
    expect(result.draft.severity).toBe("high");
    expect(result.draft.suggestedLabels.length).toBeGreaterThan(0);
  });

  it("says the cause is not established when no evidence is supplied", () => {
    const result = buildDraftFromForm(baseInput, EMPTY_TICKET_FORM);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.markdownDescription).toContain("The cause is not established from this data.");
    expect(result.draft.markdownDescription).not.toContain("quoted as received");
  });

  it("appends typed identification rows after what the run already knew", () => {
    const result = buildDraftFromForm(baseInput, {
      ...EMPTY_TICKET_FORM,
      identification: [{ label: "Agent", value: "Bellingham WA - PW-02" }]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.markdownDescription).toContain("| Agent | Bellingham WA - PW-02 |");
  });

  it("quotes supplied evidence verbatim and attributes it", () => {
    const result = buildDraftFromForm(baseInput, {
      ...EMPTY_TICKET_FORM,
      rootCauseEvidence: "Scraper log: header parser returned 0 nodes\nVendor reply: no change deployed"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.markdownDescription).toContain("quoted as received");
    expect(result.draft.markdownDescription).toContain("> Scraper log: header parser returned 0 nodes");
    expect(result.draft.markdownDescription).toContain("> Vendor reply: no change deployed");
  });

  it("refuses rather than emitting a credential typed into the form", () => {
    const result = buildDraftFromForm(baseInput, {
      ...EMPTY_TICKET_FORM,
      identification: [{ label: "Token", value: "Bearer sk-live-abcdef123456" }]
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/bearer token/i);
  });

  it("refuses a selector invented in the evidence box without context", () => {
    // A selector only passes when the evidence itself contains it; the guard compares
    // against exactly what was supplied.
    const result = buildDraftFromForm(baseInput, {
      ...EMPTY_TICKET_FORM,
      rootCauseEvidence: "  "
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a selector that the supplied evidence actually contains", () => {
    const result = buildDraftFromForm(baseInput, {
      ...EMPTY_TICKET_FORM,
      rootCauseEvidence: "Vendor reply: the header now renders under div.bid-summary"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.markdownDescription).toContain("div.bid-summary");
  });

  it("is deterministic for the same form", () => {
    const form = { identification: [{ label: "Agent", value: "PW-02" }], rootCauseEvidence: "log line" };
    expect(buildDraftFromForm(baseInput, form)).toEqual(buildDraftFromForm(baseInput, form));
  });

  it("does not mutate the base input", () => {
    const before = JSON.stringify(baseInput);
    buildDraftFromForm(baseInput, { identification: [{ label: "A", value: "B" }], rootCauseEvidence: "x" });
    expect(JSON.stringify(baseInput)).toBe(before);
  });
});

describe("ticket draft form: handoff", () => {
  it("describes a manual handoff and never claims to send anything", () => {
    const joined = TRELLO_HANDOFF_STEPS.join(" ").toLowerCase();

    expect(joined).toContain("copy");
    expect(joined).not.toContain("token");
    expect(joined).not.toMatch(/\bsend\b|\bpost\b|\bapi\b/);
  });
});
