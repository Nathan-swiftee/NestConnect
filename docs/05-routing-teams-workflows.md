# 05 · Routing, Teams & Workflows

This is the operational heart of Ding: how work finds the right person, how teams share load, and (later) how automation removes the manual steps.

## Concepts

- **Inbox** — a channel endpoint (a WhatsApp number, a group space, an email address). Conversations are born in an inbox.
- **Team** — a named group of users. A team **owns** one or more inboxes and has default routing behaviour.
- **Assignment** — a conversation can be assigned to a **user**, a **team**, both, or neither (unassigned).
- **My Inbound** — the computed personal view: *assigned to me* + *unassigned inbound in my teams' inboxes that's mine to take*.

```mermaid
flowchart LR
    subgraph Teams
      T1["Team: Support"]
      T2["Team: Sales"]
    end
    subgraph Inboxes
      I1["📱 WA +44 20…"]
      I2["💬 Acme space"]
      I3["✉ support@"]
      I4["✉ sales@"]
    end
    T1 --- I1
    T1 --- I3
    T1 --- I2
    T2 --- I4
    T1 -. members .- U1["Alice"]
    T1 -. members .- U2["Ben"]
    T2 -. members .- U3["Cara"]
```

## The routing engine

Runs on every newly-created (or re-opened) conversation, and on demand for manual moves.

```mermaid
flowchart TD
    A["Inbound message → conversation created/updated"] --> B{"Contact has an owner?"}
    B -- "owner = user" --> C["Assign to that user (per-customer routing)"]
    B -- "owner = team" --> D["Assign to that team, then apply team strategy"]
    B -- "no owner" --> E["Use the inbox's owning team(s)"]
    D --> F{"Team routing strategy"}
    E --> F
    F -- "manual / pull" --> G["Leave unassigned → 'Up for grabs' for the team"]
    F -- "round-robin" --> H["Assign next agent in rotation"]
    F -- "load-balanced" --> I["Assign agent with fewest open convos"]
    F -- "most-idle" --> J["Assign agent idle longest & online"]
    C --> K["Emit conversation.assigned + counts (realtime)"]
    G --> K
    H --> K
    I --> K
    J --> K
    K --> L["Everyone's My Inbound / shared views update live"]
```

### 1. Auto per-customer routing (a headline requirement)

Each **Contact** can carry an **owner** (`owner_user_id` or `owner_team_id`). When a message comes in from a known client, Ding assigns the conversation to that owner automatically — so a client always reaches "their" person/team. Owners are set:

- manually by an agent/manager ("make me the owner of Acme"),
- by a workflow (e.g. "first agent to close a deal owns the account"),
- or by import from a CRM.

### 2. Team strategies (when there's no per-customer owner)

Configured per inbox or per team:

| Strategy | Behaviour | Good for |
|---|---|---|
| **Manual / pull** | Stays unassigned in the team's **Up for grabs** queue; whoever grabs it owns it | Small teams, high-context work |
| **Round-robin** | Cycles through available agents | Even distribution |
| **Load-balanced** | Assigns to the agent with the fewest open conversations | Fairness under uneven load |
| **Most-idle** | Assigns to the online agent idle longest | Fast pickup |

