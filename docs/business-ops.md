# Business Ops

The workspace's own standard operating procedures: how *we* do things — opening
the warehouse, issuing a refund, what to do when something goes wrong. Not
about any one customer (that's Organisations' SOPs): these are internal.

Each SOP belongs to one or more teams, or to every team. People in those teams
read it, tick through it as a checklist and confirm the must-reads. Admins and
managers write them.

## Switching it on

Settings › Organisation › **Modules** (web). Off until an admin switches it on;
the setting is per workspace (`module.business_ops` in AppSetting).

Off, the module is hidden on web and in the app, and the API answers 404 for
everything under `/ops` except `GET /ops/status` (which is how the apps know to
hide it) and `PUT /ops/module`. Nothing is deleted: switching back on brings
every SOP, version, confirmation and checklist back as it was. Review reminders
pause while it's off.

## Who sees what

| | Admins and managers | Everyone else |
|---|---|---|
| Published SOPs | All of them | Those for one of their teams, or for All teams |
| Drafts and archived | All of them | Never — an id they can't read is a 404, not a 403 |
| Write, publish, archive, delete | Yes | No |
| Collections | Create, rename, delete | See them |
| Who's read a must-read | Yes | No |

"Their teams" is team membership (Settings › Teams) — the same membership that
decides team inboxes. "All teams" includes teams added later.

## An SOP

| Part | |
|---|---|
| Title, icon, colour | The card. Icon is an emoji; eight colours. |
| Summary | One line: when to use it. |
| Before you start | Warnings, shown first in red. |
| Steps | Numbered. Each can have a picture (uploaded, or an https link) and a link. |
| Details | Rich text — headings, lists, links. Sanitised on save (`accounts/knowledge-html.ts`). |
| Files and links | Uploaded files and web links. |
| Collection | Optional grouping in the library. Deleting a collection keeps its SOPs. |
| Teams / All teams | Who reads it. Needed before publishing. |
| Must read | Readers confirm each new version. |
| Review every | 1, 3, 6, 12 or 24 months, or never. |
| Owner | Who is reminded when a review is due. Defaults to whoever created it. |

### Writing

A new SOP starts from a template: Blank, Checklist, How-to or Incident
response. Steps can be dragged to reorder (or Alt+↑/↓), Enter adds the next
one, and a pasted list — from a document, an email, notes — becomes one step
per line with numbering and bullets taken off ("Paste a list", or paste
straight into a step).

Saving keeps it a **draft** until it's published. Once published, a save is
live straight away and keeps the same version — a typo fix shouldn't need a new
version. **Publishing** again is what makes a new version: the content as it
stands is kept in the history, with an optional note, and must-read readers are
asked to confirm it. An SOP edited since its last version says so to editors,
with a button to publish the next one.

Archiving takes it out of the library for readers and keeps it, with its
history, for editors; restoring puts it back as it was. Deleting removes it and
its history for good.

## Version history

Every publish is kept: who published it, when, the note, and what changed —
"Title changed", "2 steps added", "1 step reworded", "Steps reordered",
"Details edited" (`describeOpsChanges` in `packages/schemas/src/ops.ts`).
Anyone who can read the SOP can open its history and read an old version.

## Must-reads

Publishing a must-read (first time, or a new version) notifies everyone in its
teams except the publisher — a bell notification and a push
(`ops_must_read`). Until they press **I've read this**, the SOP shows "Please
confirm" on its card, sorts first in the library, and counts towards the badge
on the Ops icon. Confirming records the version; a new version asks again.

Editors see **Who's read it**: everyone in its teams, who has confirmed the
current version and who hasn't (and which older version they confirmed, if
any).

## Review reminders

With a review period set, a published SOP is due for review that long after it
was last published or reviewed. Once due it shows "Due for review" to editors
(and under the Due for review filter), and its owner gets one notification
(`ops_review`) — the sweep runs every 10 minutes and tells each owner once per
due date. **Still right — mark reviewed** starts the clock again; publishing a
new version does too. Changing the period recalculates the due date from the
last review.

## Checklist mode

Any reader can switch an SOP's steps to a checklist and tick them off. Ticks
are per person, kept across devices, and cleared with **Reset**. A step removed
from the SOP takes its tick with it.

## Library

Search covers titles, summaries, warnings, steps and details (every word must
match). Collections are tiles that filter the list; quick filters are All, Must
read, and for editors Due for review, Drafts and Archived. "Recently viewed" is
remembered per person in the browser. Must-reads waiting for you come first.

## Print

**Print** prints just the SOP — or saves it as a PDF from the print dialog.

## API

All under `/api/ops`, signed in:

| | |
|---|---|
| `GET status` | `{ enabled, canEdit, pendingAcks }` — works with the module off |
| `PUT module` | `{ enabled }` — admins |
| `GET library?q=` | Collections and the SOPs you can see |
| `POST sops`, `GET/PATCH/DELETE sops/:id` | |
| `POST sops/:id/publish` | `{ note }` |
| `POST sops/:id/archive`, `…/restore`, `…/reviewed` | |
| `GET sops/:id/versions` | Newest first |
| `POST sops/:id/ack`, `GET sops/:id/acks` | Confirm; who has (editors) |
| `PUT sops/:id/checklist`, `DELETE sops/:id/checklist` | `{ done: [stepIndex…] }`; reset |
| `POST collections`, `PATCH/DELETE collections/:id` | |

## Tenancy

`OpsCollection` and `OpsSop` carry `orgId`; their teams, versions,
confirmations and checklists belong to the SOP (`apps/api/src/data/tenant-prisma.ts`).
A write naming another workspace's team, collection, person or SOP is refused
by the tenant-scoped client. The review sweep reads across workspaces and acts
inside each one.

## SOPs added by the platform

`OpsSeedService` adds the Accounts team's first SOPs — Business credit accounts
and Receivables (`apps/api/src/ops/seed/accounts-sops.ts`) — to the operator's
own workspace, once, on start-up. They go in a Finance collection, owned by
David Miles when he's a member, and are published for any team named Accounts,
Accounting, Finance or Credit Control; with no such team they wait as drafts.
A title already there is left alone. The workspace setting
`seed.ops.accounts-sops-v1` records that it ran, so editing or deleting them
afterwards sticks. They're written whether or not the module is on. Logins are
never put in an SOP; it says where they're kept.

## Checks

- `pnpm check:business-ops` — the switch, access, versions, must-reads,
  checklists, reviews, search and collections (in memory).
- `pnpm check:business-ops-pg` — the same store on Postgres, and one
  workspace's SOPs staying its own.
- `pnpm check:accounts-sops` — the Accounts SOPs: published for the right team,
  no passwords, added once.
- `apps/web/src/lib/ops.test.ts` — filters, paste-to-steps, change
  descriptions, recently viewed.
