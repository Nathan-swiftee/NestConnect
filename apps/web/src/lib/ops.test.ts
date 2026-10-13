import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeOpsChanges,
  nextReviewDue,
  opsCardMatches,
  opsProgress,
  opsSopInputSchema,
  sortOpsCards,
  splitIntoSteps,
  updateOpsSopInputSchema,
  type OpsSopCard,
} from "@ding/schemas";
import { pushRecentOps, readRecentOps, tint } from "./ops";

/**
 * Business Ops in the browser: the library's filters, pasting a list as steps,
 * what version history says changed, and the "recently viewed" row.
 */
const card = (over: Partial<OpsSopCard>): OpsSopCard => ({
  id: "s",
  title: "SOP",
  icon: "📘",
  color: "#0FA47A",
  summary: "",
  collectionId: null,
  teamIds: [],
  allTeams: true,
  status: "published",
  version: 1,
  stepCount: 1,
  mustRead: false,
  needsMyAck: false,
  reviewDueAt: null,
  reviewOverdue: false,
  owner: null,
  updatedAt: "2026-10-13T09:00:00.000Z",
  updatedBy: null,
  publishedAt: "2026-10-13T09:00:00.000Z",
  ...over,
});

describe("library filters", () => {
  const live = card({ id: "a", title: "Refunds" });
  const draft = card({ id: "b", title: "Draft one", status: "draft", version: 0 });
  const archived = card({ id: "c", title: "Old", status: "archived" });
  const must = card({ id: "d", title: "Alarm", mustRead: true, needsMyAck: true, collectionId: "col1" });
  const due = card({ id: "e", title: "Fire drill", reviewOverdue: true });
  const all = [live, draft, archived, must, due];
  const ids = (f: Parameters<typeof opsCardMatches>[1], col?: string) => all.filter((c) => opsCardMatches(c, f, col)).map((c) => c.id).join();

  it("All is what's live — never archived", () => expect(ids("all")).toBe("a,b,d,e"));
  it("each quick filter", () => {
    expect(ids("must_read")).toBe("d");
    expect(ids("drafts")).toBe("b");
    expect(ids("archived")).toBe("c");
    expect(ids("review")).toBe("e");
  });
  it("a collection narrows any filter", () => expect(ids("all", "col1")).toBe("d"));
  it("must-reads waiting for me come first, then A–Z", () =>
    expect(sortOpsCards([live, due, must]).map((c) => c.title)).toEqual(["Alarm", "Fire drill", "Refunds"]));
});

describe("paste a list as steps", () => {
  it("takes numbering and bullets off, drops blank lines", () =>
    expect(splitIntoSteps("1. One\n2) Two\n\n- Three\n• Four\n* Five\nStep 6: Six\n[ ] Seven\n[x] Eight")).toEqual([
      "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
    ]));
  it("leaves a number that's part of the step", () => expect(splitIntoSteps("Call 999 if anyone is hurt")).toEqual(["Call 999 if anyone is hurt"]));
  it("handles Windows line endings", () => expect(splitIntoSteps("a\r\nb\r\n")).toEqual(["a", "b"]));
});

describe("what changed between versions", () => {
  const v = (over: Partial<Parameters<typeof describeOpsChanges>[1]> = {}) => ({
    title: "Open up",
    summary: "",
    warnings: "",
    steps: [{ text: "Alarm" }, { text: "Lights" }],
    body: "",
    ...over,
  });
  it("first publish", () => expect(describeOpsChanges(null, v())).toEqual(["First published"]));
  it("nothing visible", () => expect(describeOpsChanges(v(), v())).toEqual([]));
  it("steps added, removed, reworded, reordered", () => {
    expect(describeOpsChanges(v(), v({ steps: [{ text: "Alarm" }, { text: "Lights" }, { text: "Log" }] }))).toEqual(["1 step added"]);
    expect(describeOpsChanges(v(), v({ steps: [{ text: "Alarm" }] }))).toEqual(["1 step removed"]);
    expect(describeOpsChanges(v(), v({ steps: [{ text: "Alarm" }, { text: "Lights on" }] }))).toEqual(["1 step reworded"]);
    expect(describeOpsChanges(v(), v({ steps: [{ text: "Lights" }, { text: "Alarm" }] }))).toEqual(["Steps reordered"]);
  });
  it("warnings and the rest", () =>
    expect(describeOpsChanges(v(), v({ title: "Opening up", warnings: "Gloves", body: "<p>x</p>" }))).toEqual([
      "Title changed",
      "Warnings added",
      "Details edited",
    ]));
  it("a picture added to a step", () =>
    expect(describeOpsChanges(v(), v({ steps: [{ text: "Alarm", imageUrl: "/api/media/abc" }, { text: "Lights" }] }))).toEqual([
      "Step pictures or links changed",
    ]));
});

describe("inputs", () => {
  it("a step picture must be an upload or https", () => {
    expect(opsSopInputSchema.safeParse({ title: "x", steps: [{ text: "a", imageUrl: "/api/media/abc-1" }] }).success).toBe(true);
    expect(opsSopInputSchema.safeParse({ title: "x", steps: [{ text: "a", imageUrl: "http://plain.example" }] }).success).toBe(false);
    expect(opsSopInputSchema.safeParse({ title: "x", steps: [{ text: "a", imageUrl: "javascript:alert(1)" }] }).success).toBe(false);
  });
  it("a partial update doesn't reset what it leaves out", () => {
    expect(updateOpsSopInputSchema.parse({ title: "New" })).toEqual({ title: "New" });
  });
  it("review period 1–36 months", () => {
    expect(opsSopInputSchema.safeParse({ title: "x", reviewEveryMonths: 0 }).success).toBe(false);
    expect(opsSopInputSchema.safeParse({ title: "x", reviewEveryMonths: 37 }).success).toBe(false);
    expect(nextReviewDue("2026-01-31T00:00:00.000Z", 6)).toBe("2026-07-31T00:00:00.000Z");
    expect(nextReviewDue("2026-01-31T00:00:00.000Z", null)).toBeNull();
  });
});

describe("checklist progress", () => {
  it("counts ticks on steps that still exist", () => expect(opsProgress(4, [0, 2, 2, 9])).toEqual({ done: 2, total: 4, pct: 50 }));
  it("no steps, no division by zero", () => expect(opsProgress(0, [])).toEqual({ done: 0, total: 0, pct: 0 }));
});

describe("recently viewed", () => {
  // The tests run outside a browser: a plain map stands in for its storage.
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) },
    });
  });
  it("newest first, no repeats, six at most, per person", () => {
    for (const id of ["a", "b", "c", "a", "d", "e", "f", "g"]) pushRecentOps("u1", id);
    expect(readRecentOps("u1")).toEqual(["g", "f", "e", "d", "a", "c"]);
    expect(readRecentOps("u2")).toEqual([]);
  });
  it("survives junk in storage", () => {
    window.localStorage.setItem("nest.ops.recent.u1", "{not json");
    expect(readRecentOps("u1")).toEqual([]);
  });
  it("tints a colour", () => {
    expect(tint("#0FA47A", 0.5)).toBe("rgba(15, 164, 122, 0.5)");
    expect(tint("nope")).toBe("var(--surface-2)");
  });
});
