import { describe, expect, it } from "vitest";
import { buildIngestionProxies, movedProxies } from "./ingestion-proxies";
import { runAnalysis } from "../../engine/diff";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import type { RegisteredSourceProfile } from "../../engine/adapter-types";
import referenceData from "../../test/fixtures/bellingham-reference.json";
import candidateData from "../../test/fixtures/bellingham-candidate.json";

const config = {
  collectionPath: "Export",
  identityFields: ["ProjectCode"],
  ignoredFields: [],
  profileId: "bellingham-procureware"
};

function analyse(baselineData: unknown, latestData: unknown) {
  return runAnalysis({
    baselineData,
    latestData,
    baselineFileName: "reference.json",
    latestFileName: "candidate.json",
    analysisKey: "proxy-key",
    config
  });
}

const wrap = (records: Array<Record<string, unknown>>) => ({ Export: records });

const record = (overrides: Record<string, unknown> = {}) => ({
  AgentID: "1431",
  ProjectCode: "1B-2026",
  BidURL: "https://cob.procureware.com/Bids/1",
  Title: "Water Main",
  Description: "Long description",
  BidStatus: "Awarded",
  BidType: "RFP",
  BidDocuments: "[]",
  ...overrides
});

const find = (report: ReturnType<typeof buildIngestionProxies>, id: string) =>
  report.proxies.find((proxy) => proxy.id === id);

describe("ingestion-share proxies", () => {
  it("measures nothing when no profile governs the run", () => {
    const report = buildIngestionProxies(analyse(wrap([record()]), wrap([record()])), null);
    expect(report.proxies).toEqual([]);
    expect(report.configuredFields).toEqual([]);
  });

  it("takes every field it watches from the profile, never from its own list", () => {
    const report = buildIngestionProxies(
      analyse(wrap([record()]), wrap([record()])),
      BELLINGHAM_PROCUREWARE
    );
    // Exactly the profile's corroboration text field, its status and type search
    // roles, and its configured JSON/document fields.
    expect(report.configuredFields).toContain(BELLINGHAM_PROCUREWARE.corroboration?.textFields[0]);
    expect(report.configuredFields).toContain(BELLINGHAM_PROCUREWARE.quality.searchSourceFields.status);
    expect(report.configuredFields).toContain(BELLINGHAM_PROCUREWARE.quality.searchSourceFields.type);
    for (const field of BELLINGHAM_PROCUREWARE.validation?.jsonFields ?? []) {
      expect(report.configuredFields).toContain(field);
    }
  });

  it("reports a text field's missing share on both sides", () => {
    const reference = [record({ ProjectCode: "1B" }), record({ ProjectCode: "2B" })];
    const candidate = [record({ ProjectCode: "1B" }), record({ ProjectCode: "2B", Description: "   " })];
    const proxy = find(buildIngestionProxies(analyse(wrap(reference), wrap(candidate)), BELLINGHAM_PROCUREWARE), "proxy:Description:empty");
    expect(proxy?.referenceShare).toBe(0);
    expect(proxy?.candidateShare).toBe(0.5);
    expect(proxy?.delta).toBe(0.5);
    expect(proxy?.referenceBase).toBe(2);
    expect(proxy?.candidateBase).toBe(2);
  });

  it("reports a categorical field as per-value shares, biggest movement first", () => {
    const reference = [
      record({ ProjectCode: "1B", BidStatus: "Awarded" }),
      record({ ProjectCode: "2B", BidStatus: "Awarded" }),
      record({ ProjectCode: "3B", BidStatus: "Open for Bidding" }),
      record({ ProjectCode: "4B", BidStatus: "Open for Bidding" })
    ];
    const candidate = [
      record({ ProjectCode: "1B", BidStatus: "Awarded" }),
      record({ ProjectCode: "2B", BidStatus: "Cancelled" }),
      record({ ProjectCode: "3B", BidStatus: "Cancelled" }),
      record({ ProjectCode: "4B", BidStatus: "Cancelled" })
    ];
    const proxy = find(buildIngestionProxies(analyse(wrap(reference), wrap(candidate)), BELLINGHAM_PROCUREWARE), "proxy:BidStatus:distribution");
    expect(proxy?.values[0]).toMatchObject({ value: "Cancelled", referenceShare: 0, candidateShare: 0.75, shift: 0.75 });
    expect(proxy?.values.map((entry) => entry.value)).toEqual(["Cancelled", "Open for Bidding", "Awarded"]);
    expect(proxy?.delta).toBe(0.75);
    // Nothing was blank on either side, so no missing row is invented.
    expect(proxy?.values.some((entry) => entry.isMissing)).toBe(false);
  });

  it("falls back to a missing-share proxy when a categorical field is really free text", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      record({ ProjectCode: `${index}B`, BidURL: `https://cob.procureware.com/Bids/${index}`, BidStatus: `unique ${index}` })
    );
    const report = buildIngestionProxies(analyse(wrap(many), wrap(many)), BELLINGHAM_PROCUREWARE);
    expect(find(report, "proxy:BidStatus:distribution")).toBeUndefined();
    expect(find(report, "proxy:BidStatus:empty")).toBeDefined();
  });

  it("measures JSON validity against populated values only", () => {
    const reference = [record({ ProjectCode: "1B", BidDocuments: "[]" }), record({ ProjectCode: "2B", BidDocuments: "" })];
    const candidate = [record({ ProjectCode: "1B", BidDocuments: "not json" }), record({ ProjectCode: "2B", BidDocuments: "" })];
    const proxy = find(buildIngestionProxies(analyse(wrap(reference), wrap(candidate)), BELLINGHAM_PROCUREWARE), "proxy:BidDocuments:json");
    // One populated value per side; the candidate's does not parse.
    expect(proxy?.referenceBase).toBe(1);
    expect(proxy?.candidateBase).toBe(1);
    expect(proxy?.referenceShare).toBe(0);
    expect(proxy?.candidateShare).toBe(1);
  });

  it("counts a dropped record on the reference side and an added one on the candidate side", () => {
    const reference = [record({ ProjectCode: "1B" }), record({ ProjectCode: "2B" })];
    const candidate = [record({ ProjectCode: "1B" }), record({ ProjectCode: "3B" })];
    const report = buildIngestionProxies(analyse(wrap(reference), wrap(candidate)), BELLINGHAM_PROCUREWARE);
    expect(report.referenceRecordCount).toBe(2);
    expect(report.candidateRecordCount).toBe(2);
  });

  it("lists only the proxies that actually moved", () => {
    const same = [record()];
    const report = buildIngestionProxies(analyse(wrap(same), wrap(same)), BELLINGHAM_PROCUREWARE);
    expect(movedProxies(report)).toEqual([]);
  });

  it("survives a profile whose quality section configures none of these fields", () => {
    const bare = {
      ...BELLINGHAM_PROCUREWARE,
      corroboration: undefined,
      validation: undefined,
      quality: {
        ...BELLINGHAM_PROCUREWARE.quality,
        documentFieldPairs: [],
        searchSourceFields: { title: "Title", status: "", type: "", url: "BidURL" }
      }
    } as unknown as RegisteredSourceProfile;
    expect(buildIngestionProxies(analyse(wrap([record()]), wrap([record()])), bare).proxies).toEqual([]);
  });
});

