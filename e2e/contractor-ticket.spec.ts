import { expect, test } from "@playwright/test";
import path from "node:path";

const root = process.cwd();

test.describe("contractor ticket draft", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("");
    await page
      .getByTestId("baseline-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
    await page
      .getByTestId("latest-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
    await page.getByTestId("analyze-button").click();
    await page.getByRole("link", { name: "Ticket", exact: true }).click();
    await expect(page.getByTestId("contractor-ticket")).toBeVisible({ timeout: 30000 });
  });

  test("renders a draft with title, severity, and labels", async ({ page }) => {
    await expect(page.getByTestId("draft-title")).toContainText("bellingham-procureware");
    await expect(page.getByTestId("draft-summary")).toContainText("high");
    await expect(page.getByTestId("draft-labels")).toContainText("source:bellingham-procureware");
  });

  test("states plainly that nothing is sent", async ({ page }) => {
    await expect(page.getByTestId("contractor-ticket")).toContainText("Nothing is sent from here");
    await expect(page.getByTestId("trello-handoff")).toContainText("does not create Trello cards");
    await expect(page.getByTestId("trello-handoff")).toContainText("entered by you");
  });

  test("hedges on root cause by default", async ({ page }) => {
    const markdown = page.getByTestId("draft-markdown");
    await expect(markdown).toContainText("Observed behaviour suggests");
    await expect(markdown).toContainText("The cause is not established from this data.");
  });

  test("adds typed identification rows to the draft", async ({ page }) => {
    await page.getByTestId("add-identification").click();
    await page.getByTestId("identification-label-0").fill("Agent");
    await page.getByTestId("identification-value-0").fill("Bellingham WA - PW-02");

    await expect(page.getByTestId("draft-markdown")).toContainText("| Agent | Bellingham WA - PW-02 |");
  });

  test("quotes supplied root-cause evidence", async ({ page }) => {
    await page.getByTestId("root-cause-evidence").fill("Scraper log: header parser returned 0 nodes");

    const markdown = page.getByTestId("draft-markdown");
    await expect(markdown).toContainText("quoted as received");
    await expect(markdown).toContainText("Scraper log: header parser returned 0 nodes");
  });

  test("refuses a credential typed into the form and explains why", async ({ page }) => {
    await page.getByTestId("add-identification").click();
    await page.getByTestId("identification-label-0").fill("Token");
    await page.getByTestId("identification-value-0").fill("Bearer sk-live-abcdef123456");

    await expect(page.getByTestId("draft-refused")).toBeVisible();
    await expect(page.getByTestId("draft-refused")).toContainText("bearer token");
    await expect(page.getByTestId("draft-markdown")).toHaveCount(0);
  });

  test("downloads the draft as Markdown", async ({ page }) => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-ticket").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^bellingham-procureware-contractor-ticket-.*\.md$/);
  });
});
