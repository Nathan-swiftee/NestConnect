import { useState } from "react";
import { Alert, Linking, ScrollView, Text, TextInput, View } from "react-native";
import { api, useAccount, useAccountMutation, type ApiError } from "@ding/client";
import type { AccountContact } from "@ding/schemas";
import { BoltIcon, ChevronRight, PlusIcon, XIcon } from "../icons";
import { haptics } from "../haptics";
import { useTheme } from "../theme";
import { useInsets } from "../insets";
import { Avatar } from "./Avatar";
import { AlertRow, SopRow } from "./OrganisationCard";
import { PeoplePicker } from "./PeoplePicker";
import { EmptyState, QueryState } from "./States";
import { TAB_BAR_H } from "./TabBar";
import { Touchable } from "./Touchable";
import { useToast } from "./Toast";

const STATUS = { active: "Active", prospect: "Prospect", inactive: "Inactive" } as const;

/**
 * An organisation on the phone: what everyone must know about it, how its work
 * is done, and the people at it — who can be added and removed from here, so
 * filling an organisation doesn't mean opening each customer in turn.
 *
 * A full-screen layer over the Customers tab rather than a `Sheet`: it holds a
 * picker that can run to dozens of rows, and it opens customers, which open
 * conversations — a stack of things, not a pop-up.
 */
