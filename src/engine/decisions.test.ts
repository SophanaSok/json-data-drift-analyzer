import { describe, expect, it } from "vitest";
import {
  appendDecision,
  appendDecisions,
  createBulkDecisions,
  cellId,
  classifyCells,
  countLanes,
  createDecision,
  decisionHistory,
  decisionsToOverrides,
  resolveDecisions,
  summarizeDecisions,
  type CellClassification,
  type RecoveryDecision
} from "./decisions";
import { runRecoveryReview } from "./review";
import { runRecovery } from "./recovery";
import { matchRecords } from "./matchRecords";
import { runQa } from "./qa";
import { BELLINGHAM_PROCUREWARE } from "../profiles";
import type { SourceProfile } from "./adapter-types";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const FIXED_NOW = "2026-08-10T00:00:00.000Z";
const LATER = "2026-08-10T01:00:00.000Z";

const review = runRecoveryReview(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE, {
  generatedAt: FIXED_NOW,
  sourceRun: "candidate.json",
  referenceRun: "reference.json"
});

const cells = classifyCells(review, BELLINGHAM_PROCUREWARE);
const context = { review, profile: BELLINGHAM_PROCUREWARE, timestamp: FIXED_NOW, sequence: 0 };

const reviewCell = cells.find((cell) => cell.lane === "review" && cell.field === "DueDate")!;
const autoCell = cells.find((cell) => cell.lane === "auto")!;

describe("lane classification", () => {
  it("accounts for every comparable finding", () => {
    const counts = countLanes(cells);
    expect(counts.auto + counts.review + counts.ineligible).toBe(cells.length);
    expect(cells.length).toBe(3399);
  });

  it("puts recovered cells in the auto lane and the rest in review", () => {
    const counts = countLanes(cells);
    expect(counts.auto).toBe(1407);
    expect(counts.review).toBe(1992);
  });

  it("marks the approved fields auto and the withheld fields review", () => {
    const laneFor = (field: string) => cells.find((cell) => cell.field === field)?.lane;

    expect(laneFor("Title")).toBe("auto");
    expect(laneFor("ContactEmail")).toBe("auto");
    expect(laneFor("DueDate")).toBe("review");
    expect(laneFor("BidStatus")).toBe("review");
  });

  it("explains a review cell in terms a reviewer can act on", () => {
    expect(reviewCell.reason).toContain("does not approve this field");
    const conflict = cells.find((cell) => cell.field === "BidDocuments")!;
    expect(conflict.reason).toContain("Both sides hold a value");
  });

  it("records whether the candidate was blank and whether policy permits the field", () => {
    expect(reviewCell.candidateIsBlank).toBe(true);
    expect(reviewCell.profilePermitsField).toBe(false);
    expect(autoCell.profilePermitsField).toBe(true);
  });

  it("marks a cell ineligible when no reference value was recorded", () => {
    const noReference = classifyCells(
      {
        ...review,
        qa: {
          ...review.qa,
          findings: [
            {
              ...review.qa.findings[0],
              recordKey: "k",
              fieldPath: "F",
              category: "field_regression",
              candidateValue: "",
              referenceValue: null
            }
          ]
        }
      },
      BELLINGHAM_PROCUREWARE
    );

    expect(noReference[0].lane).toBe("ineligible");
    expect(noReference[0].reason).toContain("nothing to decide between");
  });
});

