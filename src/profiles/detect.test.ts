import { describe, expect, it } from "vitest";
import { describeDetectionMatch, detectSourceProfile } from "./detect";
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
      match: {
        profileId: "bellingham",
        method: "url",
        matchedField: "BidURL",
        matchedPrefix: "https://cob.procureware.com"
      }
    });
  });

  it("honors explicit detection hints over the defaults", () => {
    const custom = profileFor("custom", "https://portal.example.gov", {
      detection: { urlFields: ["ResourceURL"], urlPrefixes: ["https://cdn.example.gov"] }
    });
    const customData = { Export: [{ Id: "1", ResourceURL: "https://cdn.example.gov/x" }] };
    const result = detectSourceProfile(customData, [custom, bellingham]);
    expect(result.status).toBe("match");
    if (result.status === "match" && result.match.method === "url") {
      expect(result.match.profileId).toBe("custom");
      expect(result.match.matchedField).toBe("ResourceURL");
    } else {
      throw new Error(`expected a url match, got ${JSON.stringify(result)}`);
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

describe("detectSourceProfile — identity values", () => {
  const withIdentity = (id: string, sourceUrl: string, identityValues: Record<string, string[]>) =>
    profileFor(id, sourceUrl, { detection: { identityValues } });
  // Three SciQuest sources share one host; only the bot identity tells them apart.
  const auburn = withIdentity("auburn", "https://bids.sciquest.com/auburn", {
    AgentID: ["1484"],
    AgentName: ["Auburn University AL - SciQ 01"]
  });
  const unm = withIdentity("unm", "https://bids.sciquest.com/unm", {
    AgentID: ["1493"],
    AgentName: ["University of New Mexico - Main - SciQ 1"]
  });
  const record = (AgentID: string, AgentName: string, BidURL = "https://app01.jaggaer.com/apps/Router/x") => ({
    Id: "1",
    AgentID,
    AgentName,
    BidURL
  });

  it("matches on identity values when every identity field agrees", () => {
    const result = detectSourceProfile({ Export: [record("1493", "University of New Mexico - Main - SciQ 1")] }, [auburn, unm]);
    expect(result).toEqual({
      status: "match",
      match: {
        profileId: "unm",
        method: "identity",
        matchedValues: [
          { field: "AgentID", value: "1493" },
          { field: "AgentName", value: "University of New Mexico - Main - SciQ 1" }
        ]
      }
    });
  });

  it("requires all identity fields to agree — a shared bot id alone is not an identity", () => {
    // Observed 2026-08-27: AgentID 1234 carried by two different bots.
    const trb = withIdentity("trb", "https://www.trb.org", { AgentID: ["1234"], AgentName: ["Transportation Research Board 2"] });
    const nashville = withIdentity("nashville", "https://ibqhjb.fa.ocs.oraclecloud.com", {
      AgentID: ["1234"],
      AgentName: ["Nashville-Davidson County Met Gov TN-01"]
    });
    const result = detectSourceProfile(
      { Export: [record("1234", "Nashville-Davidson County Met Gov TN-01", "")] },
      [trb, nashville]
    );
    expect(result.status).toBe("match");
    if (result.status === "match") expect(result.match.profileId).toBe("nashville");
  });

  it("treats a declared identity as authoritative: a URL match cannot rescue a mismatched identity", () => {
    const cob = withIdentity("cob", "https://cob.procureware.com", {
      AgentID: ["1431"],
      AgentName: ["Bellingham WA - PW-02"]
    });
    const data = { Export: [record("9999", "Some Other Bot", "https://cob.procureware.com/Bids/abc")] };
    expect(detectSourceProfile(data, [cob]).status).toBe("none");
  });

  it("falls back to URL matching when the records lack the identity fields", () => {
    const cob = withIdentity("cob", "https://cob.procureware.com", { AgentID: ["1431"], AgentName: ["Bellingham WA - PW-02"] });
    const result = detectSourceProfile(dataset, [cob]);
    expect(result).toEqual({
      status: "match",
      match: { profileId: "cob", method: "url", matchedField: "BidURL", matchedPrefix: "https://cob.procureware.com" }
    });
  });

  it("ranks identity matches above URL matches from other profiles", () => {
    const hostOnly = profileFor("jaggaer-generic", "https://app01.jaggaer.com");
    const result = detectSourceProfile({ Export: [record("1484", "Auburn University AL - SciQ 01")] }, [hostOnly, auburn, unm]);
    expect(result.status).toBe("match");
    if (result.status === "match") expect(result.match.profileId).toBe("auburn");
  });

  it("reports ambiguity when two profiles claim the same identity", () => {
    const twin = withIdentity("auburn-twin", "https://bids.sciquest.com/auburn-twin", {
      AgentID: ["1484"],
      AgentName: ["Auburn University AL - SciQ 01"]
    });
    const result = detectSourceProfile({ Export: [record("1484", "Auburn University AL - SciQ 01")] }, [auburn, twin]);
    expect(result.status).toBe("ambiguous");
  });

  it("describes a match in one line for the picker", () => {
    expect(
      describeDetectionMatch({
        profileId: "x",
        method: "identity",
        matchedValues: [
          { field: "AgentID", value: "1431" },
          { field: "AgentName", value: "Bellingham WA - PW-02" }
        ]
      })
    ).toBe('AgentID is "1431" and AgentName is "Bellingham WA - PW-02"');
    expect(
      describeDetectionMatch({ profileId: "x", method: "url", matchedField: "BidURL", matchedPrefix: "https://a.gov" })
    ).toBe("BidURL starts with https://a.gov");
  });
});
