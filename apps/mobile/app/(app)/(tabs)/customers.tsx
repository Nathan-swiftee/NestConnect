import { useDeferredValue, useMemo, useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { relativeTime, useAccounts, useContact, useContacts } from "@ding/client";
import type { AccountListItem, AccountStatus, Contact } from "@ding/schemas";
import { Avatar } from "../../../src/components/Avatar";
import { TAB_BAR_H } from "../../../src/components/TabBar";
import { ChannelDot } from "../../../src/components/ChannelDot";
import { EmptyState, QueryState } from "../../../src/components/States";
import { ContactEditor } from "../../../src/components/ContactEditor";
import { ContactOrganisations } from "../../../src/components/ContactOrganisations";
import { NewOrganisationScreen, OrganisationScreen } from "../../../src/components/OrganisationScreen";
import { ChevronRight, PlusIcon, SearchIcon, XIcon } from "../../../src/icons";
import { useTheme } from "../../../src/theme";
import { useInsets } from "../../../src/insets";
import { Touchable } from "../../../src/components/Touchable";

/** What's open on top of the list: customers and organisations open each
 *  other, so it's a stack, and closing goes back one step. */
type Layer = { kind: "contact" | "org"; id: string };

/**
 * The customer directory — the web's Customers section on a phone — with its
 * organisations alongside, one switch away.
 *
 * Mostly reading: on a phone you look someone up to find out who they are and
 * jump into the conversation you already have with them. Creating and merging
 * customers stay on the web — both are forms with duplicate-checking behind
 * them, and neither is something you do one-handed.
 *
 * Correcting a customer is different, and is here. A name arrives from WhatsApp
 * as whatever the customer set as their profile name; noticing it's wrong
 * happens while reading a thread, which is a phone activity. So is putting
 * people in an organisation — from the person, or from the organisation by
 * ticking everyone at once — and starting a new organisation.
 */
export default function Customers() {
  const insets = useInsets();
  const { c } = useTheme();
  const contacts = useContacts();
  const { data } = contacts;
  const [mode, setMode] = useState<"people" | "orgs">("people");
  const [query, setQuery] = useState("");
  const [stack, setStack] = useState<Layer[]>([]);
  const [creating, setCreating] = useState(false);
  const q = useDeferredValue(query.trim().toLowerCase());
  const push = (layer: Layer) => setStack((s) => [...s.filter((l) => !(l.kind === layer.kind && l.id === layer.id)), layer]);
  const pop = () => setStack((s) => s.slice(0, -1));
  const [orgStatus, setOrgStatus] = useState<AccountStatus | undefined>();
  const [orgArchived, setOrgArchived] = useState(false);
  const orgs = useAccounts({
    ...(mode === "orgs" && q ? { search: q } : {}),
    ...(orgStatus ? { status: orgStatus } : {}),
    ...(orgArchived ? { archived: true } : {}),
  });

  const items = useMemo(() => {
    const all = data ?? [];
    if (!q) return all;
    return all.filter((ct) =>
      [ct.displayName, ct.company, ct.phone, ct.email].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [data, q]);

  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="flex-1">
      {/* What's underneath an open customer or organisation is hidden from
          screen readers, which would otherwise read both screens at once. */}
      <View
        className="flex-1"
        importantForAccessibility={stack.length || creating ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={stack.length > 0 || creating}
      >
      <View className="flex-row items-end px-4 pb-2 pt-2">
        <View className="flex-1">
          <Text accessibilityRole="header" className="text-2xl font-semibold tracking-tight text-fg">
            Customers
          </Text>
          <Text className="text-sm text-muted">
            {mode === "people"
              ? data ? `${data.length} in the directory` : ""
              : orgs.data && !q ? `${orgs.data.length} ${orgs.data.length === 1 ? "organisation" : "organisations"}` : ""}
          </Text>
        </View>
        {mode === "orgs" ? (
          <Touchable feel="chip"
            onPress={() => setCreating(true)}
            accessibilityRole="button"
            accessibilityLabel="New organisation"
            style={{ backgroundColor: c.brand }}
            className="flex-row items-center gap-1.5 rounded-full px-3.5 py-2"
          >
            <PlusIcon size={14} color="#fff" />
            <Text className="text-md font-semibold text-white">New</Text>
          </Touchable>
        ) : null}
      </View>

      <View style={{ backgroundColor: c.surface2 }} className="mx-4 mb-2 flex-row rounded-full p-1" accessibilityRole="tablist">
        {(["people", "orgs"] as const).map((m) => (
          <Touchable feel="chip"
            key={m}
            onPress={() => setMode(m)}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
            style={mode === m ? { backgroundColor: c.surface } : undefined}
            className="flex-1 items-center rounded-full py-1.5"
          >
            <Text style={{ color: mode === m ? c.text : c.textMuted }} className="text-md font-semibold">
              {m === "people" ? "People" : "Organisations"}
            </Text>
          </Touchable>
        ))}
      </View>

      <View className="px-4 pb-2">
        <View style={{ backgroundColor: c.surface2 }} className="flex-row items-center gap-2 rounded-full px-3.5">
          <SearchIcon size={17} color={c.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={mode === "people" ? "Search name, organisation, phone or email" : "Search organisations"}
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={{ color: c.text }}
            className="flex-1 py-2.5 text-lg"
          />
        </View>
      </View>

      {mode === "orgs" ? (
        <View className="flex-row flex-wrap gap-1.5 px-4 pb-2">
          {([
            ["active", "Active"],
            ["prospect", "Prospect"],
            ["inactive", "Inactive"],
          ] as const).map(([value, label]) => (
            <FilterChip key={value} label={label} on={orgStatus === value} onPress={() => setOrgStatus(orgStatus === value ? undefined : value)} />
          ))}
          <FilterChip label="Show archived" on={orgArchived} onPress={() => setOrgArchived((v) => !v)} />
        </View>
      ) : null}

      {mode === "people" ? (
      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(ct) => ct.id}
        renderItem={({ item }) => <Row contact={item} onPress={() => push({ kind: "contact", id: item.id })} />}
        ItemSeparatorComponent={() => <View style={{ backgroundColor: c.border }} className="ml-[68px] h-px" />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 + TAB_BAR_H }}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <QueryState
            query={contacts}
            what="your customers"
            empty={
              q ? (
                <EmptyState icon="search" title="No matches" body={`Nothing matching “${query.trim()}”.`} />
              ) : (
                <EmptyState title="No customers yet" body="Customers appear here as they message you." />
              )
            }
          />
        }
      />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={orgs.data ?? []}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => <OrgRow account={item} onPress={() => push({ kind: "org", id: item.id })} />}
          ItemSeparatorComponent={() => <View style={{ backgroundColor: c.border }} className="ml-4 h-px" />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 + TAB_BAR_H }}
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            <QueryState
              query={orgs}
              what="your organisations"
              empty={
                q || orgStatus || orgArchived ? (
                  <EmptyState icon="search" title="No matches" body={q ? `No organisation matching “${query.trim()}”.` : "None with that status."} />
                ) : (
                  <EmptyState title="No organisations yet" body="Tap New to add the first, and tick the people who work there." />
                )
              }
            />
          }
        />
      )}

      </View>

      {stack.map((l, i) => {
        const covered = i < stack.length - 1 || creating;
        return (
          <View
            key={`${l.kind}:${l.id}`}
            className="absolute inset-0"
            pointerEvents="box-none"
            importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
            accessibilityElementsHidden={covered}
          >
            {l.kind === "contact" ? (
              <CustomerSheet id={l.id} onClose={pop} onOpenOrg={(id) => push({ kind: "org", id })} />
            ) : (
              <OrganisationScreen
                id={l.id}
                onClose={pop}
                onOpenContact={(id) => push({ kind: "contact", id })}
                onOpenOrganisation={(id) => push({ kind: "org", id })}
              />
            )}
          </View>
        );
      })}
      <NewOrganisationScreen
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          push({ kind: "org", id });
        }}
      />
    </View>
  );
}

