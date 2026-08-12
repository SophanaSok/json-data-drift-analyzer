/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DecisionRow } from "./DecisionRow";
import { useDraftStore } from "../../stores/draft-store";
import { preview } from "./decision-display";
import { classifyCells, type RecoveryDecision } from "../../engine/decisions";
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
const cells = classifyCells(review, BELLINGHAM_PROCUREWARE);
const reviewCell = cells.find((cell) => cell.lane === "review" && cell.field === "DueDate")!;
const conflictCell = cells.find((cell) => cell.field === "BidDocuments")!;
const context = { review, profile: BELLINGHAM_PROCUREWARE, timestamp: FIXED_NOW, sequence: 0 };

// Drafts live in a global store now; a leftover draft from one test must not
// leak an open form or typed text into the next.
beforeEach(() => useDraftStore.getState().reset());
afterEach(cleanup);

function renderRow(cell = reviewCell, log: RecoveryDecision[] = [], decision?: RecoveryDecision) {
  const onRecord = vi.fn();
  render(
    <DecisionRow
      cell={cell}
      decision={decision}
      log={log}
      makeContext={() => context}
      onRecord={onRecord}
      index={0}
      draftId={`test|${cell.recordKey}|${cell.field}`}
    />
  );
  return onRecord;
}

describe("DecisionRow: what it shows", () => {
  it("previews both sides so the choice is visible without drilling in", () => {
    renderRow();
    const row = screen.getByTestId("queue-row-0").textContent ?? "";

    expect(row).toContain("DueDate");
    expect(row).toContain("candidate (blank)");
    expect(row).toContain("reference");
  });

  it("marks a cell that already carries a decision", () => {
    const decision: RecoveryDecision = {
      id: "d",
      recordKey: reviewCell.recordKey,
      field: "DueDate",
      action: "keep_candidate",
      originalValue: "",
      outputValue: "",
      actor: "user",
      reason: "left as is",
      sourceRun: null,
      referenceRun: null,
      matchingKey: [],
      profileId: BELLINGHAM_PROCUREWARE.id,
      profileVersion: 4,
      timestamp: FIXED_NOW,
      sequence: 0
    };
    renderRow(reviewCell, [decision], decision);

    expect(screen.getByTestId("cell-decided").textContent).toContain("keep candidate");
    expect(screen.getByTestId("decide-0").textContent).toBe("Change");
  });

  it("keeps the form closed until asked", () => {
    renderRow();
    expect(screen.queryByTestId("decision-form")).toBeNull();
  });
});

