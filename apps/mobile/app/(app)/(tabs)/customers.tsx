import { useDeferredValue, useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { relativeTime, useContact, useContacts } from "@ding/client";
import type { Contact } from "@ding/schemas";
import { Avatar } from "../../../src/components/Avatar";
import { ChannelDot } from "../../../src/components/ChannelDot";
import { EmptyState, QueryState } from "../../../src/components/States";
import { ChevronRight, SearchIcon, XIcon } from "../../../src/icons";
import { useTheme } from "../../../src/theme";
import { useInsets } from "../../../src/insets";

/**
 * The customer directory — the web's Customers section on a phone.
 *
 * Reading, not editing: on a phone you look someone up to find out who they are
 * and jump into the conversation you already have with them. Creating and
 * merging customers stay on the web, where the forms belong.
 */
export default function Customers() {
  const insets = useInsets();
  const { c } = useTheme();
  const contacts = useContacts();
  const { data } = contacts;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const q = useDeferredValue(query.trim().toLowerCase());

  const items = useMemo(() => {
    const all = data ?? [];
    if (!q) return all;
    return all.filter((ct) =>
      [ct.displayName, ct.company, ct.phone, ct.email].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [data, q]);

  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="flex-1">
      <View className="px-4 pb-2 pt-2">
        <Text accessibilityRole="header" className="text-2xl font-semibold tracking-tight text-fg">
          Customers
        </Text>
        <Text className="text-sm text-muted">
          {data ? `${data.length} in the directory` : ""}
        </Text>
      </View>

      <View className="px-4 pb-2">
        <View style={{ backgroundColor: c.surface2 }} className="flex-row items-center gap-2 rounded-full px-3.5">
          <SearchIcon size={17} color={c.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, company, phone or email"
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={{ color: c.text }}
            className="flex-1 py-2.5 text-lg"
          />
        </View>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(ct) => ct.id}
        renderItem={({ item }) => <Row contact={item} onPress={() => setOpen(item.id)} />}
        ItemSeparatorComponent={() => <View style={{ backgroundColor: c.border }} className="ml-[68px] h-px" />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
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

      <CustomerSheet id={open} onClose={() => setOpen(null)} />
    </View>
  );
}

function Row({ contact, onPress }: { contact: Contact; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={contact.displayName}
      className="flex-row items-center gap-3 px-4 py-3 active:opacity-70"
    >
      <Avatar name={contact.displayName} color={contact.avatarColor} size={44} />
      <View className="flex-1">
        <Text numberOfLines={1} className="text-lg font-medium text-fg">
          {contact.displayName}
        </Text>
        <Text numberOfLines={1} className="text-sm text-muted">
          {contact.company || contact.phone || contact.email || "—"}
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
    </Pressable>
  );
}

/**
 * One customer, and every conversation we've had with them. This is the point
 * of the directory on a phone: find the person, open the right thread.
 */
function CustomerSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
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
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={{ backgroundColor: c.surface2 }}
          className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
        >
          <XIcon size={16} color={c.textMuted} />
        </Pressable>
      </View>

      {isLoading || contact.isError || !data ? (
        <QueryState query={contact} what="this customer" empty={<EmptyState title="Not found" />} />
      ) : (
        <FlatList
          data={data.conversations}
          keyExtractor={(cv) => cv.id}
          ListHeaderComponent={
            <View className="items-center px-6 py-6">
              <Avatar name={data.displayName} color={data.avatarColor} size={72} />
              <Text accessibilityRole="header" className="mt-3 text-xl font-semibold text-fg">
                {data.displayName}
              </Text>
              {data.company ? (
                <Text className="text-md text-muted">{data.company}</Text>
              ) : null}
              <View className="mt-2 items-center gap-0.5">
                {data.phone ? <Text className="text-md text-muted">{data.phone}</Text> : null}
                {data.email ? <Text className="text-md text-muted">{data.email}</Text> : null}
              </View>
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
              <Text style={{ color: c.textFaint }} className="mt-5 self-start text-2xs font-semibold uppercase tracking-wider">
                Conversations
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onClose();
                router.push({ pathname: "/(app)/thread/[id]", params: { id: item.id } });
              }}
              accessibilityRole="button"
              className="flex-row items-center gap-3 px-5 py-3 active:opacity-70"
            >
              <ChannelDot channel={item.lastChannel ?? item.channel} size={15} />
              <View className="flex-1">
                <Text numberOfLines={1} className="text-md font-medium text-fg">
                  {item.subject || item.preview || "Conversation"}
                </Text>
                <Text className="text-2xs text-faint">
                  {item.status === "closed" ? "Resolved · " : item.status === "snoozed" ? "Snoozed · " : ""}
                  {relativeTime(item.lastActivityAt)} ago
                </Text>
              </View>
              <ChevronRight size={15} color={c.textFaint} />
            </Pressable>
          )}
          ListEmptyComponent={
            <Text className="px-6 text-md text-muted">No conversations with this customer yet.</Text>
          }
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}
    </View>
  );
}