describe("ingestion-share proxies on the real fixture pair", () => {
  const report = buildIngestionProxies(
    analyse(referenceData, candidateData),
    BELLINGHAM_PROCUREWARE
  );

  it("covers both runs in full", () => {
    expect(report.referenceRecordCount).toBe(500);
    expect(report.candidateRecordCount).toBe(500);
  });

  it("reads the wiped status field as every record losing its value", () => {
    // Every BidStatus is "" in the candidate. The missing row is the largest
    // movement, so it becomes the headline: 0% of records had no status, now all do.
    const proxy = find(report, "proxy:BidStatus:distribution");
    const missing = proxy?.values.find((entry) => entry.isMissing);
    expect(missing).toMatchObject({ referenceShare: 0, candidateShare: 1 });
    expect(proxy?.delta).toBe(1);
    // The real values all fall to nothing, and their shares still add up.
    for (const entry of proxy?.values.filter((value) => !value.isMissing) ?? []) {
      expect(entry.candidateShare).toBe(0);
    }
  });

  it("finds no JSON-validity regression in the documents that survived", () => {
    const documents = report.proxies.filter((proxy) => proxy.kind === "json-validity");
    expect(documents.length).toBeGreaterThan(0);
    for (const proxy of documents) {
      expect(proxy.candidateShare).toBe(0);
      expect(proxy.referenceShare).toBe(0);
    }
  });

  it("puts the biggest movement first", () => {
    const deltas = report.proxies.map((proxy) => Math.abs(proxy.delta));
    expect([...deltas].sort((left, right) => right - left)).toEqual(deltas);
  });
});
