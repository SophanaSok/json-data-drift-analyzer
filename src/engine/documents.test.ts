import { describe, expect, it } from "vitest";
import { compareDocuments, normalizeDocuments } from "./documents";

// The regression these cover: the Bellingham export serializes list-valued fields
// as JSON-encoded STRINGS ("[]", "[{…}]") — the profile's evidence notes record
// this as fact — and normalizeDocuments only accepted real arrays. On the shipped
// profile's actual data every document diff was silently all-zeros: removed
// documents, hash mismatches, and byDocumentState reported nothing, with no error.

const DOC_A = { Title: "Bid opening report.pdf", URL: "https://example.com/a.pdf", Hash: "HASH-A" };
const DOC_B = { Title: "Addendum 1.pdf", URL: "https://example.com/b.pdf", Hash: "HASH-B" };

describe("normalizeDocuments on JSON-encoded string lists", () => {
  it("decodes a JSON-encoded document list — the real export shape", () => {
    const docs = normalizeDocuments(JSON.stringify([DOC_A]));
    expect(docs).toEqual([{ title: "Bid opening report.pdf", url: "https://example.com/a.pdf", hash: "HASH-A" }]);
  });

  it('decodes the JSON-encoded empty list "[]"', () => {
    expect(normalizeDocuments("[]")).toEqual([]);
  });

  it("still accepts a real array", () => {
    expect(normalizeDocuments([DOC_A])).toHaveLength(1);
  });

  it("passes through strings that are not JSON arrays without throwing", () => {
    expect(normalizeDocuments("not json")).toEqual([]);
    expect(normalizeDocuments("[broken")).toEqual([]);
    expect(normalizeDocuments('{"Title":"x"}')).toEqual([]);
    expect(normalizeDocuments(null)).toEqual([]);
    expect(normalizeDocuments(42)).toEqual([]);
  });
});

describe("compareDocuments on JSON-encoded inputs", () => {
  it("detects a removed document when both sides arrive JSON-encoded", () => {
    const { summary } = compareDocuments(
      JSON.stringify([DOC_A, DOC_B]),
      JSON.stringify([DOC_A]),
      JSON.stringify(["HASH-A", "HASH-B"]),
      JSON.stringify(["HASH-A"])
    );
    expect(summary.baselineCount).toBe(2);
    expect(summary.latestCount).toBe(1);
    expect(summary.removedCount).toBe(1);
    expect(summary.changes.find((change) => change.kind === "removed")?.documentId).toBe("HASH-B");
  });

  it("decodes JSON-encoded hash lists, so hash-list health checks stay live", () => {
    const { health } = compareDocuments(
      JSON.stringify([DOC_A]),
      JSON.stringify([DOC_A]),
      JSON.stringify(["HASH-A", "DANGLING"]),
      JSON.stringify(["HASH-A"])
    );
    expect(health.danglingHashListValues).toEqual(["DANGLING"]);
    expect(health.missingInHashList).toEqual([]);
  });
});