describe("recording a decision", () => {
  it("captures the full rule 7 tuple", () => {
    const decision = createDecision(
      { recordKey: reviewCell.recordKey, field: "DueDate", action: "backfill", reason: "confirmed with the city" },
      reviewCell,
      context
    );

    expect(decision.actor).toBe("user");
    expect(decision.reason).toBe("confirmed with the city");
    expect(decision.originalValue).toBe(reviewCell.candidateValue);
    expect(decision.outputValue).toBe(reviewCell.referenceValue);
    expect(decision.sourceRun).toBe("candidate.json");
    expect(decision.referenceRun).toBe("reference.json");
    expect(decision.matchingKey).toEqual(["AgentID", "BidURL"]);
    expect(decision.profileId).toBe("bellingham-procureware");
    expect(decision.profileVersion).toBe(BELLINGHAM_PROCUREWARE.version);
    expect(decision.timestamp).toBe(FIXED_NOW);
  });

  it("writes the candidate value for keep_candidate", () => {
    const decision = createDecision(
      { recordKey: reviewCell.recordKey, field: "DueDate", action: "keep_candidate", reason: "leave it missing" },
      reviewCell,
      context
    );
    expect(decision.outputValue).toBe(reviewCell.candidateValue);
  });

  it("writes the supplied value for use_custom", () => {
    const decision = createDecision(
      {
        recordKey: reviewCell.recordKey,
        field: "DueDate",
        action: "use_custom",
        customValue: "8/4/2026 11:00 AM",
        reason: "corrected from the notice"
      },
      reviewCell,
      context
    );
    expect(decision.outputValue).toBe("8/4/2026 11:00 AM");
  });

  it("refuses a decision with no reason", () => {
    expect(() =>
      createDecision({ recordKey: "k", field: "DueDate", action: "backfill", reason: "  " }, reviewCell, context)
    ).toThrow(/reason is required/);
  });

  it("refuses a custom decision carrying no value", () => {
    expect(() =>
      createDecision({ recordKey: "k", field: "DueDate", action: "use_custom", reason: "because" }, reviewCell, context)
    ).toThrow(/carries no value/);
  });

  it("refuses to decide on an ineligible cell", () => {
    const ineligible: CellClassification = { ...reviewCell, lane: "ineligible" };
    expect(() =>
      createDecision({ recordKey: "k", field: "DueDate", action: "backfill", reason: "because" }, ineligible, context)
    ).toThrow(/no reference value/);
  });

  it("allows a person to overwrite a populated value, which automation may not", () => {
    // Rule 3 binds automation, not people. The record shows who acted.
    const conflict = cells.find((cell) => cell.field === "BidDocuments")!;
    const decision = createDecision(
      { recordKey: conflict.recordKey, field: "BidDocuments", action: "backfill", reason: "documents were lost" },
      conflict,
      context
    );

    expect(conflict.candidateIsBlank).toBe(false);
    expect(decision.actor).toBe("user");
    expect(decision.outputValue).toBe(conflict.referenceValue);
  });
});

describe("the log is append-only", () => {
  const first = createDecision(
    { recordKey: "record-1", field: "DueDate", action: "backfill", reason: "first call" },
    reviewCell,
    context
  );
  const second = createDecision(
    { recordKey: "record-1", field: "DueDate", action: "keep_candidate", reason: "changed my mind" },
    reviewCell,
    { ...context, timestamp: LATER, sequence: 1 }
  );

  it("appends rather than replacing", () => {
    const log = appendDecision(appendDecision([], first), second);
    expect(log).toHaveLength(2);
    expect(log[0].reason).toBe("first call");
  });

  it("does not mutate the log it was given", () => {
    const original: RecoveryDecision[] = [first];
    appendDecision(original, second);
    expect(original).toHaveLength(1);
  });

  it("resolves a cell to its most recent decision", () => {
    const log = appendDecision(appendDecision([], first), second);
    const resolved = resolveDecisions(log);

    expect(resolved.size).toBe(1);
    expect(resolved.get(cellId("record-1", "DueDate"))?.action).toBe("keep_candidate");
  });

  it("keeps the superseded entry in the history", () => {
    // "Backfilled, then reverted" is a different history from "never touched".
    const log = appendDecision(appendDecision([], first), second);
    const history = decisionHistory(log, "record-1", "DueDate");

    expect(history.map((entry) => entry.action)).toEqual(["backfill", "keep_candidate"]);
  });

  it("summarizes entries, decided cells, and revisions separately", () => {
    const log = appendDecision(appendDecision([], first), second);
    const summary = summarizeDecisions(log);

    expect(summary.totalEntries).toBe(2);
    expect(summary.cellsDecided).toBe(1);
    expect(summary.revisedCells).toBe(1);
    expect(summary.byAction.keep_candidate).toBe(1);
    expect(summary.byAction.backfill).toBe(0);
  });
});

