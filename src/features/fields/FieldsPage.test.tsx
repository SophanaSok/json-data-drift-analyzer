/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FieldsPage } from "./FieldsPage";
import { runAnalysis } from "../../engine/diff";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import { useUiStore } from "../../stores/ui-store";
import { useDraftStore } from "../../stores/draft-store";
import referenceData from "../../test/fixtures/bellingham-reference.json";
import candidateData from "../../test/fixtures/bellingham-candidate.json";

// The decision log lives in IndexedDB, which jsdom does not provide; the mock
// serves whatever rows a test staged and records what was persisted.
const mockDb = vi.hoisted(() => ({ rows: [] as unknown[], persisted: [] as unknown[] }));
vi.mock("../../db", () => ({
  getProfileOverride: async () => null,
  db: {
    decisions: {
      where: () => ({ equals: () => ({ toArray: async () => mockDb.rows }) }),
      bulkPut: async (rows: unknown[]) => {
        mockDb.persisted.push(...rows);
      }
    }
  }
}));

// jsdom gives every element zero size, so the real virtualizer renders no
// rows; this stand-in renders them all. The table's behavior is under test,
// not the virtualization.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({
    getTotalSize: () => options.count * 44,
    getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({ index, start: index * 44 })),
    measure: () => {},
    measureElement: () => {},
    scrollToIndex: () => {}
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
  useDraftStore.getState().reset();
  mockDb.rows = [];
  mockDb.persisted = [];
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

describe("FieldsPage decisions", () => {
  it("records a per-row decision with its reason and persists it", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&field=DueDate");

    const row = screen.getByTestId("field-cell-1B-2020");
    await user.click(within(row).getByTestId("decide-1B-2020-DueDate"));
    await user.type(within(row).getByTestId("decision-reason"), "confirmed with the agency");
    await user.click(within(row).getByTestId("decision-backfill"));

    expect(within(row).getByTestId("cell-decided").textContent).toContain("use reference");
    expect(mockDb.persisted).toHaveLength(1);
    const saved = mockDb.persisted[0] as { field: string; reason: string; actor: string };
    expect(saved.field).toBe("DueDate");
    expect(saved.reason).toBe("confirmed with the agency");
    expect(saved.actor).toBe("user");
  });

  it("renders the lane reason visibly and refuses a reasonless decision in place", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&field=DueDate");

    const row = screen.getByTestId("field-cell-1B-2020");
    expect(row.textContent).toContain("does not approve this field");

    await user.click(within(row).getByTestId("decide-1B-2020-DueDate"));
    await user.click(within(row).getByTestId("decision-backfill"));
    expect(within(row).getByTestId("decision-error").textContent).toContain("reason is required");
    expect(mockDb.persisted).toHaveLength(0);
  });

  it("offers a veto on an auto-lane cell and marks it vetoed", async () => {
    const user = userEvent.setup();
    // Title is profile-approved: its blank cells were auto-backfilled.
    renderPage("/results?tab=explore&field=Title");

    const row = screen.getByTestId("field-cell-1B-2020");
    expect(row.textContent).toContain("auto");
    await user.click(within(row).getByTestId("decide-1B-2020-Title"));
    await user.type(within(row).getByTestId("decision-reason"), "title was renamed upstream");
    await user.click(within(row).getByTestId("decision-veto"));

    expect(within(row).getByTestId("cell-decided").textContent).toBe("vetoed");
  });

  it("bulk-decides the filtered scope after an explicit confirmation naming rule 6", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&field=DueDate");

    await user.type(screen.getByTestId("bulk-reason"), "deadline list confirmed in writing");
    await user.click(screen.getByTestId("bulk-backfill"));

    const confirmation = screen.getByTestId("bulk-confirm").textContent ?? "";
    expect(confirmation).toContain("499");
    expect(screen.getByTestId("bulk-breakdown").textContent).toContain("rule-6 date-sensitive");

    await user.click(screen.getByTestId("bulk-confirm-apply"));
    expect(screen.getByTestId("bulk-outcome").textContent).toContain("Recorded 499 decision(s).");
    expect(mockDb.persisted).toHaveLength(499);
  });

  it("scopes bulk to a selected value group and says so", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&field=ContactEmail");

    await user.click(screen.getByTestId("value-group-purchasing@cob.org"));
    const scope = screen.getByTestId("bulk-scope").textContent ?? "";
    expect(scope).toContain("1 decidable cell(s)");
    expect(scope).toContain("purchasing@cob.org");
  });
});

