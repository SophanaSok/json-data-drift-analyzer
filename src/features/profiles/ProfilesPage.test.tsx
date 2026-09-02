/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ProfilesPage } from "./ProfilesPage";
import { listProfiles } from "../../profiles";

vi.mock("../../db", () => ({
  getProfileOverride: async () => null,
  putProfileOverride: async () => undefined,
  deleteProfileOverride: async () => undefined
}));

function setup(initialEntry = "/profiles") {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ProfilesPage />
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe("ProfilesPage", () => {
  it("lists every registered profile and opens the first by default", async () => {
    setup();
    expect(screen.getByTestId("profiles-row-bellingham-procureware")).toBeTruthy();
    // The list is sorted by display name; whichever profile sorts first opens.
    const first = listProfiles()[0]!;
    expect((await screen.findByTestId("profile-detail")).textContent).toContain(first.displayName);
    // A healthy registry shows no diagnostics.
    expect(screen.queryByTestId("profile-diagnostics")).toBeNull();
  });

  it("honors a deep link to a profile id", async () => {
    setup("/profiles?id=bellingham-procureware");
    expect((await screen.findByTestId("profile-detail")).textContent).toContain("bellingham-procureware");
  });

  it("filters the list and says when nothing matches", async () => {
    const user = userEvent.setup();
    setup();
    const search = screen.getByTestId("profiles-search");
    await user.type(search, "procureware");
    expect(screen.getByTestId("profiles-row-bellingham-procureware")).toBeTruthy();
    await user.clear(search);
    await user.type(search, "tacoma");
    expect(screen.getByText("No profiles match.")).toBeTruthy();
  });

  it("selects a profile by clicking its row", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("profiles-row-bellingham-procureware"));
    expect((await screen.findByTestId("profile-detail")).textContent).toContain("Repo v9");
  });
});