describe("applying decisions", () => {
  it("turns decisions in force into overrides", () => {
    const decision = createDecision(
      { recordKey: "record-1", field: "DueDate", action: "backfill", reason: "confirmed" },
      reviewCell,
      context
    );
    const overrides = decisionsToOverrides(resolveDecisions([decision]));

    expect(overrides).toEqual([
      { recordKey: "record-1", field: "DueDate", value: reviewCell.referenceValue, reason: "confirmed" }
    ]);
  });

  it("produces no override for keep_candidate, which records a choice not an edit", () => {
    const decision = createDecision(
      { recordKey: "record-1", field: "DueDate", action: "keep_candidate", reason: "leave it" },
      reviewCell,
      context
    );
    expect(decisionsToOverrides(resolveDecisions([decision]))).toEqual([]);
  });

  it("orders overrides deterministically", () => {
    const make = (recordKey: string, field: string) =>
      createDecision({ recordKey, field, action: "backfill", reason: "r" }, reviewCell, context);
    const overrides = decisionsToOverrides(
      resolveDecisions([make("b", "Z"), make("a", "B"), make("a", "A")])
    );

    expect(overrides.map((entry) => `${entry.recordKey}.${entry.field}`)).toEqual(["a.A", "a.B", "b.Z"]);
  });

  it("changes the recovered artifact when fed back through recovery", () => {
    const profile: SourceProfile = BELLINGHAM_PROCUREWARE;
    const matchReport = matchRecords(referenceRecords, candidateRecords, profile);
    const qa = runQa(referenceRecords, candidateRecords, profile, { matchReport, generatedAt: FIXED_NOW });

    const target = cells.find((cell) => cell.lane === "review" && cell.field === "DueDate")!;
    const decision = createDecision(
      { recordKey: target.recordKey, field: "DueDate", action: "backfill", reason: "operator confirmed" },
      target,
      context
    );

    const withDecision = runRecovery(candidateRecords, referenceRecords, profile, matchReport, qa.findings, {
      generatedAt: FIXED_NOW,
      manualOverrides: decisionsToOverrides(resolveDecisions([decision]))
    });

    const record = withDecision.recovered.find((entry) => entry.recordKey === target.recordKey);
    expect(record?.record.DueDate).toBe(target.referenceValue);
    expect(record?.overriddenFields).toContain("DueDate");

    // Recorded as a person's action, not as something the candidate run produced.
    const entry = withDecision.provenance.find(
      (item) => item.recordKey === target.recordKey && item.field === "DueDate"
    );
    expect(entry?.source).toBe("manual_override");
    expect(entry?.actor).toBe("user");
  });

  it("leaves the artifact untouched when the only decision is keep_candidate", () => {
    const profile: SourceProfile = BELLINGHAM_PROCUREWARE;
    const matchReport = matchRecords(referenceRecords, candidateRecords, profile);
    const qa = runQa(referenceRecords, candidateRecords, profile, { matchReport, generatedAt: FIXED_NOW });

    const target = cells.find((cell) => cell.lane === "review" && cell.field === "DueDate")!;
    const decision = createDecision(
      { recordKey: target.recordKey, field: "DueDate", action: "keep_candidate", reason: "leave it missing" },
      target,
      context
    );

    const result = runRecovery(candidateRecords, referenceRecords, profile, matchReport, qa.findings, {
      generatedAt: FIXED_NOW,
      manualOverrides: decisionsToOverrides(resolveDecisions([decision]))
    });

    expect(result.summary.overriddenFieldCount).toBe(0);
    expect(result.recovered.find((entry) => entry.recordKey === target.recordKey)?.record.DueDate).toBe("");
  });
});

describe("cell identity", () => {
  it("distinguishes cells that differ only by where the separator falls", () => {
    expect(cellId("a b", "c")).not.toBe(cellId("a", "b c"));
  });
});

