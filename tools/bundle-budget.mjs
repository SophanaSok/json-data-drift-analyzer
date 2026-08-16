/**
 * Bundle-size budget: fail the build when the gzipped weight of dist/assets
 * exceeds the budget. Run after `npm run build` (CI does).
 *
 * Plain .mjs, unlike its .ts siblings: CI runs Node 20, which cannot strip
 * TypeScript types, and this is the one tool that runs in CI.
 *
 * The budget is a tripwire, not a target — it exists so a dependency or a
 * chunk-splitting regression fails loudly in CI instead of shipping silently.
 * Raise it deliberately, in a reviewed commit, when the app legitimately grows.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 300;

const assetsDir = new URL("../dist/assets", import.meta.url).pathname;

let files;
try {
  files = readdirSync(assetsDir).filter((name) => /\.(js|css)$/.test(name));
} catch {
  console.error(`Error: ${assetsDir} not found — run \`npm run build\` first.`);
  process.exit(2);
}

const sizes = files
  .map((name) => ({ name, gzip: gzipSync(readFileSync(join(assetsDir, name))).length }))
  .sort((left, right) => right.gzip - left.gzip);

const totalKb = sizes.reduce((total, file) => total + file.gzip, 0) / 1024;

for (const file of sizes) {
  console.log(`  ${(file.gzip / 1024).toFixed(1).padStart(7)} kB gzip  ${file.name}`);
}
console.log(`Total: ${totalKb.toFixed(1)} kB gzip (budget ${BUDGET_KB} kB).`);

if (totalKb > BUDGET_KB) {
  console.error(
    `Bundle budget exceeded by ${(totalKb - BUDGET_KB).toFixed(1)} kB gzip. ` +
      "Trim the regression, or raise BUDGET_KB in tools/bundle-budget.mjs deliberately."
  );
  process.exit(1);
}
console.log("Within budget.");
