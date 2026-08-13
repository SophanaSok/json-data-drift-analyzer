import { describe, expect, it } from "vitest";
import { filterProfiles, type ProfilePickerRow } from "./profile-picker-filter";

const rows: ProfilePickerRow[] = [
  { id: "bellingham-procureware", displayName: "Bellingham ProcureWare", sourceUrl: "https://cob.procureware.com", agency: "City of Bellingham", version: 6 },
  { id: "everett-bids", displayName: "Everett Bids", sourceUrl: "https://bids.everettwa.gov", version: 1 },
  { id: "bell-gardens-portal", displayName: "Bell Gardens Portal", sourceUrl: "https://portal.bellgardens.org", version: 2 },
  { id: "spokane-procurement", displayName: "Spokane Procurement", sourceUrl: "https://procurement.spokane.gov", agency: "City of Spokane", version: 3 }
];

describe("filterProfiles", () => {
  it("returns everything in display-name order for an empty query", () => {
    expect(filterProfiles(rows, "").map((row) => row.id)).toEqual([
      "bell-gardens-portal",
      "bellingham-procureware",
      "everett-bids",
      "spokane-procurement"
    ]);
    expect(filterProfiles(rows, "   ").map((row) => row.id)).toHaveLength(4);
  });

  it("matches case-insensitively on id, name, url, and agency", () => {
    expect(filterProfiles(rows, "EVERETT").map((row) => row.id)).toEqual(["everett-bids"]);
    expect(filterProfiles(rows, "cob.procureware").map((row) => row.id)).toEqual(["bellingham-procureware"]);
    expect(filterProfiles(rows, "city of spokane").map((row) => row.id)).toEqual(["spokane-procurement"]);
  });

  it("ranks an exact id above a prefix above a substring", () => {
    const ids = filterProfiles(rows, "bell").map((row) => row.id);
    // Both bell* rows are prefix matches, name-ordered; no exact "bell" id exists.
    expect(ids).toEqual(["bell-gardens-portal", "bellingham-procureware"]);

    const exact = filterProfiles(rows, "everett-bids").map((row) => row.id);
    expect(exact[0]).toBe("everett-bids");
  });

  it("ranks id/name hits above url-only hits", () => {
    // "procure" is in bellingham's id/name AND spokane's url.
    const ids = filterProfiles(rows, "procure").map((row) => row.id);
    expect(ids[0]).toBe("bellingham-procureware");
    expect(ids).toContain("spokane-procurement");
  });

  it("returns nothing for a query nothing matches", () => {
    expect(filterProfiles(rows, "tacoma")).toEqual([]);
  });
});