Modifiers: **online/away** presence, **business hours**, **skills/labels** (e.g. "billing"), **max concurrent** cap per agent, and **fallback** (if nobody's available → hold in Up for grabs + optional alert).

### 3. Manual assignment & reassignment (a headline requirement)

From any conversation (⌘K, right-click, or the context panel) an agent/manager can:

- **Assign to me** / **assign to another agent**,
- **Route to another team** (e.g. Support → Sales) with an optional reason/note,
- **Unassign** (drop it back to Up for grabs).

Every move: updates the conversation, **writes an `AssignmentEvent`** (who, from, to, why, when), and **emits realtime events** so it leaves the old owner's My Inbound and appears in the new team's queue instantly — with attribution ("Ben moved this to Sales").

### 4. Collision control (shared-inbox safety)

Because multiple agents see the same shared inbox, Ding shows **live presence on each conversation** ("Alice is viewing", "Ben is typing to this client") and a **soft-lock warning** if you start replying to something someone else is actively answering. Prevents double-replies without hard-locking anyone out.

## "My Inbound" — precise semantics

A conversation is in user *U*'s **My Inbound** when it's `open`/`pending` **and** either:

- **Mine** — `assignee = U`; or
- **Up for grabs** — `assignee is null` **and** the conversation's inbox is owned by a team *U* belongs to **and** routing rules make it eligible for *U* (e.g. skills match, within business hours, not pre-assigned by round-robin to someone else).

Sub-filters expose the pieces: `Mine · Up for grabs · @Mentions · Following · Snoozed · Drafts · Sent`. The SQL sketch lives in [`docs/04-data-model.md`](04-data-model.md). The realtime layer recomputes membership on each relevant event and pushes deltas, so the sidebar badge and list never go stale.

## Permissions (who can do what)

| Action | Agent | Team lead | Admin |
|---|---|---|---|
| See/handle their teams' inboxes | ✅ | ✅ | ✅ |
| Assign to self / take from Up for grabs | ✅ | ✅ | ✅ |
| Reassign to another agent (same team) | ✅ | ✅ | ✅ |
| Route to another **team** | ⚙ configurable | ✅ | ✅ |
| Create/connect inboxes & set routing | ❌ | ⚙ | ✅ |
| Manage teams, members, workflows | ❌ | ⚙ | ✅ |
| Compliance/retention/audit settings | ❌ | ❌ | ✅ |

RBAC is enforced server-side (role on `User` + team role on `TeamMember`), via WorkOS/Clerk-backed sessions.

---

## Workflows (Phase 5 — designed now, built later)

Swiftee said workflows come later — but we design the seam now so nothing blocks it. A workflow is **Trigger → Conditions → Actions**, event-driven off the same domain events the realtime layer already emits.

```mermaid
flowchart LR
    TR["Trigger"] --> CO["Conditions (all/any)"] --> AC["Actions (ordered)"]
    subgraph Triggers
      t1["message.received"]
      t2["conversation.created"]
      t3["conversation.assigned"]
      t4["keyword matched"]
      t5["SLA breached / due soon"]
      t6["schedule / business-hours change"]
      t7["no reply for N min"]
    end
    subgraph Conditions
      c1["channel / inbox / team"]
      c2["contact attributes / owner"]
      c3["content match (regex/keyword)"]
      c4["business hours"]
      c5["priority / label"]
    end
    subgraph Actions
      a1["assign to team / agent"]
      a2["add / remove label"]
      a3["set priority"]
      a4["send template / auto-reply"]
      a5["snooze until"]
      a6["notify / @mention"]
      a7["HTTP call / webhook (CRM)"]
      a8["move inbox / close"]
    end
```

**Engine design:**

- Workflows are **JSON-defined** (a trigger, a condition tree, an ordered action list), **versioned**, and **toggleable**. A visual builder renders/edits that JSON.
- Execution runs on **BullMQ workers** subscribed to domain events — off the request path, with retries and idempotency.
- **Dry-run / simulate** against recent conversations before enabling; **audit** every action a workflow takes.
- **Graduation path:** if flows become long-running or multi-step-with-waits (e.g. "wait 2 days, then if still no reply, escalate"), adopt a **durable execution** engine — **Inngest** (great DX, fits our queue model) or **Temporal** (heavy-duty). Start in-house; graduate deliberately.

**Example workflows Swiftee might ship first:**

- *After-hours auto-reply*: `trigger: message.received` + `conditions: outside business hours, first message` → `actions: send "we'll reply at 9am" template, set pending`.
- *VIP fast-lane*: `trigger: conversation.created` + `conditions: contact.label = VIP` → `actions: assign to senior team, priority high, SLA 30m`.
- *Keyword routing*: `trigger: message.received` + `conditions: body matches "invoice|billing"` → `actions: route to Finance team, label billing`.
- *Stale nudge*: `trigger: no reply for 60 min on assigned conversation` → `actions: @mention assignee, escalate to lead if breached`.
