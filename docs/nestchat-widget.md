# NestChat widget

Each NestChat channel is its own website chat, with its own settings, under
**Settings › NestChat widget**. Saving applies to the live widget straight away.
That includes the launcher's corner, colour and label: the chat tells the loader
on the site, so the snippet doesn't need pasting again.

## The settings

| Tab | What's there |
| --- | --- |
| **Brand** | Colours, logo, header gradient, theme, launcher corner; whether to show the team's faces and "Powered by Nest Connect". |
| **Words** | Header lines, greeting, message box placeholder, closing message, new-chat button, launcher tooltip. |
| **Home** | The home screen before the chat: its button and cards. |
| **Contact details** | For name, email and phone: **don't ask**, ask **on the form before the chat**, or ask **in the chat** after their first message (email and phone). Each field's wording sits beside it. The form's intro and buttons show once anything is on the form. Below that is the "what it's about" menu that routes to a team. |
| **When nobody's online** | The header line and home-screen line used while nobody is online; the automatic reply; and emailing the replies they haven't seen. |
| **In-app SDK** | The same chat inside your own app. |

The preview beside the form switches between **Someone's online** and
**Nobody's online**. It opens on the second while you're on that tab.

Contact details used to be set in two places: a form on one tab, an in-chat
ask on another. They could both be on, and the in-chat one silently gave way.
Now each field has one choice, written to both (`preChat.*` and
`appearance.askEmail` / `askPhone`).

The widget never asks for something it already has. The session tells it what
the server knows about the visitor (`known`), so a reload, a signed-in site or
an earlier answer doesn't bring the question back.

## When nobody's online

"Nobody online" means everyone who answers the channel is switched off or
outside their hours (see `channelOnline`).

- The header shows the away line, with `{name}` filled in. A home screen shows
  its away line under the chat button.
- **Automatic reply** (on by default). When someone writes, Nest replies in the
  thread:
  - **We have their email** (form, signed-in site, or earlier): *"There's
    nobody online right now — we'll get back to you by email at {email}."*
  - **We don't**: *"There's nobody online right now. Leave your email and we'll
    get back to you there."* An email box sits under it. Once they've given an
    address: *"Thanks — we'll reply to {email}."*
- All three messages are editable. `{name}` and `{email}` are filled in, and a
  blank one takes its space with it.
- The reply is a real message (`Message.auto`: `away` / `away_ask`). Agents see
  it in the conversation, labelled *Automatic reply · nobody was online*.
- It doesn't claim the chat: the chat stays unassigned and unread, and the
  preview stays what the visitor said.
- It's sent once per stretch nobody is there. It goes again only after a person
  has replied since the last one.
- It's never emailed on as an "unseen reply".
- **Emailing unseen replies** keeps the promise: a reply they haven't seen
  within 5 minutes is emailed to them. With it off, the settings warn that the
  automatic reply's promise is down to whoever answers.

`pnpm check:nestchat-away` covers the server side.