function Row({ contact, onPress }: { contact: Contact; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Touchable feel="row"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={contact.displayName}
      className="flex-row items-center gap-3 px-4 py-3"
    >
      <Avatar name={contact.displayName} color={contact.avatarColor} size={44} />
      <View className="flex-1">
        <Text numberOfLines={1} className="text-lg font-medium text-fg">
          {contact.displayName}
        </Text>
        <Text numberOfLines={1} className="text-sm text-muted">
          {contact.company ||
            contact.phone ||
            contact.email ||
            (contact.visitorId ? "Website visitor" : "—")}
        </Text>
      </View>
      {contact.tags?.length ? (
        <View style={{ backgroundColor: c.surface2 }} className="rounded-full px-2 py-0.5">
          <Text style={{ color: c.textMuted }} className="text-2xs font-medium">
            {contact.tags[0]}
          </Text>
        </View>
      ) : null}
      <ChevronRight size={15} color={c.textFaint} />
    </Touchable>
  );
}

function FilterChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Touchable feel="chip"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{ backgroundColor: on ? c.brandTint : c.surface2 }}
      className="rounded-full px-3 py-1"
    >
      <Text style={{ color: on ? c.brandStrong : c.textMuted }} className="text-sm font-medium">{label}</Text>
    </Touchable>
  );
}

