import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
await page.goto("http://127.0.0.1:4176/json-data-drift-analyzer/", { waitUntil: "networkidle" });
await page.getByTestId("baseline-input").setInputFiles("src/test/fixtures/bellingham-reference.json");
await page.getByTestId("latest-input").setInputFiles("src/test/fixtures/bellingham-candidate.json");
await page.getByTestId("analyze-button").click();
await page.getByRole("link", { name: "Explore", exact: true }).click();
await page.goto("http://127.0.0.1:4176/json-data-drift-analyzer/results?tab=explore&mode=record&record=38B-2026&focus=1");
await page.getByTestId("record-mode-panel").waitFor();
await page.getByTestId("corroboration-DueDate").getByText(/different date/).click();
await page.screenshot({ path: "/tmp/claude-1000/-home-ssok-Projects-json-data-drift-analyzer/13adf464-1a02-478d-a2b3-d4dffacf2996/corroboration.png" });
await browser.close();
