import { locateMessage } from "../src/thread-nav";

/**
 * Finding the message a quote points at.
 *
 * Pinned because the failure is silent and actively misleading: `scrollToLocation`
 * accepts any in-range pair of indices, so an off-by-one scrolls to a real
 * message that simply isn't the one being quoted — answering "what was this a
 * reply to?" with the wrong answer, confidently.
 *
 * The section index and the item index are counted separately, which is exactly
 * the shape that invites flattening one into the other by mistake.
 */
const day = (...ids: string[]) => ({ data: ids.map((id) => ({ id })) });

const thread = [
  day("m1", "m2"),          // section 0
  day("m3"),                // section 1
  day("m4", "m5", "m6"),    // section 2
];

describe("locateMessage", () => {
  it("finds the first message of the first day", () => {
    expect(locateMessage(thread, "m1")).toEqual({ sectionIndex: 0, itemIndex: 0 });
  });

  it("counts the item index within its own section, not across the thread", () => {
    // m4 is the fourth message overall but the *first* of its day. Returning 3
    // here is the mistake this test exists for.
    expect(locateMessage(thread, "m4")).toEqual({ sectionIndex: 2, itemIndex: 0 });
    expect(locateMessage(thread, "m6")).toEqual({ sectionIndex: 2, itemIndex: 2 });
  });

  it("handles a day holding a single message", () => {
    expect(locateMessage(thread, "m3")).toEqual({ sectionIndex: 1, itemIndex: 0 });
  });

  it("returns null for a message that isn't loaded yet", () => {
    // Not a failure: older messages page in on demand, so a reply to something
    // from weeks back genuinely isn't in the window. The caller says so instead
    // of scrolling somewhere arbitrary.
    expect(locateMessage(thread, "m99")).toBeNull();
  });

  it("returns null rather than throwing on a missing id", () => {
    expect(locateMessage(thread, null)).toBeNull();
    expect(locateMessage(thread, undefined)).toBeNull();
    expect(locateMessage(thread, "")).toBeNull();
  });

  it("copes with an empty thread and with empty days", () => {
    expect(locateMessage([], "m1")).toBeNull();
    expect(locateMessage([day(), day("m1")], "m1")).toEqual({ sectionIndex: 1, itemIndex: 0 });
  });
});
