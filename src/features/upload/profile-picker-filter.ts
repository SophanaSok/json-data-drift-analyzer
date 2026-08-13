/**
 * Pure filtering and ranking for the profile picker.
 *
 * Plain case-insensitive substring matching, deliberately not a search index:
 * a few hundred profiles × three short strings is microseconds per keystroke,
 * and an index would add rebuild-on-override-change bookkeeping for no
 * perceptible gain at this size.
 */

export type ProfilePickerRow = {
  id: string;
  displayName: string;
  sourceUrl: string;
  agency?: string;
  version: number;
};

/**
 * Rows whose id, display name, source URL, or agency contains the query,
 * ranked exact-id > id/name prefix > substring, stable by display name within
 * a rank. An empty query returns every row in display-name order.
 */
export function filterProfiles<T extends ProfilePickerRow>(rows: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  const byName = [...rows].sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (needle.length === 0) {
    return byName;
  }

  const ranked = byName
    .map((row) => ({ row, rank: rankMatch(row, needle) }))
    .filter((entry) => entry.rank > 0);
  // Stable sort: equal ranks keep the display-name order from byName.
  ranked.sort((a, b) => b.rank - a.rank);
  return ranked.map((entry) => entry.row);
}

function rankMatch(row: ProfilePickerRow, needle: string): number {
  const id = row.id.toLowerCase();
  const name = row.displayName.toLowerCase();
  const url = row.sourceUrl.toLowerCase();
  const agency = row.agency?.toLowerCase() ?? "";

  if (id === needle) return 4;
  if (id.startsWith(needle) || name.startsWith(needle)) return 3;
  if (id.includes(needle) || name.includes(needle)) return 2;
  if (url.includes(needle) || agency.includes(needle)) return 1;
  return 0;
}
