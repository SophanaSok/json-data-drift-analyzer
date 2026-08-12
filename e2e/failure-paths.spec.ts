import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/**
 * The journeys where something goes wrong: files that do not parse, exports the
 * gate withholds, and the Trello post exercised against a mocked API. The happy
 * paths elsewhere prove the tool works; these prove it fails loudly instead of
 * producing wrong or silent output.
 */

const reference = path.join(root, "src/test/fixtures/bellingham-reference.json");
const candidate = path.join(root, "src/test/fixtures/bellingham-candidate.json");

test("malformed JSON is refused with a visible error, not an empty analysis", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(reference);
  await page.getByTestId("latest-input").setInputFiles({
    name: "broken-export.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"Export": [ this is not json ]')
  });

  // The refusal happens at selection time: the export-date pre-read fails, the
  // error is shown, and Analyze never becomes clickable.
  await expect(page.getByText(/not valid JSON/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("analyze-button")).toBeDisabled();
  // The failure must be terminal: no navigation, no partial results.
  await expect(page.getByText("Deterministic incident narrative")).toHaveCount(0);
});

test("a candidate that misses the match-rate floor blocks the recovered export", async ({ page }) => {
  // Mangle both identity fields (primary BidURL pairing and fallback ProjectCode)
  // on a fifth of the records: the match rate lands near 0.80, far below the
  // profile's 0.95 minimum.
  // The fixture ships with a UTF-8 BOM, as the real scraper exports do.
  const mangled = JSON.parse(fs.readFileSync(candidate, "utf8").replace(/^\uFEFF/, "")) as {
    Export: Array<Record<string, unknown>>;
  };
  mangled.Export.forEach((record, index) => {
    if (index % 5 === 0) {
      record.BidURL = `https://cob.procureware.com/Bids/mangled-${index}`;
      record.ProjectCode = `ZZ-${index}`;
    }
  });

  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(reference);
  await page.getByTestId("latest-input").setInputFiles({
    name: "bellingham-candidate.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(mangled))
  });
  await page.getByTestId("analyze-button").click();
  await page.getByRole("link", { name: "Recovery", exact: true }).click();
  await expect(page.getByTestId("recovery-review")).toBeVisible({ timeout: 30000 });

  const state = page.getByTestId("export-state");
  await expect(state).toHaveAttribute("data-state", "blocked");
  await expect(state).toContainText("Export blocked");
  await expect(state).toContainText(/match rate/i);
  // Blocking the data artifact must not take the evidence down with it.
  await expect(state).toContainText("Reports and audits remain available");
});

test("a wrong collection path quarantines the run instead of passing over nothing", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(reference);
  await page.getByTestId("latest-input").setInputFiles(candidate);
  await page.getByPlaceholder("Export or $").fill("NotTheRealPath");
  await page.getByTestId("analyze-button").click();

  await expect(page.getByText("Quarantined")).toBeVisible({ timeout: 30000 });
  await page.getByRole("link", { name: "Data Health", exact: true }).click();
  await expect(page.getByText("No records found in either file")).toBeVisible();
  await expect(page.getByText(/Check the collection path/)).toBeVisible();
});

test("the Data Health tab lists the quality issues the engine found", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(reference);
  await page.getByTestId("latest-input").setInputFiles(candidate);
  await page.getByTestId("analyze-button").click();
  await expect(page.getByText("Deterministic incident narrative")).toBeVisible({ timeout: 30000 });

  await page.getByRole("link", { name: "Data Health", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Data Health" })).toBeVisible();
  await expect(page.getByText("Quality issues")).toBeVisible();
  // The Bellingham pair is a systemic-loss incident; an empty list here would
  // mean the page is not wired to the analysis at all.
  await expect(page.locator("li", { hasText: /\[(critical|high|warning|info)\]/ }).first()).toBeVisible();
});

test.describe("Trello posting against a mocked API", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("");
    await page.getByTestId("baseline-input").setInputFiles(reference);
    await page.getByTestId("latest-input").setInputFiles(candidate);
    await page.getByTestId("analyze-button").click();
    await page.getByRole("link", { name: "Ticket", exact: true }).click();
    await expect(page.getByTestId("contractor-ticket")).toBeVisible({ timeout: 30000 });
  });

  test("posts the confirmed card, sends only title and description, and then warns about duplicates", async ({
    page
  }) => {
    let requestBody: Record<string, unknown> | null = null;
    await page.route("https://api.trello.com/1/cards", async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "card-e2e-1", shortUrl: "https://trello.com/c/e2e1" })
      });
    });

    await page.getByTestId("trello-key").fill("test-key");
    await page.getByTestId("trello-token").fill("test-token");
    await page.getByTestId("trello-list").fill("list-123");
    await page.getByTestId("trello-arm").click();
    await page.getByTestId("trello-confirm-post").click();

    await expect(page.getByTestId("trello-result")).toContainText("Card created", { timeout: 15000 });
    await expect(page.getByTestId("card-link")).toHaveAttribute("href", "https://trello.com/c/e2e1");

    // What went over the wire is the whole privacy contract: the list, the title,
    // the description — and nothing else.
    expect(requestBody).not.toBeNull();
    const body = requestBody as unknown as Record<string, unknown>;
    expect(body.idList).toBe("list-123");
    expect(String(body.name)).toContain("bellingham-procureware");
    expect(String(body.desc)).toContain("Observed behaviour suggests");
    expect(Object.keys(body).sort()).toEqual(["desc", "idList", "name"]);

    // The run fingerprint now has a recorded post: the duplicate warning must
    // surface so the same files cannot be re-posted silently.
    await expect(page.getByTestId("duplicate-warning")).toBeVisible();
  });

  test("a Trello failure is reported as failed, with no card link", async ({ page }) => {
    await page.route("https://api.trello.com/1/cards", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"invalid token"}' })
    );

    await page.getByTestId("trello-key").fill("test-key");
    await page.getByTestId("trello-token").fill("bad-token");
    await page.getByTestId("trello-list").fill("list-123");
    await page.getByTestId("trello-arm").click();
    await page.getByTestId("trello-confirm-post").click();

    await expect(page.getByTestId("trello-result")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("trello-result")).not.toContainText("Card created");
    await expect(page.getByTestId("card-link")).toHaveCount(0);
  });
});
