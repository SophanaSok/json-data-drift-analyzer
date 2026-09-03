import { describe, expect, it } from "vitest";
import { alertFromFindings, buildDuplicateTitleTriage, buildTriageNote, newGroupTitles } from "./triage";
import { createFinding, type Finding } from "../../engine/findings";
import { runQa } from "../../engine/qa";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import referenceData from "../../test/fixtures/bellingham-reference.json";
import candidateData from "../../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const ALERT = { field: "Title", threshold: 3 };

function group(
  title: string,
  candidateCount: number,
  referenceCount: number,
  preExisting: boolean,
  keys: string[] = []
): Finding {
  return createFinding({
    severity: preExisting ? "medium" : "high",
    category: "duplicate_title",
    fieldPath: "Title",
    recordKey: null,
    candidateValue: candidateCount,
    referenceValue: referenceCount,
    message: `${candidateCount} candidate records share the Title ${JSON.stringify(title)}.`,
    evidence: {
      title,
      threshold: 3,
      candidateCount,
      referenceCount,
      preExisting,
      members: keys.map((recordKey, index) => ({ index, recordKey }))
    },
    recommendedAction: "report_only",
    discriminator: title
  });
}

const context = {
  profileLabel: "Bellingham ProcureWare",
  profileVersion: 9,
  policyHash: "14d7746e82cc4482",
  sourceRun: "candidate.json",
  referenceRun: "reference.json",
  appVersion: "1.7.0"
};

describe("duplicate-title triage", () => {
  it("says the run was not checked when the profile configures no alert", () => {
    const verdict = buildDuplicateTitleTriage([group("Salt", 4, 0, false)], null);
    expect(verdict.outcome).toBe("not-configured");
    expect(verdict.field).toBeNull();
    expect(verdict.threshold).toBeNull();
    expect(verdict.groups).toEqual([]);
    expect(verdict.headline).toContain("configures no duplicate-title alert");
  });

  it("reports a clean run as checked and clear, naming the threshold", () => {
    const verdict = buildDuplicateTitleTriage([], ALERT);
    expect(verdict.outcome).toBe("clear");
    expect(verdict.threshold).toBe(3);
    expect(verdict.headline).toBe("No Title is shared by 3 or more records in this run.");
  });

  it("calls every group recurring when the reference run held them all", () => {
    const verdict = buildDuplicateTitleTriage([group("Salt", 4, 4, true), group("Sand", 3, 5, true)], ALERT);
    expect(verdict.outcome).toBe("recurring");
    expect(verdict.preExistingGroups).toBe(2);
    expect(verdict.newGroups).toBe(0);
    expect(verdict.largestGroupSize).toBe(4);
    expect(verdict.headline).toContain("all 2 are also in the reference run");
    expect(verdict.headline).toContain("Nothing new in this run");
  });

  it("flags a new group and counts the recurring ones separately", () => {
    const verdict = buildDuplicateTitleTriage(
      [group("Salt", 4, 4, true), group("Gravel", 3, 0, false), group("Sand", 5, 5, true)],
      ALERT
    );
    expect(verdict.outcome).toBe("new");
    expect(verdict.newGroups).toBe(1);
    expect(verdict.preExistingGroups).toBe(2);
    expect(verdict.headline).toContain("1 new in this run");
    expect(verdict.headline).toContain("2 also in the reference run");
    expect(newGroupTitles(verdict)).toEqual(["Gravel"]);
  });

  it("orders new groups first, then largest first, so triage reads top-down", () => {
    const verdict = buildDuplicateTitleTriage(
      [group("Salt", 9, 9, true), group("Gravel", 3, 0, false), group("Ash", 7, 0, false)],
      ALERT
    );
    expect(verdict.groups.map((entry) => entry.title)).toEqual(["Ash", "Gravel", "Salt"]);
  });

  it("carries the member record keys through for the record links", () => {
    const verdict = buildDuplicateTitleTriage([group("Salt", 3, 3, true, ['["a"]', '["b"]', '["c"]'])], ALERT);
    expect(verdict.groups[0]?.recordKeys).toEqual(['["a"]', '["b"]', '["c"]']);
  });

  it("ignores other categories and malformed evidence rather than inventing a group", () => {
    const unrelated = createFinding({
      severity: "high",
      category: "field_regression",
      fieldPath: "Title",
      recordKey: '["a"]',
      candidateValue: "",
      referenceValue: "x",
      message: "lost",
      evidence: {},
      recommendedAction: "manual_review"
    });
    const malformed = createFinding({
      severity: "high",
      category: "duplicate_title",
      fieldPath: "Title",
      recordKey: null,
      candidateValue: null,
      referenceValue: null,
      message: "no evidence",
      evidence: { threshold: 3 },
      recommendedAction: "report_only"
    });
    const verdict = buildDuplicateTitleTriage([unrelated, malformed, group("Salt", 3, 3, true)], ALERT);
    expect(verdict.groups.map((entry) => entry.title)).toEqual(["Salt"]);
  });

  it("recovers the alert config from findings when the profile is no longer registered", () => {
    expect(alertFromFindings([group("Salt", 3, 3, true)])).toEqual({ field: "Title", threshold: 3 });
    expect(alertFromFindings([])).toBeNull();
  });
});

