import { describe, expect, it } from "vitest";
import {
  deleteProfileOverride,
  getProfileOverride,
  putProfileOverride,
  type ProfileOverridesTableLike,
  type SavedProfileOverride
} from "./index";

const override: SavedProfileOverride = {
  profileId: "bellingham-procureware",
  revision: 1,
  baseVersion: 6,
  delta: { minimumMatchRate: 0.9 },
  reason: "Source is mid-migration; match churn expected through 2026-09.",
  updatedAt: "2026-08-12T00:00:00.000Z"
};

function fakeTable(options: { failGet?: boolean; failPut?: boolean } = {}) {
  const rows = new Map<string, SavedProfileOverride>();
  const table: ProfileOverridesTableLike = {
    get: (key) =>
      options.failGet ? Promise.reject(new Error("db unavailable")) : Promise.resolve(rows.get(key)),
    put: (row) => {
      if (options.failPut) return Promise.reject(new Error("db unavailable"));
      rows.set(row.profileId, row);
      return Promise.resolve(row.profileId);
    },
    delete: (key) => {
      rows.delete(key);
      return Promise.resolve();
    }
  };
  return { table, rows };
}

describe("profile override helpers", () => {
  it("round-trips an override", async () => {
    const { table } = fakeTable();
    await putProfileOverride(override, table);
    expect(await getProfileOverride(override.profileId, table)).toEqual(override);
    await deleteProfileOverride(override.profileId, table);
    expect(await getProfileOverride(override.profileId, table)).toBeNull();
  });

  it("reads degrade to no-override when the database fails", async () => {
    // Private browsing / corrupted DB: analysis still runs, under the repo
    // policy, and the policy hash records that faithfully.
    const { table } = fakeTable({ failGet: true });
    expect(await getProfileOverride(override.profileId, table)).toBeNull();
  });

  it("write failures propagate — a policy edit must never silently not save", async () => {
    const { table } = fakeTable({ failPut: true });
    await expect(putProfileOverride(override, table)).rejects.toThrow("db unavailable");
  });
});
