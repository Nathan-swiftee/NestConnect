import { useMemo, useState } from "react";
import { Alert, Linking, ScrollView, Text, TextInput, View } from "react-native";
import { api, relativeTime, useAccount, useAccountActivity, useAccountMutation, useMe, useSopRevisions } from "@ding/client";
import { ALERT_PRIORITIES } from "@ding/schemas";
import type {
  AccountAlert,
  AccountContact,
  AccountDetail,
  AccountNote,
  AccountResource,
  AccountSop,
  Actor,
  Attachment,
} from "@ding/schemas";
import {
  AlertIcon,
  BoltIcon,
  ChevronRight,
  ClockIcon,
  DocIcon,
  EditIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "../icons";
import { haptics } from "../haptics";
import { useTheme } from "../theme";
import { useInsets } from "../insets";
import { knowledgeBlocks } from "../knowledge-text";
import { Avatar } from "./Avatar";
import { DocumentViewer } from "./DocumentViewer";
import { AlertRow, SopRow } from "./OrganisationCard";
import { AccountForm, Choice, FormScreen, NoteForm, ResourceForm, RoleForm, ScreenHeader, SopForm } from "./OrganisationForms";
import { OrgRouting } from "./OrgRouting";
import { PeoplePicker } from "./PeoplePicker";
import { EmptyState, QueryState } from "./States";
import { TAB_BAR_H } from "./TabBar";
import { Touchable } from "./Touchable";
import { useToast } from "./Toast";

const STATUS = {
  active: "Active",
  prospect: "Prospect",
  inactive: "Inactive",
} as const;
const PRIORITY = {
  critical: "Critical",
  important: "Important",
  info: "Note",
} as const;

type Tab = "overview" | "people" | "knowledge" | "resources" | "activity";
/** What's open over the profile. */
type Layer =
  | { kind: "edit" }
  | { kind: "sop"; sop: AccountSop | null }
  | { kind: "read"; sopId: string }
  | { kind: "note"; note: AccountNote | null }
  | { kind: "resource"; resource: AccountResource | null }
  | { kind: "role"; link: AccountContact }
  | { kind: "addPeople" };

/**
 * An organisation on the phone — the whole of it, as on the web: details,
 * pinned instructions, the people there and their roles, SOPs (written,
 * versioned, read as a checklist), customer notes, documents, links and apps,
 * and who changed what. Managers and admins can archive, restore or delete it.
 *
 * A full-screen layer over the Customers tab rather than a `Sheet`, with its
 * forms as further layers on top: they run long, and a stack of views avoids
 * the one-modal-at-a-time limit iOS puts on sheets (see `modal-slot.ts`).
 */
export function OrganisationScreen({
  id,
  onClose,
  onOpenContact,
  onOpenOrganisation,
}: {
  id: string | null;
  onClose: () => void;
  onOpenContact: (contactId: string) => void;
  /** A duplicate found while editing: go to that one instead. */
  onOpenOrganisation?: (id: string) => void;
}) {
  const { c } = useTheme();
  const insets = useInsets();
  const toast = useToast();
  const detail = useAccount(id);
  const me = useMe();
  const myId = me.data?.user.id;
  const isManager = me.data?.user.role === "admin" || me.data?.user.role === "manager";
  const [tab, setTab] = useState<Tab>("overview");
  const [layer, setLayer] = useState<Layer | null>(null);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const archive = useAccountMutation((archived: boolean) => api.archiveAccount(id!, archived));
  const remove = useAccountMutation(() => api.deleteAccount(id!));

  if (!id) return null;
  const d = detail.data;
  const a = d?.account;
  const archived = !!a?.archivedAt;
  /** The author, or a manager, may delete a piece of knowledge. */
  const canDelete = (by: Actor | null) => isManager || (!!by?.id && by.id === myId);

  const openResource = (r: AccountResource) => {
    if (r.kind === "file" && r.attachmentId) {
      setViewing({
        id: r.attachmentId,
        kind: "document",
        mime: r.fileMime ?? "application/octet-stream",
        size: r.fileSize ?? 0,
        filename: r.fileName ?? r.title,
        url: `/api/media/${r.attachmentId}`,
      });
    } else if (r.url) void Linking.openURL(r.url);
  };

  const more = () => {
    if (!a) return;
    Alert.alert(a.name, undefined, [
      {
        text: archived ? "Restore" : "Archive",
        onPress: () =>
          archived
            ? archive.mutate(false, {
                onSuccess: () => toast({ text: "Restored" }),
                onError: (e) => toast({ text: errText(e), tone: "error" }),
              })
            : Alert.alert(
                `Archive ${a.name}?`,
                "It leaves the directory and the inbox, and becomes read-only. Contacts and conversations are not affected, and it can be restored.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Archive",
                    onPress: () =>
                      archive.mutate(true, {
                        onSuccess: () => toast({ text: "Archived" }),
                        onError: (e) => toast({ text: errText(e), tone: "error" }),
                      }),
                  },
                ],
              ),
      },
      {
        text: "Delete…",
        style: "destructive",
        onPress: () =>
          Alert.alert(
            `Delete ${a.name} for good?`,
            "Its instructions, SOPs and their history, notes, resources and activity are deleted and can't be recovered. The people and their conversations stay. Archive it instead if you might need it again.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () =>
                  remove.mutate(undefined, {
                    onSuccess: () => {
                      haptics.success();
                      toast({ text: `${a.name} deleted` });
                      onClose();
                    },
                    onError: (e) => toast({ text: errText(e), tone: "error" }),
                  }),
              },
            ],
          ),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const tabs: Array<{ key: Tab; label: string; count?: number }> = d
    ? [
        { key: "overview", label: "Overview" },
        { key: "people", label: "People", count: d.contacts.length },
        {
          key: "knowledge",
          label: "Knowledge & SOPs",
          count: d.sops.filter((s) => s.status === "active").length + d.notes.length,
        },
        { key: "resources", label: "Resources", count: d.resources.length },
        { key: "activity", label: "Activity" },
      ]
    : [];

  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="absolute inset-0">
      <View importantForAccessibility={layer ? "no-hide-descendants" : "auto"} accessibilityElementsHidden={!!layer}>
        <ScreenHeader
          title="Organisation"
          onClose={onClose}
          closeLabel="Close"
          extra={
            a ? (
              <View className="flex-row items-center gap-1">
                {archived ? null : (
                  <Touchable
                    feel="chip"
                    onPress={() => setLayer({ kind: "edit" })}
                    accessibilityRole="button"
                    accessibilityLabel="Edit organisation"
                    className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
                    style={{ backgroundColor: c.surface2 }}
                  >
                    <EditIcon size={13} color={c.text} />
                    <Text className="text-sm font-semibold text-fg">Edit</Text>
                  </Touchable>
                )}
                {isManager ? (
                  <Touchable
                    feel="chip"
                    borderless
                    onPress={more}
                    accessibilityRole="button"
                    accessibilityLabel="Archive or delete"
                    hitSlop={8}
                    className="h-8 w-8 items-center justify-center rounded-full"
                    style={{ backgroundColor: c.surface2 }}
                  >
                    <MoreIcon size={16} color={c.text} />
                  </Touchable>
                ) : null}
              </View>
            ) : undefined
          }
        />
      </View>

      {detail.isLoading || detail.isError || !d || !a ? (
        <QueryState query={detail} what="this organisation" empty={<EmptyState title="Not found" />} />
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            paddingBottom: insets.bottom + 40 + TAB_BAR_H,
          }}
          // Under an open form or SOP, this isn't what a screen reader should read.
          importantForAccessibility={layer ? "no-hide-descendants" : "auto"}
          accessibilityElementsHidden={!!layer}
        >
          <View className="px-5 pb-1 pt-5">
            <Text accessibilityRole="header" className="text-xl font-semibold text-fg">
              {a.name}
            </Text>
            <Text className="text-md text-muted">
              {[
                archived ? "Archived" : STATUS[a.status],
                a.legalName,
                a.reference && `Ref ${a.reference}`,
                a.ownerName && `Owner: ${a.ownerName}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {a.summary ? <Text className="mt-2 text-md text-fg">{a.summary}</Text> : null}
            {a.tags.length ? (
              <View className="mt-2 flex-row flex-wrap gap-1.5">
                {a.tags.map((t) => (
                  <View key={t} style={{ backgroundColor: c.surface2 }} className="rounded-full px-2.5 py-1">
                    <Text style={{ color: c.textMuted }} className="text-2xs font-medium">
                      {t}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          {archived ? (
            <View style={{ backgroundColor: c.amberTint }} className="mx-4 mt-3 rounded-12 px-3 py-2.5">
              <Text className="text-md text-fg">
                Archived {ago(a.archivedAt!)} — read-only, and not shown in the inbox.
                {isManager ? " Restore it from ⋯ to make changes." : ""}
              </Text>
            </View>
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              gap: 6,
              paddingHorizontal: 16,
              paddingTop: 14,
              paddingBottom: 4,
            }}
            accessibilityRole="tablist"
          >
            {tabs.map((t) => {
              const on = tab === t.key;
              return (
                <Touchable
                  feel="chip"
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  style={{ backgroundColor: on ? c.text : c.surface2 }}
                  className="flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5"
                >
                  <Text style={{ color: on ? c.bg : c.text }} className="text-sm font-semibold">
                    {t.label}
                  </Text>
                  {t.count ? (
                    <Text style={{ color: on ? c.bg : c.textMuted }} className="text-2xs font-semibold">
                      {t.count}
                    </Text>
                  ) : null}
                </Touchable>
              );
            })}
          </ScrollView>

          {tab === "overview" ? (
            <Overview
              d={d}
              readOnly={archived}
              canDelete={canDelete}
              onRead={(sopId) => setLayer({ kind: "read", sopId })}
              onAllKnowledge={() => setTab("knowledge")}
            />
          ) : tab === "people" ? (
            <People
              d={d}
              readOnly={archived}
              onOpenContact={onOpenContact}
              onEdit={(link) => setLayer({ kind: "role", link })}
              onAdd={() => setLayer({ kind: "addPeople" })}
            />
          ) : tab === "knowledge" ? (
            <Knowledge
              d={d}
              readOnly={archived}
              canDelete={canDelete}
              onRead={(sopId) => setLayer({ kind: "read", sopId })}
              onNewSop={() => setLayer({ kind: "sop", sop: null })}
              onNote={(note) => setLayer({ kind: "note", note })}
            />
          ) : tab === "resources" ? (
            <Resources
              d={d}
              readOnly={archived}
              canDelete={canDelete}
              onOpen={openResource}
              onEdit={(resource) => setLayer({ kind: "resource", resource })}
            />
          ) : (
            <Activity id={a.id} />
          )}
        </ScrollView>
      )}

      {d && layer?.kind === "edit" ? (
        <AccountForm
          account={d.account}
          onClose={() => setLayer(null)}
          onSaved={() => setLayer(null)}
          onOpenExisting={(other) => {
            setLayer(null);
            onOpenOrganisation?.(other);
          }}
        />
      ) : null}
      {d && layer?.kind === "read" ? (
        <SopReader
          d={d}
          sopId={layer.sopId}
          onClose={() => setLayer(null)}
          onEdit={archived ? undefined : (sop) => setLayer({ kind: "sop", sop })}
          onOpenResource={openResource}
        />
      ) : null}
      {d && layer?.kind === "sop" ? (
        <SopForm
          accountId={d.account.id}
          sop={layer.sop}
          categories={[...new Set(d.sops.map((s) => s.category))]}
          isManager={isManager}
          onClose={() => setLayer(null)}
          onSaved={(s) => setLayer({ kind: "read", sopId: s.id })}
        />
      ) : null}
      {d && layer?.kind === "note" ? (
        <NoteForm accountId={d.account.id} note={layer.note} onClose={() => setLayer(null)} />
      ) : null}
      {d && layer?.kind === "resource" ? (
        <ResourceForm accountId={d.account.id} resource={layer.resource} sops={d.sops} onClose={() => setLayer(null)} />
      ) : null}
      {d && layer?.kind === "role" ? (
        <RoleForm accountId={d.account.id} link={layer.link} onClose={() => setLayer(null)} />
      ) : null}
      {d && layer?.kind === "addPeople" ? <AddPeople d={d} onClose={() => setLayer(null)} /> : null}
      {viewing ? <DocumentViewer attachment={viewing} onClose={() => setViewing(null)} /> : null}
    </View>
  );
}

/** "5m ago", or "just now" — never "now ago". */
const ago = (iso: string) => {
  const t = relativeTime(iso);
  return t === "now" ? "just now" : `${t} ago`;
};

const errText = (err: unknown) => (err instanceof Error && err.message ? err.message : "Something went wrong");

/* ------------------------------- building blocks ------------------------------- */

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View className="pt-5">
      <View className="flex-row items-center justify-between px-5 pb-1.5">
        <Text style={{ color: c.textFaint }} className="text-2xs font-semibold uppercase tracking-wider">
          {title}
        </Text>
        {action ? (
          <Touchable
            feel="chip"
            borderless
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            hitSlop={10}
            className="flex-row items-center gap-1 py-0.5"
          >
            <PlusIcon size={13} color={c.brand} />
            <Text style={{ color: c.brand }} className="text-sm font-semibold">
              {action.label}
            </Text>
          </Touchable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ backgroundColor: c.surface2, borderColor: c.border }} className="mx-4 overflow-hidden rounded-16 border">
      {children}
    </View>
  );
}

function Muted({ children }: { children: string }) {
  return <Text className="px-4 py-3 text-md text-muted">{children}</Text>;
}

function SmallIcon({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Touchable
      feel="chip"
      borderless
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      className="h-8 w-8 items-center justify-center"
    >
      {children}
    </Touchable>
  );
}

const confirm = (title: string, body: string | undefined, verb: string, run: () => void) =>
  Alert.alert(title, body, [
    { text: "Cancel", style: "cancel" },
    { text: verb, style: "destructive", onPress: run },
  ]);

/** Stored rich text, drawn: paragraphs, headings, bullets, quotes, links. */
export function KnowledgeView({ html }: { html: string }) {
  const { c } = useTheme();
  const blocks = knowledgeBlocks(html);
  if (!blocks.length) return null;
  return (
    <View className="gap-1.5">
      {blocks.map((b, i) => {
        const spans = b.spans.map((s, j) => (
          <Text
            key={j}
            onPress={s.href ? () => void Linking.openURL(s.href!) : undefined}
            style={[
              s.bold ? { fontWeight: "600" } : null,
              s.italic ? { fontStyle: "italic" } : null,
              s.href ? { color: c.brandStrong, textDecorationLine: "underline" } : null,
            ]}
          >
            {s.text}
          </Text>
        ));
        if (b.kind === "h")
          return (
            <Text key={i} className="text-md font-semibold text-fg">
              {spans}
            </Text>
          );
        if (b.kind === "li")
          return (
            <View key={i} className="flex-row gap-2 pl-1">
              <Text className="text-md text-muted">•</Text>
              <Text className="flex-1 text-md text-fg">{spans}</Text>
            </View>
          );
        if (b.kind === "quote")
          return (
            <View key={i} style={{ borderLeftColor: c.border }} className="border-l-2 pl-3">
              <Text className="text-md text-muted">{spans}</Text>
            </View>
          );
        return (
          <Text key={i} className="text-md text-fg">
            {spans}
          </Text>
        );
      })}
    </View>
  );
}

/* --------------------------------- overview --------------------------------- */

function Overview({
  d,
  readOnly,
  canDelete,
  onRead,
  onAllKnowledge,
}: {
  d: AccountDetail;
  readOnly: boolean;
  canDelete: (by: Actor | null) => boolean;
  onRead: (sopId: string) => void;
  onAllKnowledge: () => void;
}) {
  const { c } = useTheme();
  const a = d.account;
  const primary = d.contacts.find((x) => x.isPrimary) ?? d.contacts[0];
  const active = d.sops.filter((s) => s.status === "active");
  const rows: Array<[string, string, (() => void)?]> = [
    ...(a.legalName ? [["Legal name", a.legalName] as [string, string]] : []),
    ...(a.reference ? [["Reference", a.reference] as [string, string]] : []),
    ["Account owner", a.ownerName ?? "No one"],
    ...(primary
      ? [["Main contact", `${primary.contact.displayName}${primary.role ? ` · ${primary.role}` : ""}`] as [string, string]]
      : []),
    ...(a.phone
      ? [["Phone", a.phone, () => void Linking.openURL(`tel:${a.phone!.replace(/\s/g, "")}`)] as [string, string, () => void]]
      : []),
    ...(a.email ? [["Email", a.email, () => void Linking.openURL(`mailto:${a.email}`)] as [string, string, () => void]] : []),
    ...(a.website
      ? [
          ["Website", a.website.replace(/^https?:\/\//, ""), () => void Linking.openURL(a.website!)] as [
            string,
            string,
            () => void,
          ],
        ]
      : []),
    ...(a.address ? [["Address", a.address] as [string, string]] : []),
  ];
  return (
    <>
      <AlertsEditor accountId={a.id} alerts={d.alerts} readOnly={readOnly} canDelete={canDelete} />

      <Section title="Overview">
        <Card>
          {a.overview ? (
            <Text className="px-4 py-3 text-md text-fg">{a.overview}</Text>
          ) : (
            <Muted>{readOnly ? "No overview." : "No overview yet — use Edit to add one."}</Muted>
          )}
        </Card>
      </Section>

      <OrgRouting d={d} readOnly={readOnly} />

      <Section title="Procedures">
        <Card>
          {active.length ? (
            active.map((s, i) => (
              <Touchable
                feel="row"
                key={s.id}
                onPress={() => onRead(s.id)}
                accessibilityRole="button"
                accessibilityLabel={s.title}
                style={{ borderTopColor: c.border }}
                className={`flex-row items-center gap-3 px-4 py-2.5 ${i ? "border-t" : ""}`}
              >
                <DocIcon size={15} color={c.brandStrong} />
                <View className="flex-1">
                  <Text className="text-md font-semibold text-fg">{s.title}</Text>
                  <Text className="text-2xs text-muted">{s.category}</Text>
                </View>
                <ChevronRight size={14} color={c.textFaint} />
              </Touchable>
            ))
          ) : (
            <Muted>No active SOPs yet.</Muted>
          )}
          <Touchable
            feel="row"
            onPress={onAllKnowledge}
            accessibilityRole="button"
            style={{ borderTopColor: c.border }}
            className="flex-row items-center gap-2 border-t px-4 py-2.5"
          >
            <Text style={{ color: c.brand }} className="flex-1 text-md font-semibold">
              All knowledge
            </Text>
            <ChevronRight size={14} color={c.brand} />
          </Touchable>
        </Card>
      </Section>

      <Section title="Details">
        <Card>
          {rows.map(([label, value, press], i) => (
            <Touchable
              feel="row"
              key={label}
              disabled={!press}
              onPress={press}
              accessibilityRole={press ? "link" : undefined}
              style={{ borderTopColor: c.border }}
              className={`flex-row gap-3 px-4 py-2.5 ${i ? "border-t" : ""}`}
            >
              <Text className="w-28 text-md text-muted">{label}</Text>
              <Text style={press ? { color: c.brandStrong } : undefined} className="flex-1 text-md text-fg">
                {value}
              </Text>
            </Touchable>
          ))}
        </Card>
      </Section>

      <Section title="At a glance">
        <Card>
          {(
            [
              ["People", String(d.contacts.length)],
              ["Active SOPs", String(active.length)],
              ["Notes", String(d.notes.length)],
              ["Resources", String(d.resources.length)],
              ["Created", `${new Date(a.createdAt).toLocaleDateString()}${a.createdBy ? ` by ${a.createdBy.name}` : ""}`],
              ["Last updated", `${ago(a.updatedAt)}${a.updatedBy ? ` by ${a.updatedBy.name}` : ""}`],
            ] as const
          ).map(([label, value], i) => (
            <View
              key={label}
              style={{ borderTopColor: c.border }}
              className={`flex-row gap-3 px-4 py-2.5 ${i ? "border-t" : ""}`}
            >
              <Text className="w-28 text-md text-muted">{label}</Text>
              <Text className="flex-1 text-md text-fg">{value}</Text>
            </View>
          ))}
        </Card>
      </Section>
    </>
  );
}

/** Pinned instructions, added and edited in place. */
function AlertsEditor({
  accountId,
  alerts,
  readOnly,
  canDelete,
}: {
  accountId: string;
  alerts: AccountAlert[];
  readOnly: boolean;
  canDelete: (by: Actor | null) => boolean;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<AccountAlert["priority"]>("important");
  const save = useAccountMutation(() =>
    editing && editing !== "new"
      ? api.updateAccountAlert(accountId, editing, {
          body: body.trim(),
          priority,
        })
      : api.createAccountAlert(accountId, { body: body.trim(), priority }),
  );
  const remove = useAccountMutation((alertId: string) => api.deleteAccountAlert(accountId, alertId));
  const reset = () => {
    setEditing(null);
    setBody("");
    setPriority("important");
  };

  const form = (
    <View className="gap-2.5 px-3 py-3">
      <TextInput
        value={body}
        onChangeText={setBody}
        autoFocus
        multiline
        maxLength={600}
        accessibilityLabel="Instruction"
        placeholder="Only approved couriers may handle this customer's deliveries."
        placeholderTextColor={c.textFaint}
        textAlignVertical="top"
        style={{
          color: c.text,
          borderColor: c.border,
          backgroundColor: c.surface,
          minHeight: 72,
        }}
        className="rounded-12 border px-3 py-2.5 text-md"
      />
      <Choice
        label="Priority"
        options={ALERT_PRIORITIES.map((p) => ({
          value: p,
          label: PRIORITY[p],
        }))}
        value={priority}
        onChange={setPriority}
      />
      <View className="flex-row justify-end gap-2">
        <Touchable feel="chip" onPress={reset} accessibilityRole="button" className="rounded-12 px-4 py-2">
          <Text className="text-md font-medium text-muted">Cancel</Text>
        </Touchable>
        <Touchable
          feel="slab"
          disabled={!body.trim() || save.isPending}
          onPress={() =>
            save.mutate(undefined, {
              onSuccess: () => {
                haptics.success();
                toast({ text: "Saved" });
                reset();
              },
              onError: (e) => toast({ text: errText(e), tone: "error" }),
            })
          }
          accessibilityRole="button"
          style={{
            backgroundColor: c.brand,
            opacity: !body.trim() || save.isPending ? 0.5 : 1,
          }}
          className="rounded-12 px-4 py-2"
        >
          <Text className="text-md font-semibold text-white">Save</Text>
        </Touchable>
      </View>
    </View>
  );

  return (
    <Section
      title="Important instructions"
      action={readOnly || editing ? undefined : { label: "Add", onPress: () => setEditing("new") }}
    >
      {alerts.length === 0 && editing !== "new" ? (
        <Card>
          <Muted>Nothing pinned. Add what everyone must know before acting for this customer.</Muted>
        </Card>
      ) : null}
      <View className="gap-0">
        {alerts.map((al) =>
          editing === al.id ? (
            <View key={al.id} className="mb-1.5">
              <Card>{form}</Card>
            </View>
          ) : (
            <View key={al.id} className="flex-row items-start">
              <View className="flex-1">
                <AlertRow alert={al} />
              </View>
              {readOnly ? null : (
                <View className="-ml-2 mr-2 flex-row">
                  <SmallIcon
                    label="Edit instruction"
                    onPress={() => {
                      setEditing(al.id);
                      setBody(al.body);
                      setPriority(al.priority);
                    }}
                  >
                    <EditIcon size={14} color={c.textMuted} />
                  </SmallIcon>
                  {canDelete(al.createdBy) ? (
                    <SmallIcon
                      label="Remove instruction"
                      onPress={() =>
                        confirm("Remove this instruction?", undefined, "Remove", () =>
                          remove.mutate(al.id, {
                            onError: (e) => toast({ text: errText(e), tone: "error" }),
                          }),
                        )
                      }
                    >
                      <TrashIcon size={14} color={c.textMuted} />
                    </SmallIcon>
                  ) : null}
                </View>
              )}
            </View>
          ),
        )}
      </View>
      {editing === "new" ? <Card>{form}</Card> : null}
    </Section>
  );
}

/* ---------------------------------- people ---------------------------------- */

function People({
  d,
  readOnly,
  onOpenContact,
  onEdit,
  onAdd,
}: {
  d: AccountDetail;
  readOnly: boolean;
  onOpenContact: (contactId: string) => void;
  onEdit: (link: AccountContact) => void;
  onAdd: () => void;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const unlink = useAccountMutation((contactId: string) => api.unlinkAccountContact(d.account.id, contactId));
  return (
    <Section title={`People at ${d.account.name}`} action={readOnly ? undefined : { label: "Add people", onPress: onAdd }}>
      <Card>
        {d.contacts.length === 0 ? <Muted>No one linked yet. Add the people who message you from this company.</Muted> : null}
        {d.contacts.map((l, i) => (
          <View
            key={l.contactId}
            style={{ borderTopColor: c.border }}
            className={`flex-row items-center pr-1 ${i ? "border-t" : ""}`}
          >
            <Touchable
              feel="row"
              onPress={() => onOpenContact(l.contactId)}
              accessibilityRole="button"
              accessibilityLabel={l.contact.displayName}
              className="flex-1 flex-row items-center gap-3 py-2.5 pl-4"
            >
              <Avatar name={l.contact.displayName} color={l.contact.avatarColor} size={34} />
              <View className="flex-1">
                <Text numberOfLines={1} className="text-md font-medium text-fg">
                  {l.contact.displayName}
                  {l.isPrimary ? (
                    <Text style={{ color: c.brandStrong }} className="text-2xs font-semibold">
                      {" "}
                      PRIMARY
                    </Text>
                  ) : null}
                </Text>
                <Text numberOfLines={1} className="text-2xs text-muted">
                  {[l.role, l.department].filter(Boolean).join(" · ") || "No role set"}
                </Text>
                {l.notes ? (
                  <Text numberOfLines={2} className="text-2xs text-muted">
                    {l.notes}
                  </Text>
                ) : null}
              </View>
            </Touchable>
            {readOnly ? null : (
              <>
                <SmallIcon label={`Edit ${l.contact.displayName}'s role`} onPress={() => onEdit(l)}>
                  <EditIcon size={14} color={c.textMuted} />
                </SmallIcon>
                <SmallIcon
                  label={`Remove ${l.contact.displayName}`}
                  onPress={() =>
                    confirm(
                      `Remove ${l.contact.displayName}?`,
                      `They stay a customer, with all their conversations.`,
                      "Remove",
                      () =>
                        unlink.mutate(l.contactId, {
                          onSuccess: () => toast({ text: "Removed" }),
                          onError: (e) => toast({ text: errText(e), tone: "error" }),
                        }),
                    )
                  }
                >
                  <XIcon size={15} color={c.textMuted} />
                </SmallIcon>
              </>
            )}
          </View>
        ))}
      </Card>
    </Section>
  );
}