function OrgRow({ account: a, onPress }: { account: AccountListItem; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Touchable feel="row"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a.name}
      className="flex-row items-center gap-3 px-4 py-3"
    >
      <View className="flex-1">
        <Text numberOfLines={1} className="text-lg font-medium text-fg">
          {a.name}
        </Text>
        <Text numberOfLines={1} className="text-sm text-muted">
          {[
            a.archivedAt ? "Archived" : a.status === "active" ? null : a.status === "prospect" ? "Prospect" : "Inactive",
            `${a.contactCount} ${a.contactCount === 1 ? "person" : "people"}`,
            a.reference,
            a.summary,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      {a.alertCount ? (
        <View style={{ backgroundColor: c.amberTint }} className="rounded-full px-2 py-0.5">
          <Text style={{ color: c.amber }} className="text-2xs font-semibold">
            {a.alertCount} pinned
          </Text>
        </View>
      ) : null}
      <ChevronRight size={15} color={c.textFaint} />
    </Touchable>
  );
}

/**
 * One customer, and every conversation we've had with them. This is the point
 * of the directory on a phone: find the person, open the right thread.
 */
function CustomerSheet({
  id,
  onClose,
  onOpenOrg,
}: {
  id: string | null;
  onClose: () => void;
  onOpenOrg: (accountId: string) => void;
}) {
  const insets = useInsets();
  const { c } = useTheme();
  const contact = useContact(id);
  const { data, isLoading } = contact;

  if (!id) return null;

  return (
    <View
      style={{ backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}
      className="absolute inset-0"
    >
      <View
        style={{ borderBottomColor: c.border, backgroundColor: c.surface }}
        className="flex-row items-center gap-2 border-b px-3 py-2.5"
      >
        <Text className="flex-1 text-lg font-semibold text-fg">Customer</Text>
        <Touchable feel="chip" borderless
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={{ backgroundColor: c.surface2 }}
          className="h-8 w-8 items-center justify-center rounded-full"
        >
          <XIcon size={16} color={c.textMuted} />
        </Touchable>
      </View>

      {isLoading || contact.isError || !data ? (
        <QueryState query={contact} what="this customer" empty={<EmptyState title="Not found" />} />
      ) : (
        <FlatList
          data={data.conversations}
          keyExtractor={(cv) => cv.id}
          ListHeaderComponent={
            <View className="pb-1 pt-6">
              <View className="items-center px-6">
                <Avatar name={data.displayName} color={data.avatarColor} size={72} />
                <Text accessibilityRole="header" className="mt-3 text-xl font-semibold text-fg">
                  {data.displayName}
                </Text>
                {data.company ? (
                  <Text className="text-md text-muted">{data.company}</Text>
                ) : null}
                {data.tags?.length ? (
                  <View className="mt-3 flex-row flex-wrap justify-center gap-1.5">
                    {data.tags.map((t) => (
                      <View key={t} style={{ backgroundColor: c.surface2 }} className="rounded-full px-2.5 py-1">
                        <Text style={{ color: c.textMuted }} className="text-2xs font-medium">
                          {t}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>

              {/* Phone and email used to be three centred lines of grey text
                  here. They are the same three fields the details sheet shows,
                  so they are now the same component — which also means the
                  directory can fix a wrong number, not just display it. */}
              <ContactEditor contact={data} />

              <ContactOrganisations contactId={data.id} onOpen={onOpenOrg} />

              <Text style={{ color: c.textFaint }} className="px-5 pb-1.5 pt-6 text-2xs font-semibold uppercase tracking-wider">
                Conversations
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Touchable feel="row"
              onPress={() => {
                onClose();
                router.push({ pathname: "/(app)/thread/[id]", params: { id: item.id } });
              }}
              accessibilityRole="button"
              className="flex-row items-center gap-3 px-5 py-3"
            >
              <ChannelDot channel={item.lastChannel ?? item.channel} size={15} />
              <View className="flex-1">
                <Text numberOfLines={1} className="text-md font-medium text-fg">
                  {item.subject || item.preview || "Conversation"}
                </Text>
                <Text className="text-2xs text-faint">
                  {item.status === "closed" ? "Resolved · " : item.status === "snoozed" ? "Snoozed · " : ""}
                  {relativeTime(item.lastActivityAt) === "now" ? "just now" : `${relativeTime(item.lastActivityAt)} ago`}
                </Text>
              </View>
              <ChevronRight size={15} color={c.textFaint} />
            </Touchable>
          )}
          ListEmptyComponent={
            <Text className="px-6 text-md text-muted">No conversations with this customer yet.</Text>
          }
          contentContainerStyle={{ paddingBottom: 32 + TAB_BAR_H }}
        />
      )}
    </View>
  );
}
