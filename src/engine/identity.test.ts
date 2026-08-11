import { describe, expect, it } from "vitest";
import { buildRecordKey, collectDuplicateKeys } from "./identity";

describe("buildRecordKey", () => {
  it("cannot be forged with separator-bearing values", () => {
    // The regression: joining on "::" made ["a::b","c"] and ["a","b::c"] collide,
    // silently merging two distinct records (Map last-wins — one vanished).
    const a = buildRecordKey({ x: "a::b", y: "c" }, ["x", "y"]);
    const b = buildRecordKey({ x: "a", y: "b::c" }, ["x", "y"]);
    expect(a.key).not.toBeNull();
    expect(b.key).not.toBeNull();
    expect(a.key).not.toBe(b.key);
  });

  it("returns a null key instead of \"\" when an identity field is missing", () => {
    // The regression: a typo'd identity field yielded key "" for EVERY record,
    // collapsing the whole analysis into one record.
    const result = buildRecordKey({ ProjectCode: "34B-2026" }, ["ProjectCod"]);
    expect(result.key).toBeNull();
  });

  it("returns a null key when an identity value is blank or non-scalar", () => {
    expect(buildRecordKey({ id: "   " }, ["id"]).key).toBeNull();
    expect(buildRecordKey({ id: { nested: true } }, ["id"]).key).toBeNull();
  });

  it("keeps a human-readable label for display", () => {
    expect(buildRecordKey({ ProjectCode: "34B-2026" }, ["ProjectCode"]).label).toBe("34B-2026");
    expect(buildRecordKey({ a: "x", b: "y" }, ["a", "b"]).label).toBe("x::y");
  });
});

describe("collectDuplicateKeys", () => {
  it("flags genuine duplicates", () => {
    const { duplicates } = collectDuplicateKeys(
      [{ id: "one" }, { id: "one" }, { id: "two" }],
      ["id"]
    );
    expect(duplicates.size).toBe(1);
  });

  it("does not report unkeyable records as duplicates of each other", () => {
    // Two records with blank ids share no identity — they are unkeyed, not dupes.
    const { duplicates } = collectDuplicateKeys([{ id: "" }, { id: "" }], ["id"]);
    expect(duplicates.size).toBe(0);
  });

  it("does not conflate separator-forged keys as duplicates", () => {
    const { duplicates } = collectDuplicateKeys(
      [{ x: "a::b", y: "c" }, { x: "a", y: "b::c" }],
      ["x", "y"]
    );
    expect(duplicates.size).toBe(0);
  });
});
