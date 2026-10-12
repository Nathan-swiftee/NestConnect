# Email signatures

Each email channel has one signature design. Every email sent from that mailbox
ends with it, filled in with the details of whoever sends.

This replaces the old personal signature (Personal settings › Signature). The
personal ones are kept in the database (`User.emailSignature`) but are no longer
sent or shown.

## People: position

Each person has a **Position** (job title, up to 80 characters):

- Admins and managers set it when inviting someone, or later in Settings › People.
- Anyone can change their own in Personal settings (web), or by tapping it on the
  Settings tab in the app.

## A channel's signature

Settings › Channels › (an email channel) › **Signature**. It's saved by the same
**Save changes** button as the channel's other settings (admins and managers).

- **Signature**: the layout, in the same rich editor the personal signature used
  (text, formatting, links, pictures). The chips insert tags:

  | Tag | Fills with |
  |---|---|
  | `{{agent.name}}` / `{{agent.first_name}}` | The sender's name |
  | `{{agent.position}}` | Their position |
  | `{{agent.email}}` | Their own email |
  | `{{team.name}}` | The conversation's team (or the channel's first team) |
  | `{{channel.name}}` / `{{channel.email}}` | This mailbox |

- **Marketing section**: optional, under the signature: a banner, an offer,
  socials, a legal line. Tags work here too.
- **Preview**: shows it exactly as it will be sent, for you or any teammate.

**Until a mailbox is designed** it signs with the default: name, position and the
channel's email. **Reset to default** returns to that. An emptied layout means no
name block at all (only the marketing section, if any).

### Empty details

If a line contains a tag with nothing behind it, the tag goes, and so does a
separator next to it (`·`, `|`, `-`, `,`, `–`, `—`). If nothing but punctuation
is left on that line, the whole line is dropped. So someone with no position
gets no blank line and no stray "·". Pictures are never dropped. A tag that
isn't on the list is left as written. Values are escaped, so a name can't
inject markup.

## Sending

- The server renders the signature when the message is sent. It uses the
  mailbox the email actually leaves from (the same choice the dispatcher makes),
  so a WhatsApp or live chat thread answered by email signs as the email default.
  The rendered HTML is stored with the outbound delivery, so a retry sends the
  same signature.
- It is added to the email only (HTML and text), never to the message shown in
  the app.
- Internal notes and non-email replies get no signature.
- The web email composer shows "Signed as Name · Position with the … signature"
  under the subject.

## API

| | |
|---|---|
| `PUT /inboxes/:id/signature` | `{ layoutHtml, footerHtml }`, admins/managers, email channels only. Sanitised like an outbound email body. `layoutHtml: null` means the default. |
| `GET /inboxes` | Email channels carry `signature: { layoutHtml, footerHtml }`. |
| `POST /settings/people`, `PATCH /settings/people/:id` | Accept `position`. |
| `PATCH /me/profile` | Accepts `position` (blank clears it). |

Rendering lives in `packages/schemas/src/signatures.ts` (`renderEmailSignature`),
so the settings preview, the composer hint and the sent email all use the same
code.

Storage: `User.position`, `Inbox.signatureHtml`, `Inbox.signatureFooterHtml`
(migration `20261012130000_channel_signatures`, additive).

## Checks

- `pnpm check:email-signature`: rendering rules, who may set positions and
  designs, sanitising, and what each kind of send carries.
- `pnpm check:email-signature-pg`: the same storage on Postgres, and one
  workspace unable to read or change another's.
