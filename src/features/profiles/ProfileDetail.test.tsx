/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileDetail } from "./ProfileDetail";
import type { SavedProfileOverride } from "../../db";
import { useProfileOverrideStore } from "../../stores/profile-override-store";

// The override store lives in IndexedDB, which jsdom does not provide; the
// mock serves whatever row a test staged and records writes and deletes.
const mockDb = {
  row: null as SavedProfileOverride | null,
  puts: [] as SavedProfileOverride[],
  deletes: [] as string[],
  failPut: false
};
vi.mock("../../db", () => ({
  getProfileOverride: async () => mockDb.row,
  putProfileOverride: async (override: SavedProfileOverride) => {
    if (mockDb.failPut) throw new Error("db unavailable");
    mockDb.puts.push(override);
    mockDb.row = override;
  },
  deleteProfileOverride: async (profileId: string) => {
    mockDb.deletes.push(profileId);
    mockDb.row = null;
  }
}));

const savedOverride: SavedProfileOverride = {
  profileId: "bellingham-procureware",
  revision: 1,
  baseVersion: 7,
  delta: { safeBackfillFields: ["ContactPhone", "ContactEmail", "BidType"] },
  reason: "Title backfill suspended pending re-review.",
  updatedAt: "2026-08-12T00:00:00.000Z"
};

beforeEach(() => {
  mockDb.row = null;
  mockDb.puts = [];
  mockDb.deletes = [];
  mockDb.failPut = false;
});

afterEach(cleanup);