describe("FieldsPage: By record mode", () => {
  it("toggles into record mode, lists the queue with pending counts", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("mode-record"));
    expect(screen.getByTestId("record-queue")).toBeTruthy();
    // A typical wiped record shows 4 pending review decisions.
    expect(screen.getByTestId("queue-record-1B-2020").textContent).toContain("4");
  });

  it("opens a record showing candidate, reference, and the live output with source badges", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    const panel = screen.getByTestId("record-mode-panel");
    expect(panel.textContent).toContain("1B-2020");
    // Auto-backfilled Title: output is the reference value, badged as such.
    expect(screen.getByTestId("record-output-Title").textContent).toContain("reference backfill");
    // Undecided DueDate: output is still the (blank) candidate.
    expect(screen.getByTestId("record-output-DueDate").textContent).toContain("candidate");
    void user;
  });

  it("takes the rule-6 approval once, then accept-all is a single action", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    await user.type(screen.getByTestId("record-bulk-reason"), "verified against the agency portal");
    // Until the fields are approved, accept-all is blocked and says which fields.
    const acknowledgment = screen.getByTestId("rule6-acknowledgment");
    expect(acknowledgment.textContent).toContain("rule-6 date-sensitive");
    expect(acknowledgment.textContent).toContain("DueDate");
    expect((screen.getByTestId("record-accept-all") as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByTestId("rule6-approve"));
    // The approval is now session-scoped and visible, with a way out.
    expect(screen.getByTestId("rule6-active").textContent).toContain("DueDate");
    expect(screen.getByTestId("rule6-revoke")).toBeTruthy();

    await user.click(screen.getByTestId("record-accept-all"));
    expect(mockDb.persisted).toHaveLength(4);
    expect(screen.getByTestId("last-action").textContent).toContain("Recorded 4 decision(s)");
  });

  it("does not ask for the approval again on the next record", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    await user.type(screen.getByTestId("record-bulk-reason"), "verified");
    await user.click(screen.getByTestId("rule6-approve"));
    await user.click(screen.getByTestId("record-accept-all"));

    // Auto-advanced to the next record with work; no acknowledgment prompt.
    expect(screen.queryByTestId("rule6-acknowledgment")).toBeNull();
    expect((screen.getByTestId("record-accept-all") as HTMLButtonElement).disabled).toBe(false);
  });

  it("auto-advances to the next pending record once one is resolved", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");
    const before = screen.getByTestId("record-position").textContent;

    await user.type(screen.getByTestId("record-bulk-reason"), "verified");
    await user.click(screen.getByTestId("rule6-approve"));
    await user.click(screen.getByTestId("record-accept-all"));

    expect(screen.getByTestId("record-position").textContent).not.toBe(before);
    expect(screen.getByTestId("record-mode-panel").textContent).not.toContain("1B-2020 ");
  });

  it("accepts a whole record from the keyboard alone", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    await user.type(screen.getByTestId("record-bulk-reason"), "verified");
    await user.click(screen.getByTestId("rule6-approve"));
    // Focus leaves the reason input so keystrokes are commands again.
    await user.click(screen.getByTestId("record-keymap"));
    await user.keyboard("a");

    expect(mockDb.persisted).toHaveLength(4);
  });

  it("decides a single selected field by number and Enter", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    await user.type(screen.getByTestId("record-bulk-reason"), "verified");
    await user.click(screen.getByTestId("record-keymap"));
    await user.keyboard("2");
    expect(screen.getAllByTestId(/^record-cell-/).some((row) => row.dataset.selected === "true")).toBe(true);

    await user.keyboard("{Enter}");
    expect(mockDb.persisted).toHaveLength(1);
    // A single-field batch is not a multi-field sweep, so no approval was needed.
    expect(screen.queryByTestId("rule6-active")).toBeNull();
  });

  it("ignores shortcuts while typing but not while a checkbox has focus", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");
    const before = screen.getByTestId("record-position").textContent;

    // Typing "j" into the reason must not navigate.
    await user.type(screen.getByTestId("record-bulk-reason"), "j");
    expect(screen.getByTestId("record-position").textContent).toBe(before);
    expect((screen.getByTestId("record-bulk-reason") as HTMLInputElement).value).toContain("j");

    // A checkbox is an INPUT too, but it takes no text — shortcuts must live.
    const onlyPending = screen.getByTestId("queue-only-pending");
    onlyPending.focus();
    await user.keyboard("j");
    expect(screen.getByTestId("record-position").textContent).not.toBe(before);
  });

  it("does not hijack browser chords", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");
    const before = screen.getByTestId("record-position").textContent;

    await user.click(screen.getByTestId("record-keymap"));
    await user.keyboard("{Control>}j{/Control}");
    expect(screen.getByTestId("record-position").textContent).toBe(before);
  });

  it("record decisions update the queue pending count and progress", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    await user.type(screen.getByTestId("record-bulk-reason"), "verified");
    await user.click(screen.getByTestId("rule6-approve"));
    await user.click(screen.getByTestId("record-accept-all"));

    expect(within(screen.getByTestId("queue-record-1B-2020")).getByTestId("queue-resolved")).toBeTruthy();
    expect(screen.getByTestId("record-progress").textContent).toContain("1 /");
  });

  it("next-pending moves to a record that still needs decisions", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    await user.click(screen.getByTestId("record-next-pending"));
    const position = screen.getByTestId("record-position").textContent ?? "";
    expect(position).toContain("pending");
    expect(screen.getByTestId("record-mode-panel").textContent).not.toContain("record 0 of");
  });

  it("the session reason pre-fills a per-row decision form", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    await user.type(screen.getByTestId("session-reason"), "verified against the agency portal, Aug 2026");
    const row = screen.getByTestId("record-cell-DueDate");
    await user.click(within(row).getByTestId("decide-1B-2020-DueDate"));
    const reasonInput = within(row).getByTestId("decision-reason") as HTMLInputElement;
    expect(reasonInput.value).toBe("verified against the agency portal, Aug 2026");
  });

  it("edit pre-fills the custom box with the reference value", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    const row = screen.getByTestId("record-cell-DueDate");
    await user.click(within(row).getByTestId("decide-1B-2020-DueDate"));
    const custom = within(row).getByTestId("decision-custom") as HTMLInputElement;
    expect(custom.value.length).toBeGreaterThan(0);
    // It is the reference value, ready to correct rather than retype.
    expect(row.textContent).toContain(custom.value);
  });

  it("warns on a record absent from the recovery output", async () => {
    renderPage("/results?tab=explore&mode=record");
    const user = userEvent.setup();
    // The reference-only record: dropped by the candidate run.
    const removedRow = screen
      .getAllByTestId(/^queue-record-/)
      .find((row) => row.textContent?.includes("only reference"))!;
    await user.click(removedRow);
    expect(screen.getByTestId("record-excluded-warning")).toBeTruthy();
  });
});

