/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FieldsPage } from "./FieldsPage";
import { runAnalysis } from "../../engine/diff";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import { useUiStore } from "../../stores/ui-store";
import referenceData from "../../test/fixtures/bellingham-reference.json";
import candidateData from "../../test/fixtures/bellingham-candidate.json";

// jsdom gives every element zero size, so the real virtualizer renders no
// rows; this stand-in renders them all. The table's behavior is under test,
// not the virtualization.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({
    getTotalSize: () => options.count * 44,
    getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({ index, start: index * 44 })),
    measure: () => {},
    measureElement: () => {}
  })
}));

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const analysis = runAnalysis({
  baselineData: referenceData,
  latestData: candidateData,
  baselineFileName: "bellingham-reference.json",
  latestFileName: "bellingham-candidate.json",
  analysisKey: "fields-page-test",
  config: {
    collectionPath: "Export",
    identityFields: ["ProjectCode"],
    ignoredFields: [],
    profileId: BELLINGHAM_PROCUREWARE.id
  }
});

const review = runRecoveryReview(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE, {
  generatedAt: "2026-08-12T00:00:00.000Z",
  sourceRun: "bellingham-candidate.json",
  referenceRun: "bellingham-reference.json"
});

afterEach(() => {
  cleanup();
  useUiStore.setState({ analysis: null, review: null });
});

function renderPage(initialEntry = "/results?tab=explore", withReview = true) {
  useUiStore.setState({ analysis, review: withReview ? review : null });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <FieldsPage />
    </MemoryRouter>
  );
}

describe("FieldsPage", () => {
  it("lists every analyzed field with fill transitions and review counts", () => {
    renderPage();
    expect(screen.getByTestId("field-row-DueDate")).toBeTruthy();
    expect(screen.getByTestId("field-row-Title").textContent).toContain("100% → 0%");
    // Default sort is by cells awaiting review, descending: DueDate's 499 near the top.
    const rows = screen.getAllByTestId(/^field-row-/);
    expect(rows.length).toBe(analysis.fieldStats.length);
  });

  it("selects a field via keyboard and shows its detail with the §6.3 evidence", async () => {
    const user = userEvent.setup();
    renderPage();

    screen.getByTestId("field-row-ContactPhone").focus();
    await user.keyboard("{Enter}");

    const evidence = screen.getByTestId("field-evidence").textContent ?? "";
    expect(evidence).toContain("171");
    expect(screen.getByTestId("volatility-unmeasurable").textContent).toContain(
      "volatility unmeasurable from this run pair"
    );
  });

  it("honors a ?field= deep link and degrades a stale one to no selection", () => {
    renderPage("/results?tab=explore&field=DueDate");
    expect(screen.getByTestId("field-detail")).toBeTruthy();
    expect(screen.getByTestId("field-evidence").textContent).toContain("499");
    cleanup();

    renderPage("/results?tab=explore&field=NotARealField");
    expect(screen.getByTestId("field-detail-prompt")).toBeTruthy();
  });

  it("shows the groupable distribution for a closed-taxonomy field, case variants distinct", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&field=ContactEmail");

    expect(screen.getByTestId("distribution-groups")).toBeTruthy();
    expect(screen.getByTestId("value-group-bids@cob.org")).toBeTruthy();
    expect(screen.getByTestId("value-group-BIDS@COB.ORG")).toBeTruthy();
    // The singleton is visible without expanding anything.
    expect(screen.getByTestId("value-group-purchasing@cob.org")).toBeTruthy();
    expect(screen.getByTestId("value-group-caveat").textContent).toContain("each record's own reference value");

    // Clicking a group filters the table to that value group.
    await user.click(screen.getByTestId("value-group-purchasing@cob.org"));
    expect(screen.getByTestId("field-cells-count").textContent).toContain("Showing 1 of");
  });

  it("declares a high-cardinality field too varied to group", () => {
    renderPage("/results?tab=explore&field=DueDate");
    expect(screen.getByTestId("distribution-high-cardinality").textContent).toContain("too varied to review by group");
  });

  it("filters by situation and resets", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&field=Description");

    await user.selectOptions(screen.getByTestId("filter-situation"), "conflict");
    const filtered = screen.getByTestId("field-cells-count").textContent ?? "";
    expect(filtered).toMatch(/Showing 1 of/);

    await user.click(screen.getByTestId("field-filter-reset"));
    expect(screen.getByTestId("field-cells-count").textContent).toContain(`of ${501}`);
  });

  it("expands a long value in place instead of truncating it forever", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&field=Description");

    const expanders = screen.getAllByTestId(/^expand-/);
    expect(expanders.length).toBeGreaterThan(0);
    const first = expanders[0]!;
    expect(first.textContent).toContain("characters");
    await user.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
  });

  it("still visualizes without a review, saying why decisions are off", () => {
    renderPage("/results?tab=explore&field=DueDate", false);
    expect(screen.getByTestId("fields-no-review")).toBeTruthy();
    expect(screen.getByTestId("decisions-unavailable").textContent).toContain("No recovery review");
    // Values are still there.
    expect(screen.getByTestId("field-evidence").textContent).toContain("499");
  });

  it("asks for an analysis when none exists", () => {
    useUiStore.setState({ analysis: null, review: null });
    render(
      <MemoryRouter initialEntries={["/results?tab=explore"]}>
        <FieldsPage />
      </MemoryRouter>
    );
    expect(screen.getByText("Run an analysis first.")).toBeTruthy();
  });
});
