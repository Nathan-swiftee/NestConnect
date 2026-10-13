# Team Chat

The team talking to itself, inside NestConnect instead of in WhatsApp groups:
direct messages, groups, and a chat for every team. Deliberately shaped like
WhatsApp — a list of chats, bubbles, ticks, replies, reactions — because it's
the thing everyone already knows how to use.

## Switching it on

Settings › Organisation › **Modules** › **Team Chat** (web). Off until an admin
switches it on; the setting is per workspace (`module.team_chat` in
AppSetting). Off, it's hidden everywhere and the API answers 404 for everything
under `/chat` except `GET /chat/status` and `PUT /chat/module`. Nothing is
deleted: switching back on brings every chat back as it was.

## Where it is

- **Web:** the speech-bubbles icon in the rail, second from the top, with the
  number of unread messages (muted chats left out). At phone width it's in the
  menu drawer. The screen is two panes, like WhatsApp Web: chats on the left,
  the open chat on the right; at phone width, one at a time.
- **App:** coming in the next release (a Chat tab).

## Kinds of chat

| | Who's in it | Who can start it |
|---|---|---|
| **Direct** | Two people. One chat per pair, whoever starts it. | Anyone |
| **Group** | Whoever its admins add. The creator is its first admin. | Managers and admins |
| **Team** | Everyone on the team, today. Joining or leaving the team joins or leaves its chat. | Made automatically, one per team |

- A direct chat nobody has written in yet shows only in the list of whoever
  opened it.
- In a group you see what's said from when you joined. Team and direct chats
  show everything.
- A team chat can't be left, renamed or have people added — change the team
  instead (Settings › Teams).
- When the last group admin leaves a group, the longest-standing member becomes
  its admin.
- When a team is deleted its chat is kept, read-only, and drops out of everyone's
  list; admins can still read it under **All chats**.

## Who can do what

| | Agents | Managers | Admins |
|---|---|---|---|
| Message anyone directly | ✓ | ✓ | ✓ |
| Chat in groups they're in | ✓ | ✓ | ✓ |
| Create a group | — | ✓ | ✓ |
| Rename, change the icon, add/remove people, make admins | Groups where they're a group admin | Groups where they're a group admin | Any group |
| Delete someone else's message | Groups where they're a group admin | Groups where they're a group admin | Any chat they're in |
| Read every chat, read-only | — | — | ✓ |
| Switch the module on or off | — | — | ✓ |

### Admins reading along

Admins get **All chats** (the eye at the top of the list): every chat in the
workspace, including direct chats between other people. A chat they aren't in
opens read-only — no composer, no reactions — with a banner saying so, and each
visit is recorded (`ChatAudit`; a re-open within ten minutes counts once). The
record shows in the chat's info panel, to admins. Everyone is told: the foot of
the chat list and every info panel say "Admins in your workspace can read team
chats."

## Messages

- **Replies:** hover a message and press reply (or right-click / long-press);
  the reply quotes it, and tapping the quote scrolls to the original.
- **Reactions:** one per person per message; the same emoji again takes it off.
- **@mentions:** type `@` for the people in the chat. Stored as handles
  (`@nathan`), shown by name — the same as internal notes.
- **Edit:** your own, within 15 minutes; it shows "Edited".
- **Delete for everyone:** your own (and group admins / workspace admins for
  others'). The bubble stays as "This message was deleted"; a reply quoting it
  says so too.
- **Sending:** the bubble appears straight away with a clock; if it can't be
  sent it says "Not sent · Retry".
- Emoji-only messages of a few emoji show large, without a bubble.

### Ticks

Each person has a marker per chat: *read up to here* and *my app has up to
here*. A message's ticks come from everyone else's markers — cheap however big
the group:

- one grey tick: sent;
- two grey: everyone else's app has it (their chat list or badge has loaded
  since);
- two blue: everyone else has read it (had the chat open, in focus).

**Info** on your own message lists who has read it and when, who only has it,
and who hasn't got it yet.

### Typing and presence

"typing…" shows under the chat's name (and as dots at the bottom of the chat)
to whoever has it open; it's never stored. A green dot means someone has the
app open somewhere right now; otherwise "last seen today at 14:05" — kept
per person (`ChatPresence`) when their last tab or phone disconnects.

## Notifications

- A new message pushes everyone else in the chat who hasn't muted it, as
  "Ops team" / "Amara: …" (a direct chat: "Amara" / "…"). Collapsed per chat on
  the phone.
- An **@mention** always gets through, muted or not, and also lands in the bell
  (opening the chat). Quiet hours don't hold back a mention.
- No push for the chat you have open; desktop plays a sound unless you're
  looking at that chat.
- Personal settings › Notifications › **Team Chat messages** turns the
  everyday pushes off (mentions follow **Mentions**).
- **Mute** and **Pin** are per person, in the chat's info panel. A muted chat's
  unread count doesn't add to the rail badge.

## How it's built

- Tables: `ChatRoom` (kind, name, emoji, `teamId` for a team chat, `directKey`
  for a pair), `ChatMember` (role, joined, read and delivered markers, muted,
  pinned), `ChatMessage` (text or system, reply-to, reactions, mentions, edited,
  deleted), `ChatAudit`, `ChatPresence`; and `Notification.chatRoomId`.
  Tenant-scoped (`ChatRoom` directly, the rest through it).
- A team chat's members come from the team at the moment of asking; its
  `ChatMember` rows only hold each person's markers and settings. Team chats are
  created as they're first needed.
- `apps/api/src/chat/` — `ChatService` (rules), `ChatStore` (Postgres and in
  memory). The realtime gateway asks Team Chat who may open a chat through
  `registerChat` hooks, so it knows nothing about how chats are stored.
- Live events go to each member's `user:` room (so the list and badge update
  anywhere in the app) and to `chat:<id>` (whoever has it open, including an
  admin reading along). Typing and "has it open" use `chat:<id>` only.
- Client: `packages/client/src/chat.ts` (queries, optimistic sending, socket
  patches, typing) and `chat-format.ts` (day lines, list times, last seen,
  previews, runs) — shared with the app.

## Checks

- `pnpm check:team-chat` — the switch, team chats following teams, groups and
  their admins, direct chats, replies/edits/deletes/reactions, ticks and unread
  counts, who's told, admins reading along, pins, deleted teams.
- `pnpm check:team-chat-pg` — on Postgres: one workspace can't list, open, read,
  write, react to, quote or join another's chats, through the service or the
  store; paging back; mention flags; a deleted team's chat; cascades.
- `apps/web/src/lib/chat-format.test.ts` — dates, runs, the unread line, ticks,
  previews.