describe("FieldsPage: focus mode", () => {
  it("hides the queue list and page chrome, keeping the record and its controls", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    expect(screen.getByTestId("record-queue")).toBeTruthy();
    await user.click(screen.getByTestId("toggle-focus-mode"));

    expect(screen.queryByTestId("record-queue")).toBeNull();
    expect(screen.getByTestId("record-mode-panel")).toBeTruthy();
    expect(screen.getByTestId("record-bulk-bar")).toBeTruthy();
    // The session reason still governs what a keystroke records, so it stays.
    expect(screen.getByTestId("record-bulk-reason")).toBeTruthy();
  });

  it("toggles with f and leaves with Escape", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    await user.click(screen.getByTestId("record-keymap"));
    await user.keyboard("f");
    expect(screen.queryByTestId("record-queue")).toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.getByTestId("record-queue")).toBeTruthy();
  });

  it("shows the keymap on ?", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    await user.click(screen.getByTestId("record-keymap"));
    await user.keyboard("?");
    expect(screen.getByTestId("keymap-help").textContent).toContain("accept all pending");
  });
});

describe("FieldsPage: manual value entry", () => {
  it("offers typing on a field that is blank in both files", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    await user.click(screen.getByTestId("toggle-unchanged"));
    const row = screen.getByTestId("record-cell-ContractValue");
    // Nothing to accept — the control says so and offers typing instead.
    const control = within(row).getByTestId("decide-1B-2020-ContractValue");
    expect(control.textContent).toContain("Type a value");

    await user.click(control);
    expect(within(row).queryByTestId("decision-backfill")).toBeNull();
    await user.type(within(row).getByTestId("decision-reason"), "from the award letter");
    await user.type(within(row).getByTestId("decision-custom"), "48250.00");
    await user.click(within(row).getByTestId("decision-custom-apply"));

    expect(mockDb.persisted).toHaveLength(1);
    const saved = mockDb.persisted[0] as { field: string; action: string; outputValue: string };
    expect(saved.field).toBe("ContractValue");
    expect(saved.action).toBe("use_custom");
    expect(saved.outputValue).toBe("48250.00");
    expect(screen.getByTestId("record-output-ContractValue").textContent).toContain("48250.00");
  });

  it("records the typed value on Enter, so the keyboard flow never needs the mouse", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    await user.click(screen.getByTestId("toggle-unchanged"));
    const row = screen.getByTestId("record-cell-ContractValue");
    await user.click(within(row).getByTestId("decide-1B-2020-ContractValue"));
    await user.type(within(row).getByTestId("decision-reason"), "from the award letter");
    await user.type(within(row).getByTestId("decision-custom"), "48250.00{Enter}");

    expect(mockDb.persisted).toHaveLength(1);
    const saved = mockDb.persisted[0] as { action: string; outputValue: string };
    expect(saved.action).toBe("use_custom");
    expect(saved.outputValue).toBe("48250.00");
  });

  it("locks profile-excluded fields", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=1B-2020");

    await user.click(screen.getByTestId("toggle-unchanged"));
    const row = screen.getByTestId("record-cell-Created");
    expect(within(row).queryByTestId("decide-1B-2020-Created")).toBeNull();
  });
});

