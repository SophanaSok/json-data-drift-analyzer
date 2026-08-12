/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Toaster } from "./Toaster";
import { useToastStore } from "../../stores/toast-store";

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

afterEach(cleanup);

describe("Toaster live region", () => {
  it("mounts the live region before any toast exists, so the first message is announced", () => {
    const { container } = render(<Toaster />);
    // Rendered via portal into document.body, not the container.
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it("announces errors assertively and everything else politely", () => {
    render(<Toaster />);
    act(() => {
      useToastStore.getState().showToast("saved", "info");
      useToastStore.getState().showToast("boom", "error");
    });

    expect(screen.getByRole("status").textContent).toContain("saved");
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });
});
