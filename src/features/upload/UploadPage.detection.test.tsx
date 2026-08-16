/**
 * @vitest-environment jsdom
 *
 * The four detection notices live in UploadPage's conditional rendering, and
 * only one real profile ships — so the multi-profile states (ambiguous,
 * cross-source, mismatch) are exercised here against a synthetic two-profile
 * registry, and the single-profile states (match, none) ride along.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// jsdom lacks Worker (UploadPage builds one at module scope) and Blob.text().
// vi.hoisted runs before the hoisted static imports, so the globals exist when
// UploadPage's module body executes.
vi.hoisted(() => {
  class FakeWorker {
    onmessage: unknown = null;
    addEventListener() {}
    removeEventListener() {}
    postMessage() {}
    terminate() {}
  }
  (globalThis as Record<string, unknown>).Worker = FakeWorker;
  if (typeof File !== "undefined" && typeof File.prototype.text !== "function") {
    File.prototype.text = function text(this: File) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    };
  }
});

vi.mock("../../db", () => ({
  ANALYSIS_CACHE_SCHEMA_VERSION: 3,
  getProfileOverride: async () => null,
  putAnalysisBounded: async () => undefined,
  db: { analyses: { get: async () => undefined } }
}));

// A second profile with a distinct detection prefix, derived from the real one
// so the registry shape stays honest.
vi.mock("../../profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../profiles")>();
  const twin = {
    ...actual.BELLINGHAM_PROCUREWARE,
    id: "twin-portal",
    displayName: "Twin Portal",
    sourceUrl: "https://twin.example.gov"
  };
  const PROFILES = {
    [actual.BELLINGHAM_PROCUREWARE.id]: actual.BELLINGHAM_PROCUREWARE,
    "twin-portal": twin
  };
  return {
    ...actual,
    PROFILES,
    getProfile: (id: string) => PROFILES[id as keyof typeof PROFILES],
    listProfiles: () => Object.values(PROFILES),
    PROFILE_DIAGNOSTICS: []
  };
});

import { UploadPage } from "./UploadPage";

function exportFile(name: string, urls: string[]): File {
  const records = urls.map((url, index) => ({
    AgentID: "1431",
    ProjectCode: `P-${index}`,
    BidURL: url,
    Title: `Record ${index}`
  }));
  return new File([JSON.stringify({ Refreshed: "2026-08-01T00:00:00Z", Export: records })], name, {
    type: "application/json"
  });
}

const COB = "https://cob.procureware.com/Bids/";
const TWIN = "https://twin.example.gov/Bids/";

async function uploadPair(baseline: File, latest: File) {
  const user = userEvent.setup();
  await user.upload(screen.getByTestId("baseline-input"), baseline);
  await user.upload(screen.getByTestId("latest-input"), latest);
  return user;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function renderPage() {
  return render(
    <MemoryRouter>
      <UploadPage />
    </MemoryRouter>
  );
}

describe("UploadPage detection notices", () => {
  it("says so when no known source matches, naming the policy that will apply", async () => {
    renderPage();
    await uploadPair(exportFile("b.json", ["https://example.gov/1"]), exportFile("l.json", ["https://example.gov/1"]));

    const notice = await screen.findByTestId("profile-detection-none");
    expect(notice.textContent).toContain("No known source matched these files");
    expect(notice.textContent).toContain("Bellingham ProcureWare");
    expect(screen.queryByTestId("profile-detection-mismatch")).toBeNull();
  });

  it("auto-selects a detected source over the default and says why", async () => {
    renderPage();
    await uploadPair(exportFile("b.json", [`${TWIN}1`]), exportFile("l.json", [`${TWIN}1`]));

    const notice = await screen.findByTestId("profile-detection-notice");
    expect(notice.textContent).toContain("Detected from the uploaded file");
    await waitFor(() =>
      expect((screen.getByTestId("source-profile-select") as HTMLInputElement).value).toContain("Twin Portal")
    );
  });

  it("warns on a mismatch with a manually chosen profile and offers both ways out", async () => {
    renderPage();
    const user = userEvent.setup();
    // Choose Twin Portal by hand (keyboard path — the listbox is virtualized
    // and renders no rows under jsdom) so detection may not silently override it.
    await user.click(screen.getByTestId("source-profile-select"));
    await user.keyboard("twin{Enter}");

    await uploadPair(exportFile("b.json", [`${COB}1`]), exportFile("l.json", [`${COB}1`]));

    const mismatch = await screen.findByTestId("profile-detection-mismatch");
    expect(mismatch.textContent).toContain("looks like");
    await user.click(screen.getByTestId("use-detected-profile"));
    await waitFor(() =>
      expect((screen.getByTestId("source-profile-select") as HTMLInputElement).value).toContain("Bellingham")
    );
  });

  it("keeps the manual selection when the mismatch is dismissed", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("source-profile-select"));
    await user.keyboard("twin{Enter}");
    await uploadPair(exportFile("b.json", [`${COB}1`]), exportFile("l.json", [`${COB}1`]));

    await screen.findByTestId("profile-detection-mismatch");
    await user.click(screen.getByRole("button", { name: /keep twin portal/i }));
    expect(screen.queryByTestId("profile-detection-mismatch")).toBeNull();
    expect((screen.getByTestId("source-profile-select") as HTMLInputElement).value).toContain("Twin Portal");
  });

  it("reports an ambiguous match when one file fits two profiles", async () => {
    renderPage();
    await uploadPair(
      exportFile("b.json", [`${COB}1`, `${TWIN}2`]),
      exportFile("l.json", [`${COB}1`, `${TWIN}2`])
    );

    const notice = await screen.findByTestId("profile-detection-ambiguous");
    expect(notice.textContent).toContain("matches more than one profile");
    expect(notice.textContent).toContain("bellingham-procureware");
    expect(notice.textContent).toContain("twin-portal");
  });

  it("flags cross-source uploads when the two files match different profiles", async () => {
    renderPage();
    await uploadPair(exportFile("b.json", [`${COB}1`]), exportFile("l.json", [`${TWIN}1`]));

    const notice = await screen.findByTestId("profile-detection-cross-source");
    expect(notice.textContent).toContain("different sources");
    expect(notice.textContent).toContain("bellingham-procureware");
    expect(notice.textContent).toContain("twin-portal");
  });
});
