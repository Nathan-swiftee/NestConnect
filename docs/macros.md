# Macros

Saved replies for the composer. An agent types `/` and a shortcut — or presses
**Macros** next to Templates — and the macro's text drops into the reply box,
its placeholders filled in for the conversation. It is a draft: the agent reads
it, changes what they like and presses Send as usual.

Text only. A macro writes; it doesn't assign, tag, close or send anything.

## Writing them

Settings › Messaging › **Macros** (web). Admins and managers create, edit,
duplicate and delete; everybody else sees the list read-only.

| Field | |
|---|---|
| Name | What the picker shows, e.g. "Delivery delayed". |
| Shortcut | Optional. Typed after `/`. Letters, numbers, `-` and `_`, up to 32; stored lower-case without the slash. Unique within a workspace. |
| Text | Up to 4,000 characters. May use the template placeholders: `{{contact.name}}`, `{{contact.first_name}}`, `{{contact.company}}`, `{{contact.phone}}`, `{{contact.email}}`, `{{agent.name}}`, `{{agent.first_name}}`, `{{channel.name}}`. A placeholder with nothing behind it fills as blank, never as the literal token. |
| Team inboxes | Which teams' conversations offer it. None ticked = every team. |

## Which macros a conversation offers

Decided by the server (`GET /macros/conversation/:id`), so the web and the app
can't disagree:

- **Assigned to a team** → that team's macros, plus every-team macros.
- **Not assigned yet** → the macros of the teams its channel is filed under
  (Settings › Channels), plus every-team macros.

Reassigning the conversation changes the list straight away. If a team is
deleted it is dropped from its macros; a macro whose only team was deleted
becomes an every-team macro.

## In the composer

- **Web**: type `/` at the start of the message or after a space; arrow keys
  and Enter/Tab pick, Esc closes. The Macros button opens a searchable list. On
  email the text goes into the rich editor at the caret. Not offered in internal
  notes.
- **App**: the same `/` suggestions above the reply box, and a Macros button
  that opens a sheet.
- **WhatsApp, closed 24-hour window**: nothing special — the edited text is sent
  the way any typed reply is, through the number's starred default template.

## API

| | |
|---|---|
| `GET /macros` | Every macro in the workspace. |
| `GET /macros/conversation/:id` | The ones this conversation offers. |
| `POST /macros` | Create (admin/manager). |
| `PATCH /macros/:id` | Update (admin/manager). `teamIds` replaces the list. |
| `DELETE /macros/:id` | Delete (admin/manager). |

Storage: `Macro` and `MacroTeam` (migration `20261012100000_macros`), both
tenant-scoped; a macro can't be linked to another workspace's team.

## Checks

- `pnpm check:macros` — permissions, shortcuts, team scoping (assigned and
  unassigned), reassignment, `/` lookup and placeholder fill.
- `pnpm check:macros-pg` — on Postgres: one workspace's macros stay its own;
  team links replaced on save and dropped with their team.
