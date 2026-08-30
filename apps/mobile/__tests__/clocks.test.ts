/**
 * The two countdowns on a conversation, and the states that aren't countdowns.
 *
 * Worth pinning because every branch here is a thing the UI *silently* shows
 * wrong rather than crashing on. The shipped inbox row had two of them: it drew
 * the SLA only once breached, so a conversation still inside its target showed
 * nothing at all, and it wrote "· Snoozed" with no time — the one part of a
 * snooze you'd act on.
 *
 * `now` is a parameter, so none of this needs a fake clock or a tick.
 */
import { rowClocks, threadClocks } from "../src/clocks";

/** Midday, so "an hour ago" can't cross a day boundary and change a label. */
const NOW = Date.parse("2026-03-10T12:00:00.000Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

/** Only the three fields either clock reads. */
const conv = (over: Partial<Parameters<typeof rowClocks>[0]> = {}) =>
  ({ status: "open", slaDueAt: null, snoozedUntil: null, ...over }) as Parameters<
    typeof rowClocks
  >[0];

describe("the inbox row's clocks", () => {
  it("counts down to a first-response deadline that hasn't passed", () => {
    const { slaText, slaOver } = rowClocks(conv({ slaDueAt: at(45) }), NOW);
    expect(slaText).toBe("45m");
    expect(slaOver).toBe(false);
  });

  it("says Overdue once the deadline has passed", () => {
    const { slaText, slaOver } = rowClocks(conv({ slaDueAt: at(-5) }), NOW);
    expect(slaText).toBe("Overdue");
    expect(slaOver).toBe(true);
  });

  it("shows nothing when the team has no SLA", () => {
    expect(rowClocks(conv(), NOW).slaText).toBeUndefined();
  });

  /**
   * The one that would otherwise be permanent. `slaDueAt` stays on the record
   * after a conversation is resolved, so reading the field alone leaves every
   * closed thread in the Closed filter shouting "Overdue" for ever.
   */
  it("owes nothing on a closed conversation, deadline or not", () => {
    const { slaText, slaOver } = rowClocks(conv({ status: "closed", slaDueAt: at(-500) }), NOW);
    expect(slaText).toBeUndefined();
    expect(slaOver).toBe(false);
  });

  it("says when a snoozed conversation comes back", () => {
    expect(rowClocks(conv({ status: "snoozed", snoozedUntil: at(120) }), NOW).snoozeText).toBe("2h");
  });

  it("says Due now once its wake time has passed", () => {
    expect(rowClocks(conv({ status: "snoozed", snoozedUntil: at(-1) }), NOW).snoozeText).toBe(
      "Due now",
    );
  });

  /** Still snoozed — the state is on `status`, and a missing timestamp is no
   *  reason to stop reporting it. */
  it("still reports a snooze that has no wake time", () => {
    expect(rowClocks(conv({ status: "snoozed" }), NOW).snoozeText).toBe("Snoozed");
  });

  it("says nothing about snooze on a conversation that isn't snoozed", () => {
    expect(rowClocks(conv({ snoozedUntil: at(60) }), NOW).snoozeText).toBeUndefined();
  });

  it("survives a timestamp it can't parse rather than rendering NaN", () => {
    const { slaText, snoozeText } = rowClocks(
      conv({ status: "snoozed", slaDueAt: "not a date", snoozedUntil: "also not" }),
      NOW,
    );
    expect(slaText).toBeUndefined();
    expect(snoozeText).toBe("Snoozed");
  });
});

describe("the thread header's clocks", () => {
  it("spells the deadline out to the second, since there's only one on screen", () => {
    const { slaText, slaOver } = threadClocks(conv({ slaDueAt: at(12.5) }), NOW);
    expect(slaText).toBe("12m 30s left");
    expect(slaOver).toBe(false);
  });

  it("agrees with the row about what counts as overdue", () => {
    const late = conv({ slaDueAt: at(-1) });
    expect(threadClocks(late, NOW).slaOver).toBe(rowClocks(late, NOW).slaOver);
    expect(threadClocks(late, NOW).slaText).toBe("Overdue");
  });

  it("carries its own separator so the caller just concatenates", () => {
    expect(threadClocks(conv({ status: "snoozed", snoozedUntil: at(180) }), NOW).statusText).toBe(
      "Back in 3h · ",
    );
    expect(threadClocks(conv({ status: "closed" }), NOW).statusText).toBe("Resolved · ");
    expect(threadClocks(conv(), NOW).statusText).toBe("");
  });
});
