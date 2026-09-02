import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Multi-profile detection states, exercised end to end.
 *
 * Only one real profile ships, so this spec writes a clearly-marked, gitignored
 * fixture profile into src/profiles/sources/ for its own lifetime and removes
 * it afterwards. Adding the file makes the dev server reload every connected
 * page, which is why this spec runs in its own Playwright project that starts
 * only after the dev project finishes (see playwright.config.ts).
 */

const TWIN_PATH = path.join(process.cwd(), "src/profiles/sources/zz-e2e-detection-twin.json");
const TWIN_URL = "https://twin.example.gov";
const COB_URL = "https://cob.procureware.com";

const twinProfile = {
  id: "zz-e2e-detection-twin",
  sourceUrl: TWIN_URL,
  displayName: "Detection Twin (e2e fixture)",
  version: 1,
  safeBackfillFields: [],
  notes: [
    "E2E FIXTURE, NOT A REAL SOURCE. Written by e2e/detection.spec.ts for the lifetime of the spec and removed afterwards; the filename pattern is gitignored. It exists only so the picker's ambiguous and cross-source detection paths can be exercised — it approves nothing and governs nothing."
  ]
};

function writeExport(name: string, urls: string[]): string {
  const records = urls.map((url, index) => ({
    AgentID: "1431",
    ProjectCode: `E2E-${index}`,
    BidURL: url,
    Title: `Record ${index}`
  }));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "detection-")), name);
  fs.writeFileSync(file, JSON.stringify({ Refreshed: "2026-08-01T00:00:00Z", Export: records }));
  return file;
}

test.beforeAll(() => {
  // Self-heal from a crashed earlier run, then install the twin.
  fs.rmSync(TWIN_PATH, { force: true });
  fs.writeFileSync(TWIN_PATH, JSON.stringify(twinProfile, null, 2));
});

test.afterAll(() => {
  fs.rmSync(TWIN_PATH, { force: true });
});

test("one file matching two profiles reports the ambiguity and asks for a manual pick", async ({ page }) => {
  const mixed = writeExport("mixed.json", [`${COB_URL}/Bids/1`, `${TWIN_URL}/Bids/2`]);
  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(mixed);
  await page.getByTestId("latest-input").setInputFiles(mixed);

  const notice = page.getByTestId("profile-detection-ambiguous");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("matches more than one profile");
  await expect(notice).toContainText("bellingham-procureware");
  await expect(notice).toContainText("zz-e2e-detection-twin");
});

test("files matching different profiles raise the cross-source warning", async ({ page }) => {
  const baseline = writeExport("baseline.json", [`${COB_URL}/Bids/1`]);
  const latest = writeExport("latest.json", [`${TWIN_URL}/Bids/1`]);
  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(baseline);
  await page.getByTestId("latest-input").setInputFiles(latest);

  const notice = page.getByTestId("profile-detection-cross-source");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("different sources");
  await expect(notice).toContainText("cross-source drift");
});

test("the fixture profile appears in the picker while installed", async ({ page }) => {
  await page.goto("");
  const picker = page.getByTestId("source-profile-select");
  await picker.click();
  await picker.fill("Detection Twin");
  await expect(page.getByRole("option", { name: /Detection Twin/ })).toBeVisible();
});

test("bot identity outranks a URL prefix, and a mismatched identity is not rescued by the URL", async ({ page }) => {
  // Twin URLs but Bellingham's bot identity: identity wins.
  const identified = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "detection-")), "identified.json");
  fs.writeFileSync(
    identified,
    JSON.stringify({
      Export: [
        { AgentID: "1431", AgentName: "Bellingham WA - PW-02", ProjectCode: "E2E-0", BidURL: `${TWIN_URL}/Bids/1`, Title: "R0" }
      ]
    })
  );
  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(identified);
  await page.getByTestId("latest-input").setInputFiles(identified);
  const notice = page.getByTestId("profile-detection-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('AgentID is "1431" and AgentName is "Bellingham WA - PW-02"');

  // Bellingham URLs but another bot's identity: not Bellingham, and the twin
  // (URL-only) does not match these URLs either, so nothing matches.
  const foreign = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "detection-")), "foreign.json");
  fs.writeFileSync(
    foreign,
    JSON.stringify({
      Export: [{ AgentID: "1431", AgentName: "Some Other Bot", ProjectCode: "E2E-0", BidURL: `${COB_URL}/Bids/1`, Title: "R0" }]
    })
  );
  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(foreign);
  await page.getByTestId("latest-input").setInputFiles(foreign);
  await expect(page.getByTestId("profile-detection-none")).toBeVisible();
});
