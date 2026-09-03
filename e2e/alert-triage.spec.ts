import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();

/**
 * The duplicate-titles alert, end to end: from an export the pipeline would have
 * put on hold to the note the analyst pastes back when releasing it.
 *
 * The shipped Bellingham pair cannot exercise the interesting case — the candidate's
 * Titles are wiped, so no group trips the alert — so these specs write small exports
 * carrying the profile's bot identity, which is what detection now keys on.
 */

const IDENTITY = { AgentID: "1431", AgentName: "Bellingham WA - PW-02" };

function record(index: number, title: string) {
  return {
    ...IDENTITY,
    ProjectCode: `${index}B-2026`,
    BidURL: `https://cob.procureware.com/Bids/${index}`,
    Title: title,
    BidType: "RFP",
    Description: `Solicitation ${index}`
  };
}

/**
 * `refreshed` differs per side on purpose: identical export stamps trip the
 * file-order warning, which asks the user to confirm before analysing.
 */
function writeExport(name: string, titles: string[], refreshed: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "triage-")), name);
  fs.writeFileSync(
    file,
    JSON.stringify({ Refreshed: refreshed, Export: titles.map((title, index) => record(index, title)) })
  );
  return file;
}

const asReference = (name: string, titles: string[]) => writeExport(name, titles, "2026-09-01T00:00:00Z");
const asCandidate = (name: string, titles: string[]) => writeExport(name, titles, "2026-09-02T00:00:00Z");

/** Run the pair and land on Overview, where the alert verdict is. */
async function analyse(page: import("@playwright/test").Page, baseline: string, latest: string) {
  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(baseline);
  await page.getByTestId("latest-input").setInputFiles(latest);
  await page.getByTestId("analyze-button").click();
  // A finished analysis navigates itself into the results shell — to Overview or
  // to Records depending on what it found. Waiting for the shell first keeps a
  // tab click from being undone by that navigation, and the panel gets a budget
  // of its own because the review lands in the store just after the analysis.
  await expect(page.getByTestId("start-new-analysis-link")).toBeVisible({ timeout: 60000 });
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByTestId("alert-triage")).toBeVisible({ timeout: 15000 });
}

const RECURRING = ["Aluminum Sulfate (Liquid)", "Aluminum Sulfate (Liquid)", "Aluminum Sulfate (Liquid)", "Street Sweeping"];

test.describe("duplicate-title alert triage", () => {
  test("reads a group the reference run also had as recurring, and copies a note saying so", async ({ page, context }) => {
    const baseline = asReference("reference.json", RECURRING);
    const latest = asCandidate("candidate.json", RECURRING);
    await analyse(page, baseline, latest);

    const panel = page.getByTestId("alert-triage");
    await expect(panel).toHaveAttribute("data-outcome", "recurring");
    await expect(page.getByTestId("triage-headline")).toContainText("Nothing new in this run");

    // The note is what goes back to the pipeline, so it must name both runs.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByTestId("triage-copy").click();
    const note = await page.evaluate(() => navigator.clipboard.readText());
    expect(note).toContain("candidate.json");
    expect(note).toContain("reference.json");
    expect(note).toContain("no hold was released by this tool");
  });

  test("flags a group the candidate run introduced", async ({ page }) => {
    const baseline = asReference("reference.json", ["Distinct A", "Distinct B", "Distinct C", "Distinct D"]);
    const latest = asCandidate("candidate.json", ["Snow Removal", "Snow Removal", "Snow Removal", "Distinct D"]);
    await analyse(page, baseline, latest);

    await expect(page.getByTestId("alert-triage")).toHaveAttribute("data-outcome", "new");
    await expect(page.getByTestId("triage-headline")).toContainText("1 new in this run");
  });

  test("says a clean run was checked rather than staying silent", async ({ page }) => {
    const titles = ["Distinct A", "Distinct B", "Distinct C", "Distinct D"];
    const baseline = asReference("reference.json", titles);
    const latest = asCandidate("candidate.json", titles);
    await analyse(page, baseline, latest);

    await expect(page.getByTestId("alert-triage")).toHaveAttribute("data-outcome", "clear");
    await expect(page.getByTestId("triage-headline")).toContainText("3 or more records");
  });

  test("Data Health lists the groups and links a title to its records", async ({ page }) => {
    const baseline = asReference("reference.json", RECURRING);
    const latest = asCandidate("candidate.json", RECURRING);
    await analyse(page, baseline, latest);

    await page.getByRole("link", { name: "Data Health", exact: true }).click();
    await expect(page.getByTestId("alert-triage")).toBeVisible();
    const group = page.getByTestId("triage-group-0");
    await expect(group).toContainText("Aluminum Sulfate (Liquid)");
    await expect(group).toContainText("also in reference");

    await group.getByRole("link").click();
    await expect(page).toHaveURL(/tab=records&q=Aluminum/);
  });
});

test.describe("data health sections", () => {
  // The real pair is 2.8 MB across both files; parsing plus analysis can outrun
  // the default per-test budget when the suite runs its specs in parallel.
  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    await page.goto("");
    await page.getByTestId("baseline-input").setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
    await page.getByTestId("latest-input").setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("start-new-analysis-link")).toBeVisible({ timeout: 60000 });
    await page.getByRole("link", { name: "Data Health", exact: true }).click();
    await expect(page.getByTestId("health-sections")).toBeVisible();
  });

  test("groups both engines' signals by severity and filters them", async ({ page }) => {
    await expect(page.getByTestId("health-section-critical")).toBeVisible();
    // The QA engine's systemic loss lands here alongside the drift issues.
    await expect(page.getByTestId("health-item-finding:systemic_field_regression")).toBeVisible();

    const before = await page.getByTestId("health-count").textContent();
    await page.getByTestId("health-filter-search").fill("systemic");
    await expect(page.getByTestId("health-count")).not.toHaveText(before ?? "");
    await expect(page.getByTestId("health-item-finding:systemic_field_regression")).toBeVisible();

    await page.getByTestId("health-filter-clear").click();
    await expect(page.getByTestId("health-count")).toHaveText(before ?? "");
  });

  test("shows ingestion-share proxies against the reference run, labelled as proxies", async ({ page }) => {
    const panel = page.getByTestId("ingestion-proxies");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("none of these numbers measures that alert");
    await expect(panel).toContainText("no threshold is applied");

    // BidStatus is wiped in the candidate, so its "(no value)" share goes to 100%.
    const status = page.getByTestId("proxy-proxy:BidStatus:distribution");
    await expect(status).toContainText("(no value)");
    await expect(status).toContainText("100.0%");

    // Documents survived the regression, so their JSON validity has not moved.
    await expect(page.getByTestId("proxy-delta-proxy:BidDocuments:json")).toContainText("no change");
  });

  test("says when a filter matches nothing instead of showing an empty page", async ({ page }) => {
    await page.getByTestId("health-filter-search").fill("zzzz-no-such-thing");
    await expect(page.getByTestId("health-no-matches")).toBeVisible();
  });
});
