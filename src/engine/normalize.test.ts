import { describe, expect, it } from "vitest";
import { getCollection } from "./normalize";

describe("getCollection", () => {
  it("selects a named collection or the root array via $", () => {
    const records = [{ Id: "1" }, { Id: "2" }];
    expect(getCollection({ Export: records }, "Export")).toEqual(records);
    expect(getCollection(records, "$")).toEqual(records);
  });

  it("returns empty for a missing path or non-array value", () => {
    expect(getCollection({ Export: "not an array" }, "Export")).toEqual([]);
    expect(getCollection({}, "Export")).toEqual([]);
    expect(getCollection(null, "Export")).toEqual([]);
  });

  it("drops entries that are not records — including arrays, which are objects too", () => {
    const collection = [{ Id: "1" }, null, 42, "text", ["not", "a", "record"], { Id: "2" }];
    expect(getCollection({ Export: collection }, "Export")).toEqual([{ Id: "1" }, { Id: "2" }]);
  });
});
