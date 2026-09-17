import { describe, expect, it } from "vitest";
import { filterChipFields } from "@ding/schemas";

/**
 * Which custom fields get a chip in the inbox's filter row.
 *
 * Tested here rather than in either list because both lists apply it — the rule
 * lives in the schemas package precisely so the web and the phone cannot drift,
 * and a test that renders one of them would only prove that one.
 */
interface Chip {
  key: string;
  filterable: boolean;
  archived: boolean;
  position: number;
}

const field = (over: Partial<Chip> = {}): Chip => ({
  key: "order_id",
  filterable: true,
  archived: false,
  position: 0,
  ...over,
});

describe("filter chip fields", () => {
  it("offers the ones somebody switched on", () => {
    expect(filterChipFields([field()]).map((f) => f.key)).toEqual(["order_id"]);
  });

  it("offers nothing by default", () => {
    // The earlier mistake: every field became a chip, so the row grew one each
    // time anybody defined a field and stopped being a row people read.
    expect(filterChipFields([field({ filterable: false })])).toEqual([]);
  });

  it("drops an archived field even with the switch left on", () => {
    // Archiving is the field becoming history. Its recorded values stay and
    // stay searchable; it just isn't a question the inbox asks any more.
    expect(filterChipFields([field({ filterable: true, archived: true })])).toEqual([]);
  });

  it("keeps the order the panel was arranged in", () => {
    const keys = filterChipFields([
      field({ key: "restaurant", position: 2 }),
      field({ key: "order_id", position: 0 }),
      field({ key: "driver", position: 1 }),
    ]).map((f) => f.key);
    expect(keys).toEqual(["order_id", "driver", "restaurant"]);
  });

  it("does not reorder the caller's array", () => {
    // It is handed straight out of a query cache in both apps; sorting in place
    // would reorder what every other reader of that cache sees.
    const input = [field({ key: "b", position: 1 }), field({ key: "a", position: 0 })];
    filterChipFields(input);
    expect(input.map((f) => f.key)).toEqual(["b", "a"]);
  });
});