describe("bulk decisions", () => {
  const dueDateCells = cells.filter((cell) => cell.lane === "review" && cell.field === "DueDate");

  it("records one entry per cell so provenance stays per-record", () => {
    const result = createBulkDecisions(dueDateCells, { action: "backfill", reason: "confirmed in writing" }, context);

    expect(result.applied).toBe(499);
    expect(result.decisions).toHaveLength(499);
    expect(result.skipped).toEqual([]);
  });

  it("copies each cell's own reference value, never a shared one", () => {
    // The modal-value trap: one literal written everywhere would flatten records
    // that legitimately differ.
    const result = createBulkDecisions(dueDateCells, { action: "backfill", reason: "confirmed" }, context);
    const outputs = new Set(result.decisions.map((decision) => String(decision.outputValue)));

    expect(outputs.size).toBeGreaterThan(1);
    for (const decision of result.decisions) {
      const cell = dueDateCells.find((entry) => entry.recordKey === decision.recordKey)!;
      expect(decision.outputValue).toBe(cell.referenceValue);
    }
  });

  it("gives every entry a distinct id", () => {
    const result = createBulkDecisions(dueDateCells, { action: "backfill", reason: "confirmed" }, context);
    const ids = new Set(result.decisions.map((decision) => decision.id));
    expect(ids.size).toBe(result.decisions.length);
  });

  it("carries the same reason on every entry", () => {
    const result = createBulkDecisions(dueDateCells.slice(0, 5), { action: "keep_candidate", reason: "left as is" }, context);
    for (const decision of result.decisions) {
      expect(decision.reason).toBe("left as is");
      expect(decision.actor).toBe("user");
    }
  });

  it("refuses a bulk decision with no reason", () => {
    expect(() => createBulkDecisions(dueDateCells, { action: "backfill", reason: "  " }, context)).toThrow(
      /reason is required/
    );
  });

  it("refuses a custom value in bulk", () => {
    expect(() =>
      createBulkDecisions(
        dueDateCells,
        { action: "use_custom" as unknown as "backfill", reason: "because" },
        context
      )
    ).toThrow(/cannot be applied in bulk/);
  });

  it("skips ineligible cells and reports them rather than dropping them", () => {
    const ineligible: CellClassification = { ...dueDateCells[0], lane: "ineligible", recordKey: "no-reference" };
    const result = createBulkDecisions([dueDateCells[0], ineligible], { action: "backfill", reason: "r" }, context);

    expect(result.applied).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].recordKey).toBe("no-reference");
    expect(result.skipped[0].reason).toContain("No reference value");
  });

  it("appends the whole batch without disturbing what came before", () => {
    const existing = createDecision(
      { recordKey: "earlier", field: "DueDate", action: "keep_candidate", reason: "earlier call" },
      reviewCell,
      context
    );
    const result = createBulkDecisions(dueDateCells.slice(0, 3), { action: "backfill", reason: "bulk" }, {
      ...context,
      sequence: 1
    });
    const log = appendDecisions([existing], result.decisions);

    expect(log).toHaveLength(4);
    expect(log[0].reason).toBe("earlier call");
    expect(new Set(log.map((entry) => entry.id)).size).toBe(4);
  });

  it("supersedes an earlier per-cell decision without erasing it", () => {
    const single = createDecision(
      { recordKey: dueDateCells[0].recordKey, field: "DueDate", action: "keep_candidate", reason: "first" },
      dueDateCells[0],
      context
    );
    const bulk = createBulkDecisions(dueDateCells.slice(0, 1), { action: "backfill", reason: "bulk override" }, {
      ...context,
      sequence: 1
    });
    const log = appendDecisions([single], bulk.decisions);
    const resolved = resolveDecisions(log);

    expect(log).toHaveLength(2);
    expect(resolved.get(cellId(dueDateCells[0].recordKey, "DueDate"))?.reason).toBe("bulk override");
    expect(decisionHistory(log, dueDateCells[0].recordKey, "DueDate")).toHaveLength(2);
  });
});

describe("decision ids stay unique across a reversal", () => {
  it("does not reuse an id when a decision is reverted and remade", () => {
    // Same cell, same action, same timestamp: only the sequence differs, and without
    // it a keyed store would overwrite the first entry.
    const first = createDecision(
      { recordKey: "r", field: "DueDate", action: "backfill", reason: "one" },
      reviewCell,
      { ...context, sequence: 0 }
    );
    const reverted = createDecision(
      { recordKey: "r", field: "DueDate", action: "keep_candidate", reason: "two" },
      reviewCell,
      { ...context, sequence: 1 }
    );
    const remade = createDecision(
      { recordKey: "r", field: "DueDate", action: "backfill", reason: "three" },
      reviewCell,
      { ...context, sequence: 2 }
    );

    expect(new Set([first.id, reverted.id, remade.id]).size).toBe(3);
  });
});
