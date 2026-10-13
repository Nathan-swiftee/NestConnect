# Conversation log

Everything that happens to a conversation besides its messages — where it was
routed and why, who it was assigned to, moved, closed, snoozed, labelled — as a
list of sentences, newest first, with who did it.

It's out of the way on purpose: it isn't needed at a glance, only when someone
asks "how did this end up with me?" or "who closed this?".

## Where to find it

- **Web:** the clock button in the thread header, next to Details. It opens a
  drawer on the right. On a phone-width browser it's under **More ›
  Conversation log** and opens full-screen.
- **App:** thread **Details › This conversation › Conversation log**. Details
  closes and the log opens as its own sheet.

Anyone who can see the conversation can see its log. It's read-only.

## What's logged

| Group | Entries |
|---|---|
| Arrival | Started (by the customer, on which channel) · Routed (team and/or person, and why: their pick in the live-chat menu, the customer's own routing, their organisation's routing, or the channel's) |
| Assignment | Assigned · Took it (assigned to yourself, or claimed by replying) · Unassigned · Moved to another team — each with who it was before |
| Status | Closed · Reopened (by a teammate, by replying, or because the customer wrote back) · Marked Pending · Snoozed (until when) · Back from snooze |
| Details | Priority · Labels added / removed · Subject (set automatically, or changed by someone) · Filed under / removed from an organisation · Custom fields (old → new) |
| Delivery | A message couldn't be sent (and why) · A failed message retried |
| Team Chat | Shared with a chat to discuss — which chat, and the line that went with it |

Each entry is a sentence and, where there is one, a second line ("Was James",
"Via their organisation, Acme Ltd", "Order ID: — → DG-1"). The time shows as
"5m ago"; hover on web for the exact time. A snooze's end time is shown in the
reader's own time zone.

Names are resolved when the log is read, so a renamed teammate or team reads
by their current name; someone who has left reads as "a former teammate".

Messages themselves aren't in the log — they're in the thread.

## How it's recorded

`ConversationEvent` (one row per entry: `type`, `actorKind` — `agent`,
`customer` or `system` — `actorUserId`, and a `data` JSON with what the
sentence needs). Tenant-scoped through its conversation; deleted with it.

`apps/api/src/conversations/conversation-log.ts` has two ways in:

- `record(id, type, actor, data)` — for something only the caller knows the
  meaning of: routed and why, labels, subject, organisation, fields, a failed
  send.
- `track(id, actor, change)` — wraps a change and logs what it did to status,
  assignment and priority by comparing before and after. That's how side
  effects get logged without every caller remembering to: a customer message
  reopening a closed chat, an agent's reply claiming an unassigned one or
  waking a snoozed one, the snooze sweep bringing one back.

Writing to the log never fails the change it describes — a failed write is
logged as a warning and dropped.

`GET /conversations/:id/events` returns the rendered entries (up to 500,
newest first). The apps refetch when the conversation changes over the socket.

## Existing conversations

The migration copies every recorded assignment (`AssignmentEvent`) into the
log, so conversations from before this shipped show their routing and
assignment history. Everything else starts from when this was deployed.

## Checks

- `pnpm check:conversation-log` — one chat end to end: arrival, routing reason,
  assignment, team move, priority, labels, organisation, fields, snooze, the
  customer reopening, a claiming reply, close, reopen, a wake, a failed send.
- `check:tenant-isolation` (Postgres) — one workspace can't read or write
  another's log.