describe("triage note", () => {
  it("names both runs, the policy, and the build, and disclaims any action", () => {
    const verdict = buildDuplicateTitleTriage([group("Salt", 4, 4, true)], ALERT);
    const note = buildTriageNote(verdict, context);
    expect(note).toContain("Duplicate-title check — Bellingham ProcureWare");
    expect(note).toContain("Candidate run: candidate.json");
    expect(note).toContain("Reference run: reference.json");
    expect(note).toContain('- "Salt" — 4 in this run, 4 in the reference (recurring)');
    expect(note).toContain("v1.7.0");
    expect(note).toContain("Bellingham ProcureWare v9");
    expect(note).toContain("hash 14d7746e…");
    expect(note).toContain("no hold was released by this tool");
  });

  it("marks a new group as new and says when runs are unnamed", () => {
    const verdict = buildDuplicateTitleTriage([group("Gravel", 3, 0, false)], ALERT);
    const note = buildTriageNote(verdict, { ...context, sourceRun: null, referenceRun: null, policyHash: null });
    expect(note).toContain('- "Gravel" — 3 in this run, 0 in the reference (new)');
    expect(note).toContain("Candidate run: (unnamed)");
    expect(note).not.toContain("hash");
  });

  it("caps the listed groups and says how many were left out", () => {
    const many = Array.from({ length: 8 }, (_, index) => group(`Title ${index}`, 3 + index, 3, true));
    const note = buildTriageNote(buildDuplicateTitleTriage(many, ALERT), context);
    expect(note.match(/^- "/gm)).toHaveLength(5);
    expect(note).toContain("…and 3 more");
  });
});

describe("duplicate-title triage on the real fixtures", () => {
  it("reads the reference run's six recurring groups as nothing new", () => {
    const qa = runQa(referenceRecords, referenceRecords, BELLINGHAM_PROCUREWARE, {
      generatedAt: "2026-09-03T00:00:00.000Z"
    });
    const verdict = buildDuplicateTitleTriage(qa.findings, BELLINGHAM_PROCUREWARE.alerts?.duplicateTitle ?? null);
    expect(verdict.outcome).toBe("recurring");
    expect(verdict.groups).toHaveLength(6);
    expect(verdict.newGroups).toBe(0);
    expect(verdict.largestGroupSize).toBe(5);
  });

  it("reads the wiped candidate as clear rather than as one giant duplicate group", () => {
    const qa = runQa(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE, {
      generatedAt: "2026-09-03T00:00:00.000Z"
    });
    const verdict = buildDuplicateTitleTriage(qa.findings, BELLINGHAM_PROCUREWARE.alerts?.duplicateTitle ?? null);
    expect(verdict.outcome).toBe("clear");
    expect(verdict.groups).toEqual([]);
  });
});