describe("ProfileDetail", () => {
  it("shows the resolved policy of the repo profile", async () => {
    render(<ProfileDetail profileId="bellingham-procureware" />);
    await waitFor(() => expect((screen.getByTestId("profile-effective-version")).textContent).toContain("Repo v7"));
    expect((screen.getByTestId("profile-detail")).textContent).toContain("Bellingham ProcureWare");
    expect((screen.getByTestId("profile-detail")).textContent).toContain("ContactPhone, ContactEmail, BidType, Title");
    expect((screen.getByTestId("profile-detail")).textContent).toContain("AgentID + BidURL");
    // No override: no diff section, no export/reset controls.
    expect(screen.queryByTestId("override-diff")).toBeNull();
    expect(screen.queryByTestId("export-override")).toBeNull();
  });

  it("says so for an unknown profile id", () => {
    render(<ProfileDetail profileId="no-such-profile" />);
    expect(screen.getByText("Unknown profile.")).toBeTruthy();
  });

  it("refuses an incoherent override, naming the contradiction from the MERGED result", async () => {
    const user = userEvent.setup();
    render(<ProfileDetail profileId="bellingham-procureware" />);
    await user.click(await screen.findByTestId("edit-override"));
    // BidStatus is manual-review in the repo profile; approving it for
    // backfill is only contradictory once the delta is merged over the base.
    const field = screen.getByTestId("override-safeBackfillFields");
    await user.clear(field);
    await user.type(field, "Title, BidStatus");
    await user.type(screen.getByTestId("override-reason"), "testing");
    await user.click(screen.getByTestId("override-save"));
    expect((await screen.findByTestId("override-problems")).textContent).toContain("automatic and human-only");
    expect(mockDb.puts).toHaveLength(0);
  });

  it("requires a reason before saving", async () => {
    const user = userEvent.setup();
    render(<ProfileDetail profileId="bellingham-procureware" />);
    await user.click(await screen.findByTestId("edit-override"));
    const field = screen.getByTestId("override-safeBackfillFields");
    await user.clear(field);
    await user.type(field, "ContactPhone");
    await user.click(screen.getByTestId("override-save"));
    expect((await screen.findByTestId("override-problems")).textContent).toContain("reason is required");
    expect(mockDb.puts).toHaveLength(0);
  });

  it("refuses to save an override that changes nothing", async () => {
    const user = userEvent.setup();
    render(<ProfileDetail profileId="bellingham-procureware" />);
    await user.click(await screen.findByTestId("edit-override"));
    await user.type(screen.getByTestId("override-reason"), "no-op attempt");
    await user.click(screen.getByTestId("override-save"));
    expect((await screen.findByTestId("override-problems")).textContent).toContain("Nothing differs");
    expect(mockDb.puts).toHaveLength(0);
  });

  it("saves a minimal delta with revision 1 and the repo baseVersion", async () => {
    const user = userEvent.setup();
    render(<ProfileDetail profileId="bellingham-procureware" />);
    await user.click(await screen.findByTestId("edit-override"));
    const field = screen.getByTestId("override-safeBackfillFields");
    await user.clear(field);
    await user.type(field, "ContactPhone, ContactEmail, BidType");
    await user.type(screen.getByTestId("override-reason"), "Title backfill suspended pending re-review.");
    await user.click(screen.getByTestId("override-save"));

    await waitFor(() => expect(mockDb.puts).toHaveLength(1));
    const saved = mockDb.puts[0];
    expect(saved?.revision).toBe(1);
    expect(saved?.baseVersion).toBe(7);
    // Minimal: only the field that differs from the repo profile.
    expect(Object.keys(saved?.delta ?? {})).toEqual(["safeBackfillFields"]);
  });

  it("reports a failed save instead of pretending the override is in effect", async () => {
    mockDb.failPut = true;
    const user = userEvent.setup();
    render(<ProfileDetail profileId="bellingham-procureware" />);
    await user.click(await screen.findByTestId("edit-override"));
    const field = screen.getByTestId("override-safeBackfillFields");
    await user.clear(field);
    await user.type(field, "ContactPhone");
    await user.type(screen.getByTestId("override-reason"), "r");
    await user.click(screen.getByTestId("override-save"));
    expect((await screen.findByTestId("override-problems")).textContent).toContain("NOT in effect");
  });

  it("shows an active override: identity, diff, reason, and lifecycle controls", async () => {
    mockDb.row = savedOverride;
    render(<ProfileDetail profileId="bellingham-procureware" />);
    await waitFor(() =>
      expect(screen.getByTestId("profile-effective-version").textContent).toContain("local override rev 1")
    );
    expect((screen.getByTestId("override-diff")).textContent).toContain("safeBackfillFields");
    expect((screen.getByTestId("override-diff")).textContent).toContain("−Title");
    expect((screen.getByTestId("override-diff")).textContent).toContain(savedOverride.reason);
    expect(screen.getByTestId("export-override")).toBeTruthy();
  });

  it("flags a stale override and does not apply it", async () => {
    mockDb.row = { ...savedOverride, baseVersion: 5 };
    render(<ProfileDetail profileId="bellingham-procureware" />);
    await waitFor(() => expect(screen.getByTestId("override-stale-warning")).toBeTruthy());
    expect((screen.getByTestId("override-stale-warning")).textContent).toContain("not applied");
    expect((screen.getByTestId("profile-effective-version")).textContent).not.toContain("local override rev");
    // The effective policy is the repo policy: Title still approved.
    expect((screen.getByTestId("profile-detail")).textContent).toContain("ContactPhone, ContactEmail, BidType, Title");
  });

  it("removes an override only after the inline confirm", async () => {
    mockDb.row = savedOverride;
    const user = userEvent.setup();
    render(<ProfileDetail profileId="bellingham-procureware" />);
    await user.click(await screen.findByTestId("reset-override"));
    expect(mockDb.deletes).toHaveLength(0);
    await user.click(screen.getByTestId("confirm-reset-override"));
    await waitFor(() => expect(mockDb.deletes).toEqual(["bellingham-procureware"]));
    await waitFor(() =>
      expect(screen.getByTestId("profile-effective-version").textContent).not.toContain("local override rev")
    );
  });

  it("bumps the override-store revision on save so other pages re-resolve", async () => {
    const before = useProfileOverrideStore.getState().revision;
    const user = userEvent.setup();
    render(<ProfileDetail profileId="bellingham-procureware" />);
    await user.click(await screen.findByTestId("edit-override"));
    const field = screen.getByTestId("override-safeBackfillFields");
    await user.clear(field);
    await user.type(field, "ContactPhone");
    await user.type(screen.getByTestId("override-reason"), "r");
    await user.click(screen.getByTestId("override-save"));
    await waitFor(() => expect(useProfileOverrideStore.getState().revision).toBe(before + 1));
  });
});
