/**
 * Scaffold a new source profile delta.
 *
 * Usage: npm run new-profile -- --id <kebab-id> --source-url <url> [--name "Display Name"] [--agency "Agency"]
 *
 * Writes src/profiles/sources/<id>.json with version 1 and NO backfill
 * approvals — safeBackfillFields starts [] and every approval must be a
 * deliberate per-source edit with a version bump (AGENTS.md rules 4/6). The
 * identity keys are copied from the base so the scaffold states them visibly;
 * verify them against real exports before first use (rule 1).
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SOURCES_DIR, buildManifest, readBase, readDeltas, resolveAll } from "./profile-files.ts";
import { mergeProfile } from "../src/profiles/resolve.ts";
import { validateDelta } from "../src/profiles/validate.ts";
import type { SourceProfileDelta } from "../src/profiles/schema.ts";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value !== undefined && !value.startsWith("--") ? value : null;
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  console.error('Usage: npm run new-profile -- --id <kebab-id> --source-url <url> [--name "Display Name"] [--agency "Agency"]');
  process.exit(1);
}

const id = readArg("--id") ?? fail("--id is required.");
const sourceUrl = readArg("--source-url") ?? fail("--source-url is required.");
const displayName = readArg("--name");
const agency = readArg("--agency");

if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
  fail(`id "${id}" must be kebab-case (lowercase letters, digits, hyphens).`);
}
if (!URL.canParse(sourceUrl)) {
  fail(`--source-url "${sourceUrl}" does not parse as a URL.`);
}

const filePath = join(SOURCES_DIR, `${id}.json`);
if (existsSync(filePath)) {
  fail(`${filePath} already exists.`);
}
const base = readBase();
for (const { file, delta } of readDeltas()) {
  if (delta.id === id) fail(`id "${id}" is already used by sources/${file}.`);
  if (delta.sourceUrl === sourceUrl) fail(`sourceUrl "${sourceUrl}" is already claimed by "${delta.id}".`);
}

const scaffold: SourceProfileDelta = {
  id,
  sourceUrl,
  ...(displayName ? { displayName } : {}),
  ...(agency ? { agency } : {}),
  version: 1,
  primaryKey: base.primaryKey,
  fallbackKeys: base.fallbackKeys,
  dedupeKey: base.dedupeKey,
  safeBackfillFields: [],
  notes: [
    "STATUS: UNAPPROVED. No field is approved for automatic backfill; per AGENTS.md rule 4 a field becomes backfillable only when a per-source decision adds it to safeBackfillFields (rule 6 fields additionally need an explicit approval note), accompanied by a version bump.",
    "KEYS COPIED FROM BASE, NOT VERIFIED: primaryKey, fallbackKeys, and dedupeKey were copied from base.json by the scaffolder so this source's identity policy is visible in this file. Verify them against real exports from this source before relying on any analysis (AGENTS.md rule 1), and record the evidence here."
  ]
};

const validated = validateDelta(scaffold);
if (!validated.ok) {
  fail(`scaffold failed validation (tool bug):\n- ${validated.problems.join("\n- ")}`);
}
mergeProfile(base, validated.value);

writeFileSync(filePath, `${JSON.stringify(scaffold, null, 2)}\n`);
console.log(`Wrote ${filePath}`);

// Fold the new profile into the manifest so the gate test passes immediately.
const manifest = buildManifest(resolveAll());
writeFileSync(
  new URL("../src/profiles/policy-manifest.json", import.meta.url).pathname,
  `${JSON.stringify(manifest, null, 2)}\n`
);
console.log(`Updated policy-manifest.json (${Object.keys(manifest).length} profile(s)).`);
console.log("\nNext steps:");
console.log(`  1. Verify the keys and collectionPath against real exports from ${sourceUrl}.`);
console.log("  2. npm run typecheck && npm test");
console.log("  3. Commit the new delta together with the regenerated manifest.");
