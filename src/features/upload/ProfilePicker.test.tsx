/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfilePicker } from "./ProfilePicker";
import type { ProfilePickerRow } from "./profile-picker-filter";

// jsdom gives every element zero size, so the real virtualizer renders no
// rows; this stand-in renders them all. The picker's behavior is under test,
// not virtualization.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({
    getTotalSize: () => options.count * 52,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({ index, start: index * 52, size: 52 })),
    scrollToIndex: () => undefined
  })
}));

const rows: ProfilePickerRow[] = [
  { id: "bellingham-procureware", displayName: "Bellingham ProcureWare", sourceUrl: "https://cob.procureware.com", version: 6 },
  { id: "everett-bids", displayName: "Everett Bids", sourceUrl: "https://bids.everettwa.gov", version: 1 },
  { id: "spokane-procurement", displayName: "Spokane Procurement", sourceUrl: "https://procurement.spokane.gov", version: 3 }
];

function setup(overrides: Partial<Parameters<typeof ProfilePicker>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <ProfilePicker
      profiles={rows}
      value="bellingham-procureware"
      onChange={onChange}
      {...overrides}
    />
  );
  return { onChange, input: screen.getByTestId("source-profile-select") };
}

afterEach(cleanup);

describe("ProfilePicker", () => {
  it("shows the selected profile's display name and version when closed", () => {
    const { input } = setup();
    expect((input as HTMLInputElement).value).toBe("Bellingham ProcureWare · v6");
  });

  it("opens on focus, filters as the user types, and selects by click", async () => {
    const user = userEvent.setup();
    const { onChange, input } = setup();

    await user.click(input);
    expect(screen.getByTestId("profile-picker-listbox")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);

    await user.keyboard("everett");
    expect(screen.getAllByRole("option")).toHaveLength(1);

    await user.pointer({ keys: "[MouseLeft]", target: screen.getByTestId("profile-option-everett-bids") });
    expect(onChange).toHaveBeenCalledWith("everett-bids");
    expect(screen.queryByTestId("profile-picker-listbox")).toBeNull();
  });

  it("says when nothing matches instead of showing an empty box", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.click(input);
    await user.keyboard("tacoma");
    expect((screen.getByTestId("profile-picker-empty")).textContent).toContain("No profiles match");
  });

  it("navigates with arrows and commits with Enter", async () => {
    const user = userEvent.setup();
    const { onChange, input } = setup();
    await user.click(input);
    // Options are name-ordered: Bellingham, Everett, Spokane; focus starts on
    // the current selection (Bellingham, index 0).
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("spokane-procurement");
  });

  it("commits the active option on Tab", async () => {
    const user = userEvent.setup();
    const { onChange, input } = setup();
    await user.click(input);
    await user.keyboard("{ArrowDown}{Tab}");
    expect(onChange).toHaveBeenCalledWith("everett-bids");
  });

  it("escape closes without committing the filter", async () => {
    const user = userEvent.setup();
    const { onChange, input } = setup();
    await user.click(input);
    await user.keyboard("spokane{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("profile-picker-listbox")).toBeNull();
    expect((input as HTMLInputElement).value).toBe("Bellingham ProcureWare · v6");
  });

  it("clamps the active option when the filter shrinks the list", async () => {
    const user = userEvent.setup();
    const { onChange, input } = setup();
    await user.click(input);
    await user.keyboard("{ArrowDown}{ArrowDown}"); // active = Spokane (index 2)
    await user.keyboard("everett"); // list shrinks to 1
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("everett-bids");
  });

  it("marks overridden profiles with a chip, closed and in the list", async () => {
    const user = userEvent.setup();
    const { input } = setup({ overriddenIds: new Set(["bellingham-procureware"]) });
    expect(screen.getByText("local override")).toBeTruthy();
    await user.click(input);
    // One chip inside the option row (the closed-state chip hides while open).
    expect(screen.getAllByText("local override").length).toBeGreaterThan(0);
  });
});