describe("FieldsPage: corroboration signal", () => {
  it("flags 38B-2026 in record mode with the quoted sentence, not a verdict", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&mode=record&record=38B-2026");

    const note = screen.getByTestId("corroboration-DueDate");
    expect(note.dataset.verdict).toBe("not_corroborated");
    expect(note.textContent).toContain("the record's own text says a different date");

    await user.click(within(note).getByText(/different date/));
    expect(note.textContent).toContain("no later than");
    expect(note.textContent).toContain("August 4");
    // It must not claim which side is wrong.
    expect(note.textContent).toContain("This flag does not say which");
  });

  it("marks a record whose text agrees", () => {
    renderPage("/results?tab=explore&mode=record&record=34B-2026");
    const note = screen.getByTestId("corroboration-DueDate");
    expect(note.dataset.verdict).toBe("corroborated");
    expect(note.textContent).toContain("agrees");
  });

  it("offers the disagreement filter on DueDate and narrows 499 rows to 23", async () => {
    const user = userEvent.setup();
    renderPage("/results?tab=explore&field=DueDate");

    expect(screen.getByTestId("corroboration-summary").textContent).toContain("89%");
    await user.selectOptions(screen.getByTestId("filter-corroboration"), "not_corroborated");
    expect(screen.getByTestId("field-cells-count").textContent).toContain("Showing 23 of");
  });

  it("withholds the filter on a field the text does not discuss", () => {
    renderPage("/results?tab=explore&field=PublishedDate");
    expect(screen.queryByTestId("filter-corroboration")).toBeNull();
    expect(screen.queryByTestId("corroboration-summary")).toBeNull();
  });
});
