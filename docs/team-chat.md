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
  number of unread messages (muted chats left out). It **pops up** rather than
  being a page: a panel beside the rail, over the sidebar and the list of
  conversations, leaving the customer thread you're on in view — a quick word
  with the team is a click away from the conversation it's about. A click
  anywhere outside it puts it away (and does what it was for — nothing behind
  it is blocked), as do the rail icon, ✕ and Esc (outside a text box); it
  reopens where you left it,
  half-written reply included, and while it's away nothing in it counts as
  read. Two panes inside, like WhatsApp Web: chats, and the open chat (group
  info slides over the chat). A mention in the bell, "Open chat" on a
  discussion and the menu drawer's Chat all open it at the right chat; opening
  a customer card from it switches the thread behind it and leaves the chat
  open. At phone width it fills the screen, one pane at a time.
- **App:** a **Chat** tab, second along, with a green unread count (Insights
  stays for admins and managers, so the bar can carry six). The list reads
  like WhatsApp's; long-press a chat to pin, mute or mark it read. In a chat:
  swipe a message to reply, long-press it for reactions, edit, info and
  delete; tap the header for the group's info (members, mute, pin, rename,
  icon, add people, leave). A push opens the chat, and an @mention in the bell
  does too. Admins and managers get the same **All chats** eye.

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
| Read and write in every chat (the eye) | — | ✓ | ✓ |
| Switch the module on or off | — | — | ✓ |

### Admins and managers overseeing

Admins and managers get **All chats** (the eye at the top of the list): every
chat in the workspace, including direct chats between other people. They can
write and react in a chat they aren't in without joining it. Nothing is added
to the members list, and a direct chat stays between its two people. Its
members are notified as usual. In a direct chat, their messages carry their
name, so nobody mistakes them for the other person.

They can't Discuss a customer conversation into a chat they only oversee.
Discuss… is for the chats you're in.

A banner says they aren't in the chat, and each visit is recorded
(`ChatAudit`; a re-open within ten minutes counts once). The record shows in
the chat's info panel, to admins and managers. Everyone is told: the foot of
the chat list and every info panel say "Admins and managers in your workspace
can read and write in any team chat."

## Messages

- **Replies:** on the web, hover a message and open the chevron in its corner
  (or right-click / long-press) for Reply, Copy, Star, Edit, Info and Delete —
  the same pattern as WhatsApp messages in the inbox. In the app, swipe it. The
  reply quotes it, and tapping the quote scrolls to the original.
- **Reactions:** one per person per message; the same emoji again takes it off.
  On the web, the smiley beside a hovered message opens the quick reactions;
  they show as a small pill under the bubble.
- **@mentions:** type `@` for the people in the chat. Stored as handles
  (`@nathan`), shown by name — the same as internal notes.
