/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ContractorTicketPage } from "./ContractorTicketPage";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import { useUiStore } from "../../stores/ui-store";
import { useDraftStore } from "../../stores/draft-store";

// The page reads posting history and the saved Trello list from IndexedDB,
// which jsdom does not provide; empty history is the state under test anyway.
vi.mock("../../db", () => ({
  db: {
    postedTickets: { toArray: async () => [], put: async () => undefined },
    trelloTarget: { get: async () => undefined, put: async () => undefined }
  }
}));

const FIXED_NOW = "2026-08-10T00:00:00.000Z";

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
    BidURL: "https://cob.procureware.com/Bids/aaa",
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

beforeEach(() => {
  useUiStore.setState({ review });
  useDraftStore.getState().reset();
});

afterEach(() => {
  cleanup();
  useUiStore.setState({ review: null });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ContractorTicketPage />
    </MemoryRouter>
  );
}

describe("ContractorTicketPage: the optional-context form survives leaving the tab", () => {
  // Switching tabs unmounts this page. The form used to be component state,
  // so evidence typed before a detour to another tab was silently discarded.
  it("keeps typed evidence and identification across unmount and remount", async () => {
    const user = userEvent.setup();
    const first = renderPage();

    await user.type(screen.getByTestId("root-cause-evidence"), "scraper log: 403 on /Bids");
    await user.click(screen.getByTestId("add-identification"));
    await user.type(screen.getByTestId("identification-label-0"), "Agent");
    first.unmount();

    renderPage();
    expect((screen.getByTestId("root-cause-evidence") as HTMLTextAreaElement).value).toBe(
      "scraper log: 403 on /Bids"
    );
    expect((screen.getByTestId("identification-label-0") as HTMLInputElement).value).toBe("Agent");
  });

  it("typed evidence reaches the draft it belongs to", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByTestId("root-cause-evidence"), "vendor reply: export disabled");

    expect(screen.getByTestId("draft-markdown").textContent).toContain("vendor reply: export disabled");
  });
});
