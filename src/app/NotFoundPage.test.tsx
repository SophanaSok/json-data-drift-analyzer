/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { NotFoundPage } from "./NotFoundPage";

afterEach(cleanup);

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>upload page</p>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("NotFoundPage", () => {
  it("says the page does not exist instead of reading as a crash", () => {
    renderAt("/definitely-not-a-route");
    expect(screen.getByTestId("not-found").textContent).toContain("Page not found");
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it("links back to the upload page", () => {
    renderAt("/definitely-not-a-route");
    expect(screen.getByRole("link", { name: /upload page/i }).getAttribute("href")).toBe("/");
  });
});