- **Edit:** your own, within 15 minutes; it shows "Edited".
- **Delete for everyone:** your own (and group admins / workspace admins for
  others'). The bubble stays as "This message was deleted"; a reply quoting it
  says so too.
- **Sending:** the bubble appears straight away with a clock; if it can't be
  sent it says "Not sent · Retry".
- Emoji-only messages of a few emoji show large, without a bubble.

### Photos, files and voice notes

- **Web:** the paperclip, paste an image into the box, or drop files anywhere
  on the chat. They upload straight away and sit above the box until you send
  (up to 10 in one message, with or without words). With nothing typed, the
  green button is a microphone: click to record, then pause, delete or send.
- **App:** the paperclip opens camera, photo library or file; hold the
  microphone to record and let go to send — slide left to cancel, up to lock
  it hands-free. The same recorder and pickers as the inbox, so nothing new
  had to be installed (the app updates over the air).
- Photos open full screen; a photo on its own fills its bubble with the time
  over it. Voice notes play in the bubble with their waveform, with WhatsApp's
  speed pill and **Transcribe** (see [voice-notes.md](voice-notes.md)). The chat list
  and pushes say "📷 Photo", "🎤 Voice message (0:12)", "📄 rota.pdf".
- Files are the same uploads the inbox uses (`Attachment`, kept in the
  workspace's storage). The server takes what a file is — its type, name and
  address — from its own upload record, never from what the app sends, and
  refuses an upload from another workspace. Within a workspace a file is
  served to anyone signed in who has its (unguessable) address, as inbox
  files are. Deleting a message for everyone takes its files off it.

### Links

The first link in a message gets a card under it — the page's title,
description and site — fetched by the server just after the message is sent
(the message doesn't wait for it, and the card arrives live). Links in the
text are clickable. Because the server is the one fetching, it is careful
about where (`apps/api/src/chat/link-preview.ts`): http(s) on the standard
ports only, no passwords in the address, every address the name resolves to
must be on the public internet (no localhost, private ranges, link-local and
cloud-metadata, or their IPv6 forms) and the connection goes to that checked
address; redirects are followed by hand (3 at most) and checked again; HTML
only, 4 seconds and 256 KB at most. Anything else is just no card. Editing the
link out takes the card away.

### Search and stars

- The search box above the chats also finds messages, in every chat you're in
  (not ones you're only reading along in as an admin, and nothing from before
  you joined a group), newest first. Choosing one opens the chat at that
  message.
- **Star** a message from its menu (long-press in the app) to keep it. The
  star in the list's header shows yours, newest first; stars are private to
  you, and a starred message from a chat you've since left, or that has been
  deleted, drops out.

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

## Discussing a customer conversation

What WhatsApp groups can't do: take a customer conversation to the team and
keep the two tied together.

- **Discuss…** — web: the speech-bubbles button in a thread's header (or
  Discuss… in any message's menu); app: **Discuss with the team** in the
  thread's ⋯ menu, or Discuss… when you long-press a message. Pick a chat
  (a group, a team's, or one person), add a line if you like, send.
- **The card** it makes in the chat shows the customer, the channel and
  subject, the message it came from (if it did), and where the conversation
  stands — Open, Pending, Snoozed or ✓ Resolved, and who has it. That part is
  live: it follows the conversation as it changes, in every chat it's in.
  Tapping it opens the conversation. If the conversation is later deleted the
  card stays, saying so.
- **Notes sent on:** writing a note, pick **Also send to** and the note goes
  into the thread as usual and into that chat as a card quoting it.
- **The bar** under a thread's header says where it's being discussed —
  "Discussed in Ops team · 4 replies" and the latest reply. Clicking it opens
  the discussion beside the thread (the web) or in a sheet (the app), where
  you can read it and answer without leaving the customer. A discussion is
  the card and the replies to it; in the chat it reads as an ordinary
  conversation. More than one chat discussing it shows as extra chips.
- **The log:** sharing writes "Nathan A shared it with Ops team" (or "…with
  James") in the conversation's log, with the line that went with it.
- Anyone in the workspace can open any conversation, so a card shows its
  details to everyone in the chat. You can only share into a chat you can
  write in, and the bar only shows discussions in chats you're in (an admin
  reading along can still open any chat from All chats). Built on `ChatMessage.conversationId` and `shared` (the card as it was
  shared); the live part is read from the conversation, and on screen it's
  patched from the conversation events every client already receives.

## Notifications

- A new message pushes everyone else in the chat who hasn't muted it, as
  "Ops team" / "Amara: …" (a direct chat: "Amara" / "…"). Collapsed per chat on
  the phone.
- An **@mention** always gets through, muted or not, and also lands in the bell
  (opening the chat). Quiet hours don't hold back a mention.
- No push for the chat you have open. Sounds are the inbox's WhatsApp ones:
  the received sound for a new message (the open chat included), and the
  WhatsApp "sent" tick once the server has yours.
- Personal settings › Notifications › **Team Chat messages** turns the
  everyday pushes off (mentions follow **Mentions**).
- **Mute** and **Pin** are per person, in the chat's info panel. A muted chat's
  unread count doesn't add to the rail badge.

## How it's built

- Tables: `ChatRoom` (kind, name, emoji, `teamId` for a team chat, `directKey`
  for a pair), `ChatMember` (role, joined, read and delivered markers, muted,
  pinned), `ChatMessage` (text or system, reply-to, reactions, mentions, edited,
  deleted, attachments, link card, a shared conversation and its card),
  `ChatStar` (person × message),
  `ChatAudit`, `ChatPresence`; and `Notification.chatRoomId`.
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
- The app: `apps/mobile/app/(app)/(tabs)/chat.tsx` (the list),
  `app/(app)/chat/[id].tsx` (a chat), `chat/info.tsx`, and
  `src/components/chat/*`. Whether someone is "looking" (so a chat counts as
  read) comes from `ClientConfig.attention` — the browser's focus on the web,
  the app being in the foreground on a phone.
- Client: `packages/client/src/chat.ts` (queries, optimistic sending, socket
  patches, typing) and `chat-format.ts` (day lines, list times, last seen,
  previews, runs) — shared with the app.

## Checks

- `pnpm check:team-chat` — the switch, team chats following teams, groups and
  their admins, direct chats, replies/edits/deletes/reactions, ticks and unread
  counts, who's told, admins reading along, pins, deleted teams; files (only
  this workspace's uploads, described by the server's record), voice notes,
  link cards against a local page and the address checks that refuse
  localhost, private networks, metadata, odd ports and inward redirects;
  search; stars; sharing a conversation (with a message, into chats you can
  and can't write in), the log entry, discussions and their replies, a card
  following the conversation's status and owner, deleted cards.
- `pnpm check:team-chat-pg` — on Postgres: one workspace can't list, open, read,
  write, react to, quote or join another's chats, through the service or the
  store — nor star, search or send another's files; paging back; mention
  flags; files and link cards kept; search; stars; a shared conversation — B
  can't share, quote, link to or list A's — its replies, live status and log,
  and its card outliving a deleted conversation; a deleted team's chat;
  cascades (stars included).
- `apps/web/src/lib/chat-format.test.ts` — dates, runs, the unread line, ticks,
  previews (photos, voice notes).
- `apps/mobile/__tests__/team-chat.test.tsx` — the app's list (previews, counts,
  mention flag, filters, opening, photo and voice previews, message search)
  and bubbles (sender, quote, ticks, reactions, deleted, files, link card,
  star), conversation cards and the thread's discussion bar.
