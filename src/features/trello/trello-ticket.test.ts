import { describe, expect, it } from "vitest";
import {
  containsCredentialShape,
  findExistingPost,
  runFingerprint,
  unresolvedAttempts,
  type PostedTicketRecord
} from "./trello-ticket";
import { buildExportBundle } from "../../engine/export";
import { runRecoveryReview } from "../../engine/review";
import { buildTicketDraft } from "../../engine/ticketTemplate";
import { buildTicketInputFromExport } from "../../engine/export";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import type { RecoveryReview } from "../../engine/review";
import type { TicketDraft } from "../../engine/ticketTemplate";
import referenceData from "../../test/fixtures/bellingham-reference.json";
import candidateData from "../../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const FIXED_NOW = "2026-08-10T00:00:00.000Z";

const review = runRecoveryReview(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE, {
  generatedAt: FIXED_NOW,
  sourceRun: "candidate.json",
  referenceRun: "reference.json",
  inputHashes: [
    { fileName: "candidate.json", role: "candidate", sha256: "a".repeat(64), unavailableReason: null },
    { fileName: "reference.json", role: "reference", sha256: "b".repeat(64), unavailableReason: null }
  ]
});

const draft = buildTicketDraft(
  buildTicketInputFromExport({
    profile: BELLINGHAM_PROCUREWARE,
    qa: review.qa,
    recovery: review.recovery,
    dedupe: review.dedupe,
    generatedAt: FIXED_NOW,
    inputHashes: review.inputHashes
  })
);

const record = (overrides: Partial<PostedTicketRecord> = {}): PostedTicketRecord => ({
  id: "post:1",
  runFingerprint: "fp",
  analysisKey: FIXED_NOW,
  status: "success",
  profileId: "p",
  profileVersion: 1,
  sourceRun: null,
  referenceRun: null,
  title: "t",
  descriptionSha256: "d",
  severity: "high",
  labelsSuggested: [],
  listId: "l",
  cardId: "c",
  cardUrl: "u",
  attemptedAt: "2026-08-09T00:00:00.000Z",
  actor: "user",
  errorCategory: null,
  errorMessage: null,
  ...overrides
});

describe("run fingerprint", () => {
  it("is stable for the same run, policy, and ticket", async () => {
    expect(await runFingerprint(review, draft)).toBe(await runFingerprint(review, draft));
  });

  it("changes when the profile version changes", async () => {
    const other: RecoveryReview = { ...review, profileVersion: 99 };
    expect(await runFingerprint(other, draft)).not.toBe(await runFingerprint(review, draft));
  });

  it("changes when the inputs change", async () => {
    const other: RecoveryReview = {
      ...review,
      inputHashes: [{ fileName: "c", role: "candidate", sha256: "z".repeat(64), unavailableReason: null }]
    };
    expect(await runFingerprint(other, draft)).not.toBe(await runFingerprint(review, draft));
  });

  it("changes when the ticket body changes", async () => {
    const other: TicketDraft = { ...draft, markdownDescription: `${draft.markdownDescription}\nextra` };
    expect(await runFingerprint(review, other)).not.toBe(await runFingerprint(review, draft));
  });
});

describe("duplicate detection", () => {
  it("finds a previous success and reports the card", () => {
    const check = findExistingPost([record({ runFingerprint: "fp" })], "fp");
    expect(check).toMatchObject({ duplicate: true, cardId: "c", cardUrl: "u" });
  });

  it("does not block on a failed attempt, which created nothing", () => {
    expect(findExistingPost([record({ status: "failed" })], "fp")).toEqual({ duplicate: false });
  });

  it("does not block on an unknown attempt, which needs a person to check", () => {
    expect(findExistingPost([record({ status: "unknown" })], "fp")).toEqual({ duplicate: false });
  });

  it("does not match a different report", () => {
    expect(findExistingPost([record({ runFingerprint: "other" })], "fp")).toEqual({ duplicate: false });
  });

  it("surfaces unresolved attempts newest first", () => {
    const attempts = unresolvedAttempts(
      [
        record({ status: "unknown", attemptedAt: "2026-08-01T00:00:00.000Z" }),
        record({ status: "unknown", attemptedAt: "2026-08-05T00:00:00.000Z" }),
        record({ status: "success" })
      ],
      "fp"
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.attemptedAt).toBe("2026-08-05T00:00:00.000Z");
  });
});

describe("credentials never reach an artifact", () => {
  it("no export artifact contains a token-shaped value", () => {
    const bundle = buildExportBundle({
      profile: BELLINGHAM_PROCUREWARE,
      qa: review.qa,
      recovery: review.recovery,
      dedupe: review.dedupe,
      generatedAt: FIXED_NOW,
      inputHashes: review.inputHashes
    });

    for (const artifact of bundle.artifacts) {
      expect(containsCredentialShape(artifact.content), `${artifact.fileName} must carry no credential`).toBe(false);
    }
  });

  it("the persisted record shape has no field for a credential", () => {
    const keys = Object.keys(record());
    expect(keys).not.toContain("token");
    expect(keys).not.toContain("apiKey");
    // The body is stored as a hash, so a leak of this table does not leak the report.
    expect(keys).toContain("descriptionSha256");
  });

  it("recognises credential-shaped text", () => {
    expect(containsCredentialShape("oauth_token=abc")).toBe(true);
    expect(containsCredentialShape("Bearer xyz")).toBe(true);
    expect(containsCredentialShape("api_key: 1")).toBe(true);
    expect(containsCredentialShape("an ordinary sentence")).toBe(false);
  });
});
