/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RecoveryReviewPage } from "./RecoveryReviewPage";
import { classifyCells, createDecision, type RecoveryDecision } from "../../engine/decisions";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import { useUiStore } from "../../stores/ui-store";

// The page reads its decision log from IndexedDB; the mock serves whatever rows a
// test staged, so the wiring from "persisted decision" to "exported artifact" is
// exercised without a browser database.
const mockDb = vi.hoisted(() => ({ rows: [] as Array<RecoveryDecision & { analysisKey: string }> }));
vi.mock("../../db", () => ({
  getProfileOverride: async () => null,
  db: {
    decisions: {
      where: () => ({ equals: () => ({ toArray: async () => mockDb.rows }) }),
      bulkPut: async () => undefined
    }
  }
}));

const FIXED_NOW = "2026-08-10T00:00:00.000Z";
const DECIDED_AT = "2026-08-10T03:00:00.000Z";

// A fallback-matched record (primary key BidURL changed, paired on ProjectCode),
// so this also proves end-to-end that a decision on a fallback-matched record
// reaches the export — the exact combination that used to be silently dropped.
const reference = [
  {
    AgentID: "1431",
    ProjectCode: "10B-2026",
    BidURL: "https://cob.procureware.com/Bids/aaa",
    Title: "Water Main",
    BidType: "RFP",
    DueDate: "7/29/2026",
    Description: "x"
  }
];
const candidate = [
  {
    AgentID: "1431",
    ProjectCode: "10B-2026",
    BidURL: "https://cob.procureware.com/Bids/bbb",
    Title: "",
    BidType: "",
    DueDate: "",
    Description: "x"
  }
];

const review = runRecoveryReview(reference, candidate, BELLINGHAM_PROCUREWARE, {
  generatedAt: FIXED_NOW,
  sourceRun: "candidate.json",
  referenceRun: "reference.json"
});

function backfillDecision(): RecoveryDecision {
  const cells = classifyCells(review, BELLINGHAM_PROCUREWARE);
  const dueDateCell = cells.find((cell) => cell.field === "DueDate" && cell.lane === "review")!;
  return createDecision(
    { recordKey: dueDateCell.recordKey, field: "DueDate", action: "backfill", reason: "confirmed with agency" },
    dueDateCell,
    { review, profile: BELLINGHAM_PROCUREWARE, timestamp: DECIDED_AT, sequence: 0 }
  );
}

beforeEach(() => {
  mockDb.rows = [];
  useUiStore.setState({ review });
});

afterEach(() => {
  cleanup();
  useUiStore.setState({ review: null });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <RecoveryReviewPage />
    </MemoryRouter>
  );
}

describe("RecoveryReviewPage: recorded decisions reach the export", () => {
  it("no longer claims to be read-only while recording decisions", () => {
    renderPage();
    const page = screen.getByTestId("recovery-review").textContent ?? "";

    expect(page).not.toContain("this view is read-only");
    expect(page).toContain("applied to the exported artifacts");
  });

  it("applies a persisted decision to the export bundle and says so", async () => {
    mockDb.rows = [{ ...backfillDecision(), analysisKey: review.generatedAt }];
    renderPage();

    const applied = await screen.findByTestId("decisions-applied");
    expect(applied.textContent).toContain("1 recorded decision(s) applied");
    expect(screen.queryByTestId("decisions-unapplied")).toBeNull();
  });

  it("shows nothing about applied decisions when none were recorded", () => {
    renderPage();
    expect(screen.queryByTestId("decisions-applied")).toBeNull();
  });

  it("surfaces a decision that could not be applied instead of dropping it", async () => {
    const stray: RecoveryDecision = {
      ...backfillDecision(),
      recordKey: '["1431","no-such-record"]'
    };
    mockDb.rows = [{ ...stray, analysisKey: review.generatedAt }];
    renderPage();

    const unapplied = await screen.findByTestId("decisions-unapplied");
    expect(unapplied.textContent).toContain("could NOT be applied");
    expect(unapplied.textContent).toContain("DueDate");
  });
});

describe("RecoveryReviewPage: the gate verdict states its scope", () => {
  it("says export is permitted, names the residual review queue, and calls out systemic loss", () => {
    renderPage();
    const state = screen.getByTestId("export-state");

    expect(state.getAttribute("data-state")).toBe("safe");
    expect(state.textContent).toContain("Export permitted");
    // "Passes the gate" must not read as "clean data": the unrecovered cells are named.
    expect(state.textContent).toContain("cell(s) still await manual review");
    expect(state.textContent).not.toContain("Safe to export");

    // Title, BidType, and DueDate were lost in every matched record of this pair.
    const warning = screen.getByTestId("systemic-regression-warning").textContent ?? "";
    expect(warning).toContain("Title");
    expect(warning).toContain("DueDate");
    expect(warning).toContain("every matched record");
  });
});

describe("RecoveryReviewPage: one-file hand-back", () => {
  function captureDownloads() {
    const names: string[] = [];
    const created: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: (blob: Blob) => {
        created.push(blob);
        return "blob:test";
      }
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    return {
      names,
      created,
      restore: () => {
        click.mockRestore();
        Reflect.deleteProperty(URL, "createObjectURL");
        Reflect.deleteProperty(URL, "revokeObjectURL");
      }
    };
  }

  it("offers the zip and manifest downloads next to the individual artifacts", () => {
    renderPage();
    expect(screen.getByTestId("download-zip").textContent).toContain("Download bundle (.zip)");
    expect(screen.getByTestId("download-manifest")).toBeTruthy();
    expect(screen.getByTestId("export-bundle-controls").textContent).toContain("SHA-256");
  });

  it("downloads one zip named after the profile and run", async () => {
    const downloads = captureDownloads();
    try {
      renderPage();
      screen.getByTestId("download-zip").click();
      await vi.waitFor(() => expect(downloads.names).toHaveLength(1));
      expect(downloads.names[0]).toBe(`bellingham-procureware-bundle-${FIXED_NOW.replace(/[:.]/g, "-")}.zip`);
      expect(downloads.created[0]?.type).toBe("application/zip");
    } finally {
      downloads.restore();
    }
  });

  it("downloads a manifest that counts the decisions in force", async () => {
    mockDb.rows = [{ ...backfillDecision(), analysisKey: review.generatedAt }];
    const downloads = captureDownloads();
    try {
      renderPage();
      await screen.findByTestId("decisions-applied");
      screen.getByTestId("download-manifest").click();
      await vi.waitFor(() => expect(downloads.names).toHaveLength(1));
      expect(downloads.names[0]).toContain("-manifest-");
      // jsdom's Blob has no text(); FileReader is the portable way to read it.
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(downloads.created[0]!);
      });
      expect(JSON.parse(text).decisions).toEqual({ applied: 1, recorded: 1 });
    } finally {
      downloads.restore();
    }
  });
});