function AddPeople({ d, onClose }: { d: AccountDetail; onClose: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>([]);
  const add = useAccountMutation((ids: string[]) => api.linkAccountContacts(d.account.id, { contactIds: ids }));
  return (
    <FormScreen
      title="Add people"
      onCancel={onClose}
      action={{
        label: picked.length > 1 ? `Add ${picked.length}` : "Add",
        disabled: !picked.length || add.isPending,
        onPress: () =>
          add.mutate(picked, {
            onSuccess: () => {
              haptics.success();
              toast({
                text: picked.length === 1 ? "Added" : `${picked.length} people added`,
              });
              onClose();
            },
            onError: (e) => toast({ text: errText(e), tone: "error" }),
          }),
      }}
    >
      <Text className="text-md text-muted">
        Tick everyone at {d.account.name}. Set their roles afterwards with the pencil beside them.
      </Text>
      <View className="-mx-4">
        <PeoplePicker selected={picked} onChange={setPicked} exclude={d.contacts.map((l) => l.contactId)} />
      </View>
    </FormScreen>
  );
}

/* --------------------------------- knowledge --------------------------------- */

function Knowledge({
  d,
  readOnly,
  canDelete,
  onRead,
  onNewSop,
  onNote,
}: {
  d: AccountDetail;
  readOnly: boolean;
  canDelete: (by: Actor | null) => boolean;
  onRead: (sopId: string) => void;
  onNewSop: () => void;
  onNote: (note: AccountNote | null) => void;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState(true);
  const [archivedToo, setArchivedToo] = useState(false);
  const removeNote = useAccountMutation((noteId: string) => api.deleteAccountNote(d.account.id, noteId));
  const needle = q.trim().toLowerCase();
  const strip = (html: string) => html.replace(/<[^>]+>/g, " ");
  const matches = (...texts: string[]) => !needle || texts.some((t) => t.toLowerCase().includes(needle));
  const sops = d.sops.filter(
    (s) =>
      (s.status === "active" || (s.status === "draft" && drafts) || (s.status === "archived" && archivedToo)) &&
      matches(s.title, s.category, s.summary, s.warnings, s.steps.map((x) => x.text).join(" "), strip(s.body)),
  );
  const byCategory = useMemo(() => {
    const m = new Map<string, AccountSop[]>();
    for (const s of sops) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m.entries()].sort(([x], [y]) => x.localeCompare(y));
  }, [sops]);
  const notes = d.notes.filter((n) => matches(n.title, n.category, strip(n.body)));

  const chip = (label: string, on: boolean, toggle: () => void) => (
    <Touchable
      feel="chip"
      onPress={toggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      style={{ backgroundColor: on ? c.brandTint : c.surface2 }}
      className="rounded-full px-3 py-1.5"
    >
      <Text style={{ color: on ? c.brandStrong : c.textMuted }} className="text-sm font-medium">
        {label}
      </Text>
    </Touchable>
  );

  return (
    <>
      <View className="flex-row items-center gap-2 px-4 pt-4">
        <View style={{ backgroundColor: c.surface2 }} className="flex-1 flex-row items-center gap-2 rounded-full px-3.5">
          <SearchIcon size={16} color={c.textFaint} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search procedures and notes"
            placeholderTextColor={c.textFaint}
            accessibilityLabel="Search knowledge"
            autoCorrect={false}
            style={{ color: c.text }}
            className="flex-1 py-2.5 text-md"
          />
        </View>
      </View>
      <View className="flex-row gap-2 px-4 pt-2">
        {chip("Drafts", drafts, () => setDrafts((v) => !v))}
        {chip("Archived", archivedToo, () => setArchivedToo((v) => !v))}
      </View>

      <Section title="Standard operating procedures" action={readOnly ? undefined : { label: "New SOP", onPress: onNewSop }}>
        {byCategory.length === 0 ? (
          <Card>
            <Muted>
              {needle
                ? "Nothing matches."
                : "No procedures yet. Write down how this customer's work is done — step by step, so anyone can do it."}
            </Muted>
          </Card>
        ) : null}
        {byCategory.map(([cat, list]) => (
          <View key={cat} className="mb-2">
            <Text className="px-5 pb-1 text-sm font-semibold text-muted">{cat}</Text>
            <Card>
              {list.map((s, i) => (
                <Touchable
                  feel="row"
                  key={s.id}
                  onPress={() => onRead(s.id)}
                  accessibilityRole="button"
                  accessibilityLabel={s.title}
                  style={{ borderTopColor: c.border }}
                  className={`flex-row items-center gap-3 px-4 py-2.5 ${i ? "border-t" : ""}`}
                >
                  <View className="flex-1">
                    <Text className="text-md font-semibold text-fg">{s.title}</Text>
                    <Text numberOfLines={1} className="text-2xs text-muted">
                      {[
                        s.status !== "active" ? (s.status === "draft" ? "Draft" : "Archived") : null,
                        s.summary || `${s.steps.length} step${s.steps.length === 1 ? "" : "s"}`,
                        `v${s.version} · ${ago(s.updatedAt)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                  {s.warnings ? <AlertIcon size={14} color={c.danger} /> : null}
                  <ChevronRight size={14} color={c.textFaint} />
                </Touchable>
              ))}
            </Card>
          </View>
        ))}
      </Section>

      <Section title="Customer notes" action={readOnly ? undefined : { label: "Add note", onPress: () => onNote(null) }}>
        {notes.length === 0 ? (
          <Card>
            <Muted>{needle ? "Nothing matches." : "No notes yet. Lasting knowledge about the customer goes here."}</Muted>
          </Card>
        ) : null}
        <View className="gap-2">
          {notes.map((n) => (
            <Card key={n.id}>
              <View className="flex-row items-start gap-2 pl-4 pr-1 pt-3">
                <View className="flex-1">
                  <Text className="text-md font-semibold text-fg">{n.title || "Note"}</Text>
                  <Text className="text-2xs text-muted">
                    {[n.category, `${ago(n.updatedAt)}`, n.updatedBy?.name].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                {readOnly ? null : (
                  <>
                    <SmallIcon label="Edit note" onPress={() => onNote(n)}>
                      <EditIcon size={14} color={c.textMuted} />
                    </SmallIcon>
                    {canDelete(n.createdBy) ? (
                      <SmallIcon
                        label="Delete note"
                        onPress={() =>
                          confirm("Delete this note?", undefined, "Delete", () =>
                            removeNote.mutate(n.id, {
                              onError: (e) => toast({ text: errText(e), tone: "error" }),
                            }),
                          )
                        }
                      >
                        <TrashIcon size={14} color={c.textMuted} />
                      </SmallIcon>
                    ) : null}
                  </>
                )}
              </View>
              <View className="px-4 pb-3 pt-1.5">
                <KnowledgeView html={n.body} />
              </View>
            </Card>
          ))}
        </View>
      </Section>
    </>
  );
}

/** One SOP, read the way it's used — and its history. */
function SopReader({
  d,
  sopId,
  onClose,
  onEdit,
  onOpenResource,
}: {
  d: AccountDetail;
  sopId: string;
  onClose: () => void;
  onEdit?: (sop: AccountSop) => void;
  onOpenResource: (r: AccountResource) => void;
}) {
  const { c } = useTheme();
  const insets = useInsets();
  const sop = d.sops.find((s) => s.id === sopId);
  const [history, setHistory] = useState(false);
  const revisions = useSopRevisions(history ? d.account.id : null, history ? sopId : null);
  const [openRev, setOpenRev] = useState<string | null>(null);
  if (!sop) return null;
  const docs = d.resources.filter((r) => r.sopId === sop.id);
  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="absolute inset-0">
      <ScreenHeader
        title="SOP"
        onClose={onClose}
        closeLabel="Close"
        action={onEdit ? { label: "Edit", onPress: () => onEdit(sop) } : undefined}
      />
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + 40 + TAB_BAR_H,
        }}
      >
        <View className="px-5 pb-2 pt-5">
          <Text accessibilityRole="header" className="text-xl font-semibold text-fg">
            {sop.title}
          </Text>
          <Text className="text-md text-muted">
            {[
              sop.status !== "active" ? (sop.status === "draft" ? "Draft" : "Archived") : null,
              sop.category,
              `Version ${sop.version}`,
              `updated ${ago(sop.updatedAt)}${sop.updatedBy ? ` by ${sop.updatedBy.name}` : ""}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {sop.summary ? <Text className="mt-2 text-md text-fg">{sop.summary}</Text> : null}
        </View>
        <Card>
          <SopRow sop={sop} open full onToggle={() => {}} />
        </Card>
        {sop.body ? (
          <Section title="Detailed instructions">
            <Card>
              <View className="px-4 py-3">
                <KnowledgeView html={sop.body} />
              </View>
            </Card>
          </Section>
        ) : null}
        {docs.length ? (
          <Section title="Documents and links">
            <Card>
              {docs.map((r, i) => (
                <ResourceLine key={r.id} r={r} first={i === 0} onOpen={() => onOpenResource(r)} />
              ))}
            </Card>
          </Section>
        ) : null}
        <Section title="Earlier versions">
          <Card>
            {!history ? (
              <Touchable
                feel="row"
                onPress={() => setHistory(true)}
                accessibilityRole="button"
                className="flex-row items-center gap-2 px-4 py-3"
              >
                <ClockIcon size={14} color={c.brand} />
                <Text style={{ color: c.brand }} className="flex-1 text-md font-semibold">
                  Show the history
                </Text>
              </Touchable>
            ) : revisions.isLoading ? (
              <Muted>Loading…</Muted>
            ) : !revisions.data?.length ? (
              <Muted>This is the first version.</Muted>
            ) : (
              revisions.data.map((r, i) => (
                <View key={r.id} style={{ borderTopColor: c.border }} className={i ? "border-t" : ""}>
                  <Touchable
                    feel="row"
                    onPress={() => setOpenRev(openRev === r.id ? null : r.id)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: openRev === r.id }}
                    className="flex-row items-center gap-2 px-4 py-2.5"
                  >
                    <View className="flex-1">
                      <Text className="text-md font-semibold text-fg">Version {r.version}</Text>
                      <Text className="text-2xs text-muted">{`${ago(r.editedAt)}${r.editedBy ? ` · ${r.editedBy.name}` : ""}`}</Text>
                    </View>
                    <View
                      style={{
                        transform: [{ rotate: openRev === r.id ? "90deg" : "0deg" }],
                      }}
                    >
                      <ChevronRight size={14} color={c.textFaint} />
                    </View>
                  </Touchable>
                  {openRev === r.id ? (
                    <View className="gap-1.5 px-4 pb-3">
                      <Text className="text-md font-semibold text-fg">{r.title}</Text>
                      {r.warnings ? (
                        <Text style={{ color: c.danger }} className="text-md">
                          {r.warnings}
                        </Text>
                      ) : null}
                      {r.steps.map((s, j) => (
                        <Text key={j} className="text-md text-fg">{`${j + 1}. ${s.text}`}</Text>
                      ))}
                      <KnowledgeView html={r.body} />
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </Card>
        </Section>
      </ScrollView>
    </View>
  );
}

/* --------------------------------- resources --------------------------------- */

function ResourceLine({
  r,
  first,
  onOpen,
  actions,
}: {
  r: AccountResource;
  first: boolean;
  onOpen: () => void;
  actions?: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View style={{ borderTopColor: c.border }} className={`flex-row items-center pr-1 ${first ? "" : "border-t"}`}>
      <Touchable
        feel="row"
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={r.title}
        className="flex-1 flex-row items-start gap-3 py-2.5 pl-4"
      >
        <View className="pt-0.5">
          {r.kind === "file" ? <DocIcon size={15} color={c.brandStrong} /> : <BoltIcon size={15} color={c.brandStrong} />}
        </View>
        <View className="flex-1">
          <Text className="text-md font-medium text-fg">{r.title}</Text>
          <Text numberOfLines={1} className="text-2xs text-muted">
            {r.kind === "file" ? (r.fileName ?? "Document") : r.url?.replace(/^https?:\/\//, "")}
          </Text>
          {r.description ? <Text className="text-2xs text-muted">{r.description}</Text> : null}
          {r.instructions ? <Text className="mt-0.5 text-sm text-fg">{r.instructions}</Text> : null}
        </View>
      </Touchable>
      {actions}
    </View>
  );
}

function Resources({
  d,
  readOnly,
  canDelete,
  onOpen,
  onEdit,
}: {
  d: AccountDetail;
  readOnly: boolean;
  canDelete: (by: Actor | null) => boolean;
  onOpen: (r: AccountResource) => void;
  onEdit: (r: AccountResource | null) => void;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const remove = useAccountMutation((rid: string) => api.deleteAccountResource(d.account.id, rid));
  const groups = useMemo(() => {
    const m = new Map<string, AccountResource[]>();
    for (const r of d.resources) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return [...m.entries()].sort(([x], [y]) => x.localeCompare(y));
  }, [d.resources]);
  const sopTitle = (sid: string | null) => (sid ? d.sops.find((s) => s.id === sid)?.title : undefined);
  return (
    <Section title="Documents, links & apps" action={readOnly ? undefined : { label: "Add", onPress: () => onEdit(null) }}>
      {groups.length === 0 ? (
        <Card>
          <Muted>
            Nothing here yet. Add templates, price lists, booking portals, shared sheets and the tools this customer's work needs.
          </Muted>
        </Card>
      ) : null}
      {groups.map(([cat, list]) => (
        <View key={cat} className="mb-2">
          <Text className="px-5 pb-1 text-sm font-semibold text-muted">{cat}</Text>
          <Card>
            {list.map((r, i) => (
              <View key={r.id}>
                <ResourceLine
                  r={r}
                  first={i === 0}
                  onOpen={() => onOpen(r)}
                  actions={
                    readOnly ? undefined : (
                      <>
                        <SmallIcon label={`Edit ${r.title}`} onPress={() => onEdit(r)}>
                          <EditIcon size={14} color={c.textMuted} />
                        </SmallIcon>
                        {canDelete(r.createdBy) ? (
                          <SmallIcon
                            label={`Remove ${r.title}`}
                            onPress={() =>
                              confirm(`Remove “${r.title}”?`, undefined, "Remove", () =>
                                remove.mutate(r.id, {
                                  onError: (e) =>
                                    toast({
                                      text: errText(e),
                                      tone: "error",
                                    }),
                                }),
                              )
                            }
                          >
                            <TrashIcon size={14} color={c.textMuted} />
                          </SmallIcon>
                        ) : null}
                      </>
                    )
                  }
                />
                {sopTitle(r.sopId) ? (
                  <Text className="-mt-1.5 pb-2 pl-11 text-2xs text-muted">Goes with: {sopTitle(r.sopId)}</Text>
                ) : null}
              </View>
            ))}
          </Card>
        </View>
      ))}
    </Section>
  );
}

/* --------------------------------- activity --------------------------------- */

function Activity({ id }: { id: string }) {
  const { c } = useTheme();
  const log = useAccountActivity(id);
  return (
    <Section title="Activity">
      <Card>
        {log.isLoading ? <Muted>Loading…</Muted> : null}
        {log.data?.length === 0 ? <Muted>No changes recorded yet.</Muted> : null}
        {log.data?.map((e, i) => (
          <View key={e.id} style={{ borderTopColor: c.border }} className={`flex-row gap-3 px-4 py-2.5 ${i ? "border-t" : ""}`}>
            <View className="pt-0.5">
              <ClockIcon size={14} color={c.textFaint} />
            </View>
            <View className="flex-1">
              <Text className="text-md text-fg">
                <Text className="font-semibold">{e.actor?.name ?? "Someone"}</Text>{" "}
                {e.summary.charAt(0).toLowerCase() + e.summary.slice(1)}
              </Text>
              <Text className="text-2xs text-muted">{ago(e.createdAt)}</Text>
            </View>
          </View>
        ))}
      </Card>
    </Section>
  );
}

/* ------------------------------ new organisation ------------------------------ */

/** The Customers tab's New button: the full organisation form. */
export function NewOrganisationScreen({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  if (!visible) return null;
  return <AccountForm account={null} onClose={onClose} onSaved={onCreated} onOpenExisting={onCreated} />;
}
