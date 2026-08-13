import { describe, expect, it } from "vitest";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";
import { runAnalysis } from "./diff";
import { buildCorroborationReport, corroborationKey, parseDatePoint } from "./corroboration";
import { BELLINGHAM_PROCUREWARE } from "../profiles";
import type { SourceProfile } from "./adapter-types";

const analysis = runAnalysis({
  baselineData: referenceData,
  latestData: candidateData,
  baselineFileName: "bellingham-reference.json",
  latestFileName: "bellingham-candidate.json",
  analysisKey: "corroboration-test",
  config: {
    collectionPath: "Export",
    identityFields: ["ProjectCode"],
    ignoredFields: [],
    profileId: BELLINGHAM_PROCUREWARE.id
  }
});

const profile = BELLINGHAM_PROCUREWARE;
const report = buildCorroborationReport(analysis, profile);

const idOf = (recordKey: string) =>
  Object.values(analysis.recordsById).find((record) => record.recordKey === recordKey)!.id;

describe("corroboration calibration", () => {
  it("earns the signal for DueDate, where the text really does state deadlines", () => {
    const dueDate = report.fields.find((entry) => entry.field === "DueDate")!;
    // Measured on the shipped pair.
    expect(dueDate.corroborated).toBe(188);
    expect(dueDate.notCorroborated).toBe(23);
    expect(dueDate.agreementRate).toBeGreaterThan(0.85);
    expect(dueDate.trustworthy).toBe(true);
  });

  it("withholds it for fields the prose is not about", () => {
    // PublishedDate and AwardDate agree ~2% of the time: the text discusses the
    // submission deadline, not them. Flagging the rest would be noise wearing
    // the clothes of a finding.
    for (const field of ["PublishedDate", "AwardDate"]) {
      const entry = report.fields.find((candidate) => candidate.field === field)!;
      expect(entry.agreementRate).toBeLessThan(0.1);
      expect(entry.trustworthy).toBe(false);
    }
  });

  it("emits verdicts only for trustworthy fields", () => {
    const fields = new Set([...report.cells.values()].map((verdict) => verdict.field));
    expect([...fields]).toEqual(["DueDate"]);
    expect(report.cells.size).toBe(211);
  });

  it("says nothing at all when the profile does not configure it", () => {
    const unconfigured: SourceProfile = { ...profile, corroboration: undefined };
    const quiet = buildCorroborationReport(analysis, unconfigured);
    expect(quiet.unconfigured).toBe(true);
    expect(quiet.cells.size).toBe(0);
    expect(quiet.fields).toEqual([]);
  });
});

describe("corroboration verdicts on named records", () => {
  it("flags 38B-2026, whose surviving text puts the deadline a week after the reference", () => {
    // The standing evidence in the profile notes.
    const verdict = report.cells.get(corroborationKey(idOf("38B-2026"), "DueDate"))!;
    expect(verdict.verdict).toBe("not_corroborated");
    expect(verdict.evidence[0]!.matched).toContain("August 4");
    expect(verdict.evidence[0]!.quote).toContain("no later than");
    expect(verdict.evidence[0]!.sourceField).toBe("Description");
  });

  it("corroborates a record whose text states the reference deadline", () => {
    const verdict = report.cells.get(corroborationKey(idOf("34B-2026"), "DueDate"))!;
    expect(verdict.verdict).toBe("corroborated");
    // The quote is the reason to believe it, so it must be carried.
    expect(verdict.evidence.length).toBeGreaterThan(0);
    expect(verdict.evidence[0]!.quote.length).toBeGreaterThan(20);
  });

  it("ignores dates that are not deadlines", () => {
    // 60B-2019's text dates a pre-bid walkthrough; 63B-2023's dates a work
    // completion. Neither disagrees with the due date, and without the cue
    // gate both were flagged.
    for (const recordKey of ["60B-2019", "63B-2023"]) {
      const verdict = report.cells.get(corroborationKey(idOf(recordKey), "DueDate"));
      expect(verdict?.verdict ?? "no_signal").not.toBe("not_corroborated");
    }
  });
});

describe("the signal stays advisory (rule 5)", () => {
  it("produces no decision, override, or lane — only verdicts and quotes", () => {
    const shape = Object.keys(report).sort();
    expect(shape).toEqual(["cells", "fields", "unconfigured"]);
    for (const verdict of report.cells.values()) {
      expect(["corroborated", "not_corroborated", "no_signal"]).toContain(verdict.verdict);
      // Evidence is quoted text, never a replacement value.
      for (const evidence of verdict.evidence) {
        expect(typeof evidence.quote).toBe("string");
      }
    }
  });

  it("does not mutate the analysis it reads", () => {
    const before = JSON.stringify(analysis.recordsById[idOf("38B-2026")]);
    buildCorroborationReport(analysis, profile);
    expect(JSON.stringify(analysis.recordsById[idOf("38B-2026")])).toBe(before);
  });

  it("is deterministic", () => {
    const again = buildCorroborationReport(analysis, profile);
    expect(again.cells.size).toBe(report.cells.size);
    expect(again.fields).toEqual(report.fields);
  });
});

describe("parseDatePoint", () => {
  it("reads the leading date of a timestamped value", () => {
    expect(parseDatePoint("8/4/2026 11:00 AM")).toEqual({ month: 8, day: 4 });
  });

  it("returns null for anything that is not a date", () => {
    expect(parseDatePoint("Awarded")).toBeNull();
    expect(parseDatePoint("")).toBeNull();
    expect(parseDatePoint(undefined)).toBeNull();
  });
});