export function OrganisationScreen({
  id,
  onClose,
  onOpenContact,
}: {
  id: string | null;
  onClose: () => void;
  onOpenContact: (contactId: string) => void;
}) {
  const { c } = useTheme();
  const insets = useInsets();
  const toast = useToast();
  const detail = useAccount(id);
  const { data } = detail;
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const add = useAccountMutation((ids: string[]) => api.linkAccountContacts(id!, { contactIds: ids }));
  const unlink = useAccountMutation((contactId: string) => api.unlinkAccountContact(id!, contactId));

  if (!id) return null;
  const archived = !!data?.account.archivedAt;

  const save = () =>
    add.mutate(picked, {
      onSuccess: () => {
        haptics.success();
        toast({ text: picked.length === 1 ? "Added" : `${picked.length} people added` });
        setPicked([]);
        setAdding(false);
      },
      onError: (err) => toast({ text: err instanceof Error ? err.message : "Couldn't add them", tone: "error" }),
    });

  const remove = (l: AccountContact) =>
    Alert.alert(`Remove ${l.contact.displayName}?`, "They stay a customer, with all their conversations.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          unlink.mutate(l.contactId, {
            onSuccess: () => toast({ text: `${l.contact.displayName} removed` }),
            onError: (err) => toast({ text: err instanceof Error ? err.message : "Couldn't remove", tone: "error" }),
          }),
      },
    ]);

  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="absolute inset-0">
      <Header
        title={adding ? "Add people" : "Organisation"}
        onClose={adding ? () => { setAdding(false); setPicked([]); } : onClose}
        closeLabel={adding ? "Cancel" : "Close"}
        action={
          adding
            ? { label: picked.length > 1 ? `Add ${picked.length}` : "Add", disabled: !picked.length || add.isPending, onPress: save }
            : undefined
        }
      />

      {detail.isLoading || detail.isError || !data ? (
        <QueryState query={detail} what="this organisation" empty={<EmptyState title="Not found" />} />
      ) : adding ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 + TAB_BAR_H }}
        >
          <Text className="px-5 pb-3 text-md text-muted">
            Tick everyone at {data.account.name}. Set their roles on the web.
          </Text>
          <PeoplePicker selected={picked} onChange={setPicked} exclude={data.contacts.map((l) => l.contactId)} />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 + TAB_BAR_H }}>
          <View className="px-5 pb-2 pt-5">
            <Text accessibilityRole="header" className="text-xl font-semibold text-fg">{data.account.name}</Text>
            <Text className="text-md text-muted">
              {[STATUS[data.account.status], data.account.reference, archived ? "Archived" : null].filter(Boolean).join(" · ")}
            </Text>
            {data.account.summary ? <Text className="mt-2 text-md text-fg">{data.account.summary}</Text> : null}
          </View>

          {data.alerts.length ? (
            <>
              <Label>Pinned</Label>
              {data.alerts.map((a) => <AlertRow key={a.id} alert={a} />)}
            </>
          ) : null}

          {data.sops.some((s) => s.status === "active") ? (
            <>
              <Label>How we do things</Label>
              <View style={{ backgroundColor: c.surface2, borderColor: c.border }} className="mx-4 overflow-hidden rounded-16 border">
                {data.sops
                  .filter((s) => s.status === "active")
                  .map((s, i) => (
                    <View key={s.id} style={i === 0 ? { marginTop: -1 } : undefined}>
                      <SopRow sop={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
                    </View>
                  ))}
              </View>
            </>
          ) : null}

          {data.resources.some((r) => r.kind !== "file" && r.url) ? (
            <>
              <Label>Links and apps</Label>
              <View style={{ backgroundColor: c.surface2, borderColor: c.border }} className="mx-4 overflow-hidden rounded-16 border">
                {data.resources
                  .filter((r) => r.kind !== "file" && r.url)
                  .map((r, i) => (
                    <Touchable
                      feel="row"
                      key={r.id}
                      onPress={() => void Linking.openURL(r.url!)}
                      accessibilityRole="link"
                      accessibilityLabel={r.title}
                      style={{ borderTopColor: c.border }}
                      className={`flex-row items-center gap-3 px-4 py-2.5 ${i ? "border-t" : ""}`}
                    >
                      <BoltIcon size={15} color={c.brandStrong} />
                      <View className="flex-1">
                        <Text className="text-md font-medium text-fg">{r.title}</Text>
                        {r.instructions ? <Text className="text-2xs text-muted">{r.instructions}</Text> : null}
                      </View>
                      <ChevronRight size={14} color={c.textFaint} />
                    </Touchable>
                  ))}
              </View>
            </>
          ) : null}

          <Label>{`People · ${data.contacts.length}`}</Label>
          <View style={{ backgroundColor: c.surface2, borderColor: c.border }} className="mx-4 overflow-hidden rounded-16 border">
            {data.contacts.map((l, i) => (
              <View key={l.contactId} style={{ borderTopColor: c.border }} className={`flex-row items-center pr-2 ${i ? "border-t" : ""}`}>
                <Touchable
                  feel="row"
                  onPress={() => onOpenContact(l.contactId)}
                  accessibilityRole="button"
                  accessibilityLabel={l.contact.displayName}
                  className="flex-1 flex-row items-center gap-3 py-2.5 pl-4"
                >
                  <Avatar name={l.contact.displayName} color={l.contact.avatarColor} size={34} />
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-md font-medium text-fg">{l.contact.displayName}</Text>
                    <Text numberOfLines={1} className="text-2xs text-muted">
                      {[l.role, l.isPrimary ? "Primary" : null, l.contact.phone || l.contact.email].filter(Boolean).join(" · ") || "—"}
                    </Text>
                  </View>
                </Touchable>
                {archived ? null : (
                  <Touchable
                    feel="chip"
                    borderless
                    onPress={() => remove(l)}
                    disabled={unlink.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${l.contact.displayName}`}
                    hitSlop={8}
                    className="h-8 w-8 items-center justify-center"
                  >
                    <XIcon size={15} color={c.textMuted} />
                  </Touchable>
                )}
              </View>
            ))}
            {!data.contacts.length ? <Text className="px-4 pt-3 text-md text-muted">Nobody here yet.</Text> : null}
            {archived ? (
              <Text className="px-4 py-3 text-2xs text-muted">Archived organisations are read-only. Restore it on the web.</Text>
            ) : (
              <Touchable
                feel="row"
                onPress={() => setAdding(true)}
                accessibilityRole="button"
                style={data.contacts.length ? { borderTopColor: c.border } : undefined}
                className={`flex-row items-center gap-2 px-4 py-3 ${data.contacts.length ? "border-t" : ""}`}
              >
                <PlusIcon size={15} color={c.brand} />
                <Text style={{ color: c.brand }} className="text-md font-semibold">Add people</Text>
              </Touchable>
            )}
          </View>

          {data.notes.length || data.sops.some((s) => s.status !== "active") || data.resources.some((r) => r.kind === "file") ? (
            <Text className="px-5 pt-4 text-2xs text-muted">Notes, drafts and documents are on the web, under Organisations.</Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * A new organisation: its name and a line about it, and — optionally — the
 * people at it, ticked from the customer list. Everything else (instructions,
 * SOPs, owner) is filled in later, on the web.
 */
export function NewOrganisationScreen({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { c } = useTheme();
  const insets = useInsets();
  const toast = useToast();
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");
  const [summary, setSummary] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);
  const create = useAccountMutation((force: boolean) =>
    api.createAccount({
      name: name.trim(),
      reference: reference.trim() || null,
      summary: summary.trim(),
      contactIds: people.length ? people : undefined,
      force,
    }),
  );

  if (!visible) return null;

  const reset = () => {
    setName("");
    setReference("");
    setSummary("");
    setPeople([]);
    setError(null);
    setExisting(null);
  };
  const close = () => {
    reset();
    onClose();
  };
  const save = (force = false) => {
    if (!name.trim()) {
      setError("An organisation needs a name.");
      return;
    }
    create.mutate(force, {
      onSuccess: (a) => {
        haptics.success();
        toast({ text: `${a.name} created` });
        reset();
        onCreated(a.id);
      },
      onError: (err) => {
        const e = err as ApiError;
        const found = (e.body as { details?: { existing?: { id: string; name: string } } } | undefined)?.details?.existing;
        if (e.status === 409 && found) {
          setExisting(found);
          setError(e.message);
        } else {
          haptics.error();
          setError(e.message || "Couldn't create it. Please try again.");
        }
      },
    });
  };

  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="absolute inset-0">
      <Header
        title="New organisation"
        onClose={close}
        closeLabel="Cancel"
        action={{ label: create.isPending ? "Creating…" : "Create", disabled: !name.trim() || create.isPending, onPress: () => save() }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 + TAB_BAR_H }}
      >
        <View className="gap-3 px-4 pt-4">
          <Input label="Name" value={name} onChangeText={(t) => { setName(t); setError(null); setExisting(null); }} autoFocus placeholder="ABC Magazines" />
          <Input label="Account reference (optional)" value={reference} onChangeText={setReference} autoCapitalize="characters" autoCorrect={false} placeholder="ABC-001" />
          <Input label="One line about them (optional)" value={summary} onChangeText={setSummary} placeholder="Weekly magazine deliveries to newsagents" />
          {error ? (
            <View style={existing ? { backgroundColor: c.amberTint } : undefined} className={existing ? "gap-2 rounded-12 px-3 py-2.5" : ""}>
              <Text accessibilityLiveRegion="polite" className={existing ? "text-md text-fg" : "text-sm text-danger"}>{error}</Text>
              {existing ? (
                <View className="flex-row flex-wrap gap-2">
                  <Touchable
                    feel="slab"
                    onPress={() => { reset(); onCreated(existing.id); }}
                    accessibilityRole="button"
                    style={{ backgroundColor: c.brand }}
                    className="rounded-12 px-3.5 py-2"
                  >
                    <Text className="text-md font-semibold text-white">Open {existing.name}</Text>
                  </Touchable>
                  <Touchable
                    feel="chip"
                    onPress={() => save(true)}
                    disabled={create.isPending}
                    accessibilityRole="button"
                    style={{ borderColor: c.border }}
                    className="rounded-12 border px-3.5 py-2"
                  >
                    <Text className="text-md font-medium text-fg">It's a different company</Text>
                  </Touchable>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        <Label>{people.length ? `People · ${people.length} chosen` : "People at this organisation (optional)"}</Label>
        <PeoplePicker selected={people} onChange={setPeople} />
      </ScrollView>
    </View>
  );
}

function Header({
  title,
  onClose,
  closeLabel,
  action,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  action?: { label: string; disabled?: boolean; onPress: () => void };
}) {
  const { c } = useTheme();
  return (
    <View style={{ borderBottomColor: c.border, backgroundColor: c.surface }} className="flex-row items-center gap-2 border-b px-3 py-2.5">
      <Touchable
        feel="chip"
        borderless
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        hitSlop={10}
        style={{ backgroundColor: c.surface2 }}
        className="h-8 w-8 items-center justify-center rounded-full"
      >
        <XIcon size={16} color={c.textMuted} />
      </Touchable>
      <Text numberOfLines={1} className="flex-1 text-lg font-semibold text-fg">{title}</Text>
      {action ? (
        <Touchable
          feel="slab"
          onPress={action.onPress}
          disabled={action.disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!action.disabled }}
          style={{ backgroundColor: c.brand, opacity: action.disabled ? 0.5 : 1 }}
          className="rounded-full px-4 py-1.5"
        >
          <Text className="text-md font-semibold text-white">{action.label}</Text>
        </Touchable>
      ) : null}
    </View>
  );
}

function Label({ children }: { children: string }) {
  const { c } = useTheme();
  return (
    <Text style={{ color: c.textFaint }} className="px-5 pb-1.5 pt-5 text-2xs font-semibold uppercase tracking-wider">
      {children}
    </Text>
  );
}

function Input({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { c } = useTheme();
  return (
    <View className="gap-1.5">
      <Text accessibilityElementsHidden importantForAccessibility="no" className="text-sm font-medium text-muted">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.textFaint}
        style={{ color: c.text, borderColor: c.border, backgroundColor: c.surface2 }}
        className="rounded-12 border px-3.5 py-3 text-md"
        {...props}
      />
    </View>
  );
}
