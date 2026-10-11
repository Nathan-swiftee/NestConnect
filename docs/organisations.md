# Organisations and customer knowledge

Nest Connect knows people (contacts) and their conversations. Organisations add
the company behind them, and with it what it takes to serve that customer:
pinned instructions, standard operating procedures, notes and resources.

The aim is operational continuity. Someone who has never dealt with a customer
should be able to pick up a message from them and handle it correctly, without
asking whoever "just knows".

This is knowledge for people to read and act on. Nothing in it is executed, and
it doesn't talk to dispatch or any other system.

## Where it is

| Where | What |
| --- | --- |
| **Organisations** (building icon in the left rail; the sidebar menu on narrow screens) | A searchable directory of organisations, filterable by status, with archived ones on request. Each opens a profile with five tabs: **Overview**, **Contacts**, **Knowledge & SOPs**, **Resources** and **Activity**. |
| **Inbox → the details panel** | An **Organisation** section directly under the contact's header. It shows the organisation, the contact's role there, the pinned instructions, the active SOPs (each opens a reader), the resources, and a link to the full profile. |
| **Customers → a customer's profile** | The customer's organisations, with options to add to an existing one, create a new one, or remove the link. |
| **Organisations → a profile → Contacts → Add people** | Tick any number of customers and add them in one go. **New organisation** has the same picker, so the people can be added as it's created. |
| **Mobile app → Customers → Organisations** | The same organisation as on the web, on a phone. A People / Organisations switch sits at the top of the tab. The directory searches and filters by status, and can show archived ones. **New** opens the full form, including ticking the people who work there. An organisation opens to the same five sections as the web: **Overview** (pinned instructions added and edited in place, overview, details, at a glance), **People** (add several at once, edit roles, remove), **Knowledge & SOPs** (write and edit SOPs with ordered steps, read them as a checklist, see earlier versions; add, edit and delete notes), **Resources** (links, external apps, and documents uploaded from the phone) and **Activity**. **Edit** changes the details. Managers and admins also get **⋯**: archive, restore or delete. |
| **Mobile app → a customer, or conversation details** | The customer's organisations. **Add to an organisation** searches the existing ones, or creates one under the typed name (a name that already exists is offered back to link instead). **Change** in the conversation details adds or removes. |
| **Mobile app → conversation details** | The organisation, its pinned instructions and active SOPs (warnings and steps), plus links and apps. |

## The model

The code calls it **Account** because `Organization` already means the
workspace (the tenant). The UI always says **Organisation**.

| Table | What it holds |
| --- | --- |
| `Account` | Name, legal name, reference, one-line summary, overview, status (active / prospect / inactive), tags, account owner (a user), phone, email, website, address and `archivedAt`. Also `nameKey`, a normalised name used to catch duplicates, and who created and last updated it. |
| `AccountContact` | Contact ↔ organisation, **many-to-many**. Holds role, department, primary flag and notes. Unique per pair. |
| `AccountAlert` | Pinned instructions, each with a priority: critical, important or info. |
| `AccountSop` | Title, category, summary, warnings, `steps` (JSON `[{ text }]`), body (sanitised HTML), status (active / draft / archived) and `version`. |
| `AccountSopRevision` | Every SOP version that was replaced, exactly as it read. |
| `AccountNote` | Lasting customer knowledge (sanitised HTML) with a title and category. Separate from conversation notes. |
| `AccountResource` | A link, an external app (URL plus usage instructions) or a file (`attachmentId` points to an uploaded `Attachment`). Optionally tied to an SOP. |
| `AccountActivity` | Who changed what and when, for every change. |
| `Conversation.accountId` | The organisation a conversation is about, when someone chose one. |

Migration: `20261011170000_organisations` only adds tables and columns. It
adds one nullable column to `Conversation`, and drops and rewrites nothing.

**Deletes:**
- Removing a contact from an organisation never touches the contact or their
  conversations.
- Deleting a contact removes only their links. This is a database-level
  cascade; the organisation stays.