describe("DecisionRow: recording", () => {
  it("refuses a decision with no reason and says why", async () => {
    const user = userEvent.setup();
    const onRecord = renderRow();

    await user.click(screen.getByTestId("decide-0"));
    await user.click(screen.getByTestId("decision-backfill"));

    expect(screen.getByTestId("decision-error").textContent).toContain("reason is required");
    expect(onRecord).not.toHaveBeenCalled();
  });

  it("appends a decision carrying the reason and the reference value", async () => {
    const user = userEvent.setup();
    const onRecord = renderRow();

    await user.click(screen.getByTestId("decide-0"));
    await user.type(screen.getByTestId("decision-reason"), "confirmed with the city");
    await user.click(screen.getByTestId("decision-backfill"));

    const [next] = onRecord.mock.calls[0] as [RecoveryDecision[]];
    expect(next).toHaveLength(1);
    expect(next[0].action).toBe("backfill");
    expect(next[0].reason).toBe("confirmed with the city");
    expect(next[0].actor).toBe("user");
    expect(next[0].outputValue).toBe(reviewCell.referenceValue);
    expect(next[0].profileVersion).toBe(BELLINGHAM_PROCUREWARE.version);
  });

  it("records keeping the candidate as a decision in its own right", async () => {
    const user = userEvent.setup();
    const onRecord = renderRow();

    await user.click(screen.getByTestId("decide-0"));
    await user.type(screen.getByTestId("decision-reason"), "leave it missing");
    await user.click(screen.getByTestId("decision-keep"));

    const [next] = onRecord.mock.calls[0] as [RecoveryDecision[]];
    expect(next[0].action).toBe("keep_candidate");
    expect(next[0].outputValue).toBe(reviewCell.candidateValue);
  });

  it("refuses a custom decision with no value", async () => {
    const user = userEvent.setup();
    const onRecord = renderRow();

    await user.click(screen.getByTestId("decide-0"));
    await user.type(screen.getByTestId("decision-reason"), "corrected by hand");
    await user.click(screen.getByTestId("decision-custom-apply"));

    expect(screen.getByTestId("decision-error").textContent).toContain("carries no value");
    expect(onRecord).not.toHaveBeenCalled();
  });

  it("records a custom value when one is supplied", async () => {
    const user = userEvent.setup();
    const onRecord = renderRow();

    await user.click(screen.getByTestId("decide-0"));
    await user.type(screen.getByTestId("decision-reason"), "corrected from the notice");
    await user.type(screen.getByTestId("decision-custom"), "8/4/2026 11:00 AM");
    await user.click(screen.getByTestId("decision-custom-apply"));

    const [next] = onRecord.mock.calls[0] as [RecoveryDecision[]];
    expect(next[0].action).toBe("use_custom");
    expect(next[0].outputValue).toBe("8/4/2026 11:00 AM");
  });

  it("lets a person overwrite a populated value, which automation may not", async () => {
    const user = userEvent.setup();
    const onRecord = renderRow(conflictCell);

    await user.click(screen.getByTestId("decide-0"));
    await user.type(screen.getByTestId("decision-reason"), "documents were lost upstream");
    await user.click(screen.getByTestId("decision-backfill"));

    const [next] = onRecord.mock.calls[0] as [RecoveryDecision[]];
    expect(conflictCell.candidateIsBlank).toBe(false);
    expect(next[0].actor).toBe("user");
    expect(next[0].outputValue).toBe(conflictCell.referenceValue);
  });

  it("appends to an existing log rather than replacing it", async () => {
    const user = userEvent.setup();
    const existing: RecoveryDecision = {
      id: "decision:existing",
      recordKey: "other",
      field: "SomethingElse",
      action: "keep_candidate",
      originalValue: "",
      outputValue: "",
      actor: "user",
      reason: "earlier call",
      sourceRun: null,
      referenceRun: null,
      matchingKey: [],
      profileId: BELLINGHAM_PROCUREWARE.id,
      profileVersion: 4,
      timestamp: FIXED_NOW,
      sequence: 0
    };
    const onRecord = renderRow(reviewCell, [existing]);

    await user.click(screen.getByTestId("decide-0"));
    await user.type(screen.getByTestId("decision-reason"), "second call");
    await user.click(screen.getByTestId("decision-backfill"));

    const [next] = onRecord.mock.calls[0] as [RecoveryDecision[]];
    expect(next).toHaveLength(2);
    expect(next[0].reason).toBe("earlier call");
  });

  it("closes the form and clears the reason after recording", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByTestId("decide-0"));
    await user.type(screen.getByTestId("decision-reason"), "done");
    await user.click(screen.getByTestId("decision-keep"));

    expect(screen.queryByTestId("decision-form")).toBeNull();
  });
});

describe("DecisionRow: draft survival", () => {
  // The queue virtualizes rows, so scrolling unmounts them. Unmounting used to
  // discard the half-typed form; the draft store is what prevents that.
  it("keeps a half-typed reason across unmount and remount, as virtualization scroll does", async () => {
    const user = userEvent.setup();
    const props = {
      cell: reviewCell,
      decision: undefined,
      log: [],
      makeContext: () => context,
      onRecord: vi.fn(),
      index: 0,
      draftId: "run|cell-under-edit"
    };
    const first = render(<DecisionRow {...props} />);

    await user.click(screen.getByTestId("decide-0"));
    await user.type(screen.getByTestId("decision-reason"), "half-typed rea");
    first.unmount();

    render(<DecisionRow {...props} />);
    expect(screen.getByTestId("decision-form")).toBeTruthy();
    expect((screen.getByTestId("decision-reason") as HTMLInputElement).value).toBe("half-typed rea");
  });

  it("scopes drafts by id, so another cell's row starts blank", async () => {
    const user = userEvent.setup();
    const props = {
      cell: reviewCell,
      decision: undefined,
      log: [],
      makeContext: () => context,
      onRecord: vi.fn(),
      index: 0
    };
    const first = render(<DecisionRow {...props} draftId="run|cell-a" />);
    await user.click(screen.getByTestId("decide-0"));
    await user.type(screen.getByTestId("decision-reason"), "meant for cell a");
    first.unmount();

    render(<DecisionRow {...props} draftId="run|cell-b" />);
    expect(screen.queryByTestId("decision-form")).toBeNull();
  });

  it("clears the draft once the decision is recorded", async () => {
    const user = userEvent.setup();
    const onRecord = renderRow();

    await user.click(screen.getByTestId("decide-0"));
    await user.type(screen.getByTestId("decision-reason"), "done deliberating");
    await user.click(screen.getByTestId("decision-keep"));

    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(useDraftStore.getState().decisionDrafts).toEqual({});
  });
});

describe("preview", () => {
  it("marks blank and absent rather than showing nothing", () => {
    expect(preview("")).toBe("(blank)");
    expect(preview("   ")).toBe("(blank)");
    expect(preview(null)).toBe("(absent)");
  });

  it("flattens and truncates long values", () => {
    expect(preview("a\nb")).toBe("a b");
    expect(preview("x".repeat(80))).toContain("…");
  });
});
