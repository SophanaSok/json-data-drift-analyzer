/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateOrderingAlert } from "./DateOrderingAlert";
import type { DateOrderingIssue } from "../../engine/export-metadata";

const issues: DateOrderingIssue[] = [{ field: "Refreshed", baseline: "2026-07-15", latest: "2026-07-14" }];
const dates = {};

afterEach(cleanup);

function renderAlert() {
  const onContinue = vi.fn();
  const onCancel = vi.fn();
  render(
    <DateOrderingAlert
      issues={issues}
      baselineDates={dates}
      latestDates={dates}
      onContinue={onContinue}
      onCancel={onCancel}
    />
  );
  return { onContinue, onCancel };
}

describe("DateOrderingAlert keyboard access", () => {
  it("puts initial focus on Cancel, the non-destructive action", () => {
    renderAlert();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("dismisses on Escape", async () => {
    const user = userEvent.setup();
    const { onCancel, onContinue } = renderAlert();

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("keeps Tab cycling inside the dialog in both directions", async () => {
    const user = userEvent.setup();
    renderAlert();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const continueButton = screen.getByTestId("date-ordering-continue");

    // Forward from the last focusable wraps to the first.
    continueButton.focus();
    await user.tab();
    expect(document.activeElement).toBe(cancel);

    // Backward from the first wraps to the last.
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(continueButton);
  });

  it("returns focus to the element that had it before the dialog opened", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    const { unmount } = render(
      <DateOrderingAlert
        issues={issues}
        baselineDates={dates}
        latestDates={dates}
        onContinue={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(document.activeElement).not.toBe(outside);

    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
