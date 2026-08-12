/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RecordInspector } from "./RecordInspector";
import { changedRecords } from "./recovery-review-table";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import referenceData from "../../test/fixtures/bellingham-reference.json";
import candidateData from "../../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const review = runRecoveryReview(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE, {
  generatedAt: "2026-08-10T00:00:00.000Z"
});
const recordKey = changedRecords(review)[0]!.recordKey;

afterEach(cleanup);

/** The row for one field, as rendered. */
function rowFor(field: string): HTMLTableRowElement {
  const cell = [...screen.getAllByRole("cell")].find((element) => element.textContent === field);
  if (!cell) throw new Error(`no row rendered for ${field}`);
  return cell.closest("tr") as HTMLTableRowElement;
}

describe("RecordInspector: the candidate versus reference distinction", () => {
  it("badges a recovered value as reference_backfill, never as candidate", () => {
    render(<RecordInspector review={review} recordKey={recordKey} />);
    const row = rowFor("Title");

    expect(row.textContent).toContain("reference_backfill");
    expect(row.textContent).not.toContain("(blank)reference");
  });

  it("badges an untouched value as candidate", () => {
    render(<RecordInspector review={review} recordKey={recordKey} />);
    // ProjectCode is never backfilled: the candidate always had it.
    expect(rowFor("ProjectCode").textContent).toContain("candidate");
  });

  it("shows the candidate value as blank where recovery filled it", () => {
    render(<RecordInspector review={review} recordKey={recordKey} />);
    const cells = [...rowFor("Title").querySelectorAll("td")].map((cell) => cell.textContent);

    // Field, candidate, reference, output, source.
    expect(cells[0]).toBe("Title");
    expect(cells[1]).toBe("(blank)");
    expect(cells[3]).not.toBe("(blank)");
  });

  it("says a reference value was not compared rather than implying it matched", () => {
    render(<RecordInspector review={review} recordKey={recordKey} />);
    // AgentID is identical on both sides, so no finding recorded a reference value.
    expect(rowFor("AgentID").textContent).toContain("not compared");
  });

  it("renders one row per field in the output record", () => {
    render(<RecordInspector review={review} recordKey={recordKey} />);
    const rows = screen.getAllByRole("row");
    // 45 source fields plus the header row.
    expect(rows).toHaveLength(46);
  });
});

describe("RecordInspector: context", () => {
  it("reports the match status and how much changed", () => {
    render(<RecordInspector review={review} recordKey={recordKey} />);
    const context = screen.getByTestId("record-inspector").textContent ?? "";

    expect(context).toContain("matched_primary");
    expect(context).toContain("field(s) changed");
    expect(context).toContain("candidate #");
    expect(context).toContain("reference #");
  });

  it("renders nothing for an unknown record rather than an empty frame", () => {
    const { container } = render(<RecordInspector review={review} recordKey="no-such-record" />);
    expect(container.firstChild).toBeNull();
  });
});
