import { z } from "zod";

/*
 * A conversation's log: everything that happened to it besides the messages —
 * how it arrived and where it was routed, who had it, when it was closed,
 * snoozed or reopened, and what was changed on it. Read-only, newest first,
 * behind a button on the thread. See docs/conversation-log.md.
 */

export const CONVERSATION_EVENT_TYPES = [
  "created",
  "routed",
  "assigned",
  "unassigned",
  "team_changed",
  "closed",
  "reopened",
  "snoozed",
  "woke",
  "priority",
  "labels",
  "subject",
  "organisation",
  "fields",
  "message_failed",
  "message_retried",
] as const;
export const conversationEventTypeSchema = z.enum(CONVERSATION_EVENT_TYPES);
export type ConversationEventType = z.infer<typeof conversationEventTypeSchema>;

/** Who did it: a teammate, the customer, or NestConnect itself (routing, a snooze coming due). */
export const conversationEventActorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent"),
    id: z.string(),
    name: z.string(),
    avatarColor: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional(),
  }),
  z.object({ kind: z.literal("customer"), name: z.string() }),
  z.object({ kind: z.literal("system") }),
]);
export type ConversationEventActor = z.infer<typeof conversationEventActorSchema>;

export const conversationEventSchema = z.object({
  id: z.string(),
  type: conversationEventTypeSchema,
  at: z.string(),
  actor: conversationEventActorSchema,
  /** The whole entry as a sentence, names resolved: "Nathan A assigned it to James". */
  text: z.string(),
  /** A second line where there is one: the old and new values, a failure reason. */
  detail: z.string().nullable(),
  /** A snooze's wake time, for the reader to show in their own time zone. */
  until: z.string().nullable(),
});
export type ConversationEvent = z.infer<typeof conversationEventSchema>;
