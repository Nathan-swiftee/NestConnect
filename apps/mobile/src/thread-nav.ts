/**
 * Finding a message inside the day-sectioned thread.
 *
 * Its own module because the arithmetic is the part that goes wrong and the
 * part a test can reach: `SectionList.scrollToLocation` takes a section index
 * and an item index *within that section*, and getting either off by one scrolls
 * to a plausible-looking wrong message rather than failing — which is worse than
 * not scrolling at all, because it silently answers "what was this a reply to?"
 * with the wrong answer.
 */

/** The shape the thread builds its sections in. */
export interface Sectioned<T> {
  data: T[];
}

/** Where a message sits, in the coordinates `scrollToLocation` wants. */
export interface MessageLocation {
  sectionIndex: number;
  itemIndex: number;
}

/**
 * Locate a message by id, or null when it isn't in the loaded window.
 *
 * Null is a real answer, not a failure: a thread loads the most recent messages
 * and pages older ones in on demand, so a reply to something from last month
 * quotes a message that genuinely isn't there yet. The caller says so rather
 * than scrolling somewhere arbitrary.
 */
export function locateMessage<T extends { id: string }>(
  sections: Sectioned<T>[],
  id: string | null | undefined,
): MessageLocation | null {
  if (!id) return null;
  for (let s = 0; s < sections.length; s++) {
    const i = sections[s].data.findIndex((m) => m.id === id);
    if (i >= 0) return { sectionIndex: s, itemIndex: i };
  }
  return null;
}
