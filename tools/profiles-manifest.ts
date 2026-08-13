/**
 * Regenerate src/profiles/policy-manifest.json — the policy-change gate.
 *
 * The manifest pins every profile's (version, policyHash). A test recomputes
 * it, so any profile edit fails CI until this tool is run deliberately — and
 * this tool REFUSES to absorb a policy change that was not accompanied by a
 * version bump, mechanically enforcing the discipline that provenance must
 * identify the governing policy (AGENTS.md rule 7).
 *
 * Usage: npm run profiles:manifest
 */

import { writeFileSync } from "node:fs";
import { MANIFEST_PATH, buildManifest, readManifest, resolveAll } from "./profile-files.ts";

const next = buildManifest(resolveAll());
const previous = readManifest();

const violations: string[] = [];
if (previous) {
  for (const [id, entry] of Object.entries(next)) {
    const before = previous[id];
    if (before && before.policyHash !== entry.policyHash && before.version === entry.version) {
      violations.push(
        `${id}: policy content changed (hash ${before.policyHash} -> ${entry.policyHash}) but version is still ${entry.version}. ` +
          `Bump the delta's "version" — decisions recorded under v${entry.version} must not silently mean something new.`
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Refusing to regenerate the policy manifest:\n");
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error("\nNo file was written.");
  process.exit(1);
}

writeFileSync(MANIFEST_PATH, `${JSON.stringify(next, null, 2)}\n`);
console.log(`Wrote ${MANIFEST_PATH} (${Object.keys(next).length} profile(s)).`);

if (previous) {
  const beforeIds = new Set(Object.keys(previous));
  const added = Object.keys(next).filter((id) => !beforeIds.has(id));
  const removed = [...beforeIds].filter((id) => !(id in next));
  const changed = Object.keys(next).filter(
    (id) => beforeIds.has(id) && previous[id]?.policyHash !== next[id]?.policyHash
  );
  for (const id of added) console.log(`  added:   ${id} v${next[id]?.version}`);
  for (const id of removed) console.log(`  removed: ${id}`);
  for (const id of changed) console.log(`  changed: ${id} v${previous[id]?.version} -> v${next[id]?.version}`);
  if (added.length + removed.length + changed.length === 0) console.log("  no changes.");
}
