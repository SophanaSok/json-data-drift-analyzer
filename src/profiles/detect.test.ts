import { describe, expect, it } from "vitest";
import { detectSourceProfile } from "./detect";
import { mergeProfile } from "./resolve";
import type { SourceProfileBase, SourceProfileDelta } from "./schema";

const base: SourceProfileBase = {
  collectionPath: "Export",
  primaryKey: ["Id"],
  fallbackKeys: [],
  dedupeKey: ["Id"],
  hardRequiredFields: ["Id"],
  manualReviewFields: [],
  excludedFields: [],
  minimumMatchRate: 0.5,
  quality: {
    requiredFields: ["Id"],
    optionalEmptyFields: [],
    emptyRules: {},
    identityDefault: ["Id"],
    fieldGroups: [],
    documentFieldPairs: [],
    searchSourceFields: { title: "Title", status: "Status", type: "Type", url: "BidURL" }
  }
};

function profileFor(id: string, sourceUrl: string, delta: Partial<SourceProfileDelta> = {}) {
  return mergeProfile(base, { id, sourceUrl, version: 1, safeBackfillFields: [], ...delta });
}

const bellingham = profileFor("bellingham", "https://cob.procureware.com");
const everett = profileFor("everett", "https://bids.everettwa.gov");
const dataset = {
  Export: [
    { Id: "1", BidURL: "https://cob.procureware.com/Bids/abc" },
    { Id: "2", BidURL: "https://cob.procureware.com/Bids/def" }
  ]
};

describe("detectSourceProfile", () => {
  it("detects the source from its URL field with zero extra configuration", () => {
    const result = detectSourceProfile(dataset, [bellingham, everett]);
    expect(result).toEqual({
      status: "match",
      match: { profileId: "bellingham", matchedField: "BidURL", matchedPrefix: "https://cob.procureware.com" }
    });
  });

  it("honors explicit detection hints over the defaults", () => {
    const custom = profileFor("custom", "https://portal.example.gov", {
      detection: { urlFields: ["ResourceURL"], urlPrefixes: ["https://cdn.example.gov"] }
    });
    const customData = { Export: [{ Id: "1", ResourceURL: "https://cdn.example.gov/x" }] };
    const result = detectSourceProfile(customData, [custom, bellingham]);
    expect(result.status).toBe("match");
    if (result.status === "match") {
      expect(result.match.profileId).toBe("custom");
      expect(result.match.matchedField).toBe("ResourceURL");
    }
  });

  it("survives malformed leading records by sampling several", () => {
    const messy = {
      Export: [
        { Id: "0" },
        { Id: "1", BidURL: 42 },
        { Id: "2", BidURL: "" },
        { Id: "3", BidURL: "https://cob.procureware.com/Bids/abc" }
      ]
    };
    expect(detectSourceProfile(messy, [bellingham, everett]).status).toBe("match");
  });

  it("reports ambiguity instead of guessing", () => {
    // Two profiles claiming overlapping prefixes — a configuration smell the
    // user must see, not a tie the code may break.
    const wide = profileFor("wide", "https://cob.procureware.com/Bids");
    const result = detectSourceProfile(dataset, [bellingham, wide]);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.matches.map((match) => match.profileId).sort()).toEqual(["bellingham", "wide"]);
    }
  });

  it("reports none for an unrecognized or malformed dataset", () => {
    expect(detectSourceProfile({ Export: [{ Id: "1", BidURL: "https://other.gov/x" }] }, [bellingham]).status).toBe("none");
    expect(detectSourceProfile(null, [bellingham]).status).toBe("none");
    expect(detectSourceProfile("not json data", [bellingham]).status).toBe("none");
    expect(detectSourceProfile({ Export: "not an array" }, [bellingham]).status).toBe("none");
    expect(detectSourceProfile(dataset, []).status).toBe("none");
  });
});