- Merging contacts moves the loser's links to the winner.
- Archiving is the normal way to retire an organisation. It leaves contacts and
  conversations alone, and a conversation that chose an organisation simply
  keeps the reference. It can be restored.
- Deleting is for good, and managers and admins only. It removes the
  organisation and everything it holds: links, alerts, SOPs and their history,
  notes, resources and activity. The people and their conversations stay, and a
  conversation that had chosen it no longer has an organisation. Uploaded files
  are left in storage.

**Duplicates:** names are compared without case, punctuation or the legal
suffix, so "ABC Magazines Ltd", "abc magazines limited" and "A.B.C. Magazines"
match, and an account reference is matched case-insensitively. Creating a
duplicate returns 409 with the existing organisation. The UI offers to open it,
or to create anyway if it really is a different company.

## Contacts and the inbox

The panel beside a conversation (`GET /api/accounts/conversation/:id`) decides
which organisation to show:

1. **One chosen for this conversation**: that one. It is stored on
   `Conversation.accountId` and wins even if the contact has since left the
   organisation, which the panel says.
2. **Otherwise, the contact's only organisation**: that one.
3. **Several, and none chosen**: none. The panel asks "Which is this
   conversation about?" and stores the answer
   (`PUT /api/accounts/conversation/:id`). Nothing is guessed, so nobody reads
   the wrong customer's instructions.
4. **None**: the panel offers to link an existing organisation, to create one
   (the contact is linked as primary), or to leave it.

Only **active** SOPs are presented as how things are done. Drafts and archived
SOPs appear on the profile, clearly labelled, and never in the inbox.

## The old Company field

Organisations replace the free-text **Company** field on contacts.

- **Editing:** it's gone from the customer forms, on the web and in the app.
- **Showing:** wherever a contact's company used to appear, their
  organisation's name appears instead. That covers the customer list, the
  inbox side panel, compose and the app. It is their primary organisation,
  otherwise the first; archived ones don't count.
- **Template variable:** `{{contact.company}}` reads the organisation name.
- **Inbox search:** finds conversations by organisation name.
- **Import:** a *Company* column in a customer import puts each person in that
  organisation. An existing one is matched by name; otherwise a new one is
  created.
- **Old values:** the column is still in the database, so nothing written there
  is lost. It just isn't shown.

## Multi-business

Every organisation belongs to exactly one workspace, and businesses (Swiftee,
Ding, Outwork, …) are separate workspaces. The new tables are registered with
the tenant-scoped Prisma client:
- `Account` is scoped directly.
- Its children are scoped through the account.
- References are checked: `accountId`, `sopId` and `attachmentId`.

So another business's organisations, knowledge and files can't be listed, read,
changed, linked to or chosen for a conversation. Nothing in the model is
specific to one business: SOP and resource categories are free text, with
generic suggestions. A customer who deals with two businesses has a separate
organisation in each, just as they have a separate contact in each.

## Permissions

These are the workspace's existing roles; no new permission system is added.

| Action | Agent | Manager / admin |
| --- | --- | --- |
| View everything | ✓ | ✓ |
| Create organisations, edit details, link contacts | ✓ | ✓ |
| Add or edit alerts, SOPs (active or draft), notes and resources | ✓ | ✓ |
| Choose a conversation's organisation | ✓ | ✓ |
| Delete an alert, note or resource | Their own | Anyone's |
| Archive or restore an SOP | — | ✓ |
| Archive or restore an organisation | — | ✓ |
| Delete an organisation for good | — | ✓ |

Agents can write knowledge because the people who know how a customer is
served are usually the ones doing the work. Nothing is lost in exchange:
- every change is attributed and logged in Activity;
- every SOP edit keeps the version it replaced;
- an archived organisation is read-only until restored.

## Rich text and files

On the phone, SOP instructions and notes are read with the formatting the web
gave them. They are edited as plain text with two conventions: a blank line
starts a paragraph, and "- " starts a bullet ("1. " a numbered item). Bold,
links and headings can't be typed that way. So the form says when a piece has
them, and saving keeps them if the text wasn't changed. See
`apps/mobile/src/knowledge-text.ts`.

