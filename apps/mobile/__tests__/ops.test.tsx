/**
 * Business Ops on the phone: what a library card says about an SOP (who it's
 * for, whether it needs confirming) and the small helpers the reader uses.
 */
import { render } from "@testing-library/react-native";
import type { OpsSopCard, Team } from "@ding/schemas";
import { opsCardMatches, opsProgress } from "@ding/schemas";
import { OpsTile, SopFlags, teamsLabel } from "../src/components/OpsParts";
import { hostOf, tint } from "../src/ops";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const card = (over: Partial<OpsSopCard> = {}): OpsSopCard => ({
  id: "s1",
  title: "Opening the warehouse",
  icon: "🏭",
  color: "#0FA47A",
  summary: "",
  collectionId: null,
  teamIds: [],
  allTeams: false,
  status: "published",
  version: 2,
  stepCount: 5,
  mustRead: true,
  needsMyAck: false,
  reviewDueAt: null,
  reviewOverdue: false,
  owner: null,
  updatedAt: "2026-10-13T09:00:00.000Z",
  updatedBy: null,
  publishedAt: "2026-10-13T09:00:00.000Z",
  ...over,
});
const teams = [
  { id: "t1", name: "Support team" },
  { id: "t2", name: "Sales team" },
  { id: "t3", name: "Warehouse" },
] as Team[];

describe("who an SOP is for", () => {
  it("names its teams, or says All teams", () => {
    expect(teamsLabel(card({ allTeams: true }), teams)).toBe("All teams");
    expect(teamsLabel(card({ teamIds: ["t1"] }), teams)).toBe("Support team");
    expect(teamsLabel(card({ teamIds: ["t1", "t2", "t3"] }), teams)).toBe("Support team, Sales team +1");
    expect(teamsLabel(card({ teamIds: [] }), teams)).toBe("No teams yet");
  });
});

describe("card flags", () => {
  it("a must-read waiting for me asks to be confirmed", () => {
    const { queryByText } = render(<SopFlags sop={card({ needsMyAck: true })} />);
    expect(queryByText("Please confirm")).toBeTruthy();
    expect(queryByText("Must read")).toBeNull();
  });
  it("once confirmed it's just a must-read", () => {
    const { queryByText } = render(<SopFlags sop={card()} />);
    expect(queryByText("Must read")).toBeTruthy();
  });
  it("drafts and overdue reviews say so", () => {
    const { queryByText } = render(<SopFlags sop={card({ status: "draft", mustRead: false, reviewOverdue: true })} />);
    expect(queryByText("Draft")).toBeTruthy();
    expect(queryByText("Due for review")).toBeTruthy();
  });
  it("the tile shows the emoji, hidden from screen readers (the title says it)", () => {
    const tile = render(<OpsTile icon="🚨" color="#DB2777" />);
    expect(tile.queryByText("🚨")).toBeNull();
    expect(tile.queryByText("🚨", { includeHiddenElements: true })).toBeTruthy();
  });
});

describe("helpers", () => {
  it("must-read filter and checklist progress", () => {
    expect(opsCardMatches(card(), "must_read")).toBe(true);
    expect(opsCardMatches(card({ mustRead: false }), "must_read")).toBe(false);
    expect(opsProgress(5, [0, 4])).toEqual({ done: 2, total: 5, pct: 40 });
  });
  it("a link's host, a colour's tint", () => {
    expect(hostOf("https://www.example.com/panel?x=1")).toBe("example.com");
    expect(hostOf("not a link")).toBe("Link");
    expect(tint("#0FA47A", 0.5)).toBe("rgba(15, 164, 122, 0.5)");
  });
});