SOP instructions and notes use the same TipTap editor as the reply box,
limited to structure: headings, lists, bold, italic, underline, quotes and
links. The server sanitises what's saved (`accounts/knowledge-html.ts`) to
exactly those tags. Links get `rel="noopener noreferrer"`, and scripts, styles,
images and `javascript:` URLs are stripped.

Files are uploaded through the existing `POST /api/media` and served by
`GET /api/media/:id`, under the same workspace check as every other upload.

## API

All routes are under `/api/accounts` and act in the signed-in user's workspace.

```
GET    /accounts?q=&status=&archived=1         directory
POST   /accounts                               create (409 on a duplicate; force: true to override;
                                               contactId and/or contactIds link people as it's made)
GET    /accounts/:id                           profile: account, contacts, alerts, sops, notes, resources
PATCH  /accounts/:id
DELETE /accounts/:id                           delete for good (managers/admins)
POST   /accounts/:id/archive | /restore        managers/admins
GET    /accounts/:id/activity
POST   /accounts/:id/contacts                  link { contactId, role, department, isPrimary, notes }
POST   /accounts/:id/contacts/many             link several { contactIds } (already linked or unknown ids are skipped;
                                               the first becomes primary if there was none)
PATCH  /accounts/:id/contacts/:contactId
DELETE /accounts/:id/contacts/:contactId       unlink (the contact stays)
POST|PATCH|DELETE /accounts/:id/alerts[/:alertId]
POST|PATCH        /accounts/:id/sops[/:sopId]  every PATCH saves a new version
GET               /accounts/:id/sops/:sopId/revisions
POST|PATCH|DELETE /accounts/:id/notes[/:noteId]
POST|PATCH|DELETE /accounts/:id/resources[/:resourceId]
GET    /accounts/by-contact/:contactId         a contact's organisations
GET    /accounts/conversation/:conversationId  what the inbox shows
PUT    /accounts/conversation/:conversationId  { accountId | null }
```

## Code

| Path | What |
| --- | --- |
| `packages/schemas/src/accounts.ts` | Types, input validation and `accountNameKey`. |
| `apps/api/src/accounts/` | The module, with its own small store (`AccountStore`). It has a Postgres implementation, which is tenant-scoped, and an in-memory one for dev and the checks, so the core `Store` isn't enlarged. The service holds permissions, duplicate detection, the inbox rules and the activity log. |
| `apps/web/src/components/organisations/` | The directory, profile, forms, editor, SOP reader and inbox block. |
| `apps/mobile/src/components/OrganisationCard.tsx` | The card in conversation details. |
| `apps/mobile/src/components/OrganisationScreen.tsx` | The organisation on the phone: the five sections, the SOP reader with its history, archive and delete. |
| `apps/mobile/src/components/OrganisationForms.tsx` | Its forms: organisation, SOP, note, resource (including uploading a document), and a person's role. |
| `apps/mobile/src/components/ContactOrganisations.tsx` | A customer's organisations: add, create, remove. Inline, because it also renders inside the details sheet. |
| `apps/mobile/src/components/PeoplePicker.tsx` | Tick-several customer picker. |

## Checks

| Check | Covers |
| --- | --- |
| `pnpm check:organisations` | The acceptance scenarios (new customer, three contacts, incoming message, handover, a contact at two companies, updated instructions), plus permissions, duplicates, archiving, search and the sanitiser. In-memory. Runs in CI. |
| `pnpm check:organisations-pg` | On real Postgres. A second workspace can't reach the first's organisations, knowledge, uploads or conversations, and SOP revisions, contact merge and contact delete behave. Runs in CI's tenant-isolation step. |

## Not built (by design)

Dispatch integrations, automatic courier allocation, route optimisation,
automated CSV bookings, AI agents and executing SOPs were all out of scope.

The data is shaped so these can come later:
- SOPs have structured steps and categories.
- Resources carry URLs and instructions.
- Conversations carry their organisation.
