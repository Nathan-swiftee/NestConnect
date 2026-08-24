import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, useContacts, useInboxes } from "@ding/client";
import type { ChannelType, Contact } from "@ding/schemas";
import { Avatar } from "../../src/components/Avatar";
import { Button } from "../../src/components/Button";
import { Field } from "../../src/components/Field";
import { EmptyState } from "../../src/components/States";
import { BackIcon, SearchIcon, channelColor, channelMeta } from "../../src/icons";
import { haptics } from "../../src/haptics";
import { rowIn } from "../../src/motion";
import { useTheme } from "../../src/theme";

/**
 * Start a conversation with someone who hasn't written in.
 *
 * The web has had this; the phone hadn't, which meant the one device an agent
 * actually has on them could only ever *answer*. Chasing a quote, confirming a
 * booking, following something up — all of it had to wait until they were back
 * at a desk.
 *
 * The shape is the web's, in the order a phone wants it:
 *
 *  1. find the customer, or add one;
 *  2. pick the channel to reach them on.
 *
 * There is no third step. `reachContact` opens the customer's existing thread
 * on that channel if they have one and creates it if they don't, so this lands
 * you in the normal thread screen with the normal composer rather than asking
 * you to write the first message in a form that behaves differently from every
 * other message you'll send. It also means starting a conversation with someone
 * you're already talking to can't fork their thread.
 */
export default function Compose() {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const { data: contacts, isLoading } = useContacts();
  const { data: inboxes } = useInboxes();

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Contact | null>(null);
  const [busy, setBusy] = useState<ChannelType | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", phone: "", email: "" });
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const all = contacts ?? [];
    if (!q) return all.slice(0, 50);
    return all
      .filter((x) =>
        [x.displayName, x.company, x.phone, x.email].some((f) => f?.toLowerCase().includes(q)),
      )
      .slice(0, 50);
  }, [contacts, q]);

  /**
   * Whether we could actually send on a channel.
   *
   * Two things have to be true and they fail differently: the customer needs an
   * address, and we need a connected inbox of that type to send from. Saying
   * which one is missing is the difference between a fixable message and a
   * dead end.
   */
  const connected = (type: ChannelType) =>
    (inboxes ?? []).some((i) => (type === "email" ? i.type === "email" : i.type === "whatsapp") && i.connected);

  const reason = (contact: Contact, channel: "whatsapp" | "email"): string | null => {
    const has = channel === "email" ? contact.email : contact.phone;
    if (!has) return channel === "email" ? "No email address on file" : "No phone number on file";
    if (!connected(channel)) return `No ${channelMeta(channel).label} channel connected`;
    return null;
  };

  async function start(contact: Contact, channel: "whatsapp" | "email") {
    setBusy(channel);
    setError(null);
    try {
      const { conversationId } = await api.reachContact(contact.id, channel);
      haptics.success();
      // Replace rather than push: coming back from the thread should land on
      // the inbox, not on the picker you just finished with.
      router.replace({ pathname: "/(app)/thread/[id]", params: { id: conversationId } });
    } catch (err) {
      haptics.error();
      setError(err instanceof Error ? err.message : "Couldn't start that conversation.");
    } finally {
      setBusy(null);
    }
  }

  async function addContact() {
    const name = draft.name.trim();
    const phone = draft.phone.trim();
    const email = draft.email.trim();
    if (!name || (!phone && !email)) {
      setError("A name and at least one way to reach them.");
      return;
    }
    setBusy("whatsapp");
    setError(null);
    try {
      const { contact } = await api.createContact({
        displayName: name,
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
      });
      haptics.success();
      setPicked(contact);
      setAdding(false);
      setDraft({ name: "", phone: "", email: "" });
    } catch (err) {
      haptics.error();
      setError(err instanceof Error ? err.message : "Couldn't add that customer.");
    } finally {
      setBusy(null);
    }
  }

  const back = () => {
    if (adding) return setAdding(false);
    if (picked) return setPicked(null);
    router.back();
  };

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ backgroundColor: c.bg, paddingTop: insets.top }}
      className="flex-1"
    >
      <View
        style={{ borderBottomColor: c.border, backgroundColor: c.surface }}
        className="flex-row items-center gap-2 border-b px-2 py-2"
      >
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} className="px-1 active:opacity-60">
          <BackIcon size={24} color={c.brand} />
        </Pressable>
        <Text accessibilityRole="header" className="flex-1 text-lg font-semibold text-fg">
          {adding ? "New customer" : picked ? "How to reach them" : "New conversation"}
        </Text>
      </View>

      {error ? (
        <Text style={{ color: c.danger }} className="px-4 pt-3 text-md">
          {error}
        </Text>
      ) : null}

      {adding ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }} keyboardShouldPersistTaps="handled">
          <Field label="Name" value={draft.name} onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))} autoFocus />
          <Field
            label="Phone"
            value={draft.phone}
            onChangeText={(v) => setDraft((d) => ({ ...d, phone: v }))}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <Field
            label="Email"
            value={draft.email}
            onChangeText={(v) => setDraft((d) => ({ ...d, email: v }))}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
          />
          <Text className="text-sm text-muted">
            One of the two is enough — it decides which channels you can reach them on.
          </Text>
          <Button title="Add customer" busy={!!busy} onPress={() => void addContact()} />
        </ScrollView>
      ) : picked ? (
        // ── Step 2: which channel ──
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <View className="flex-row items-center gap-3 pb-2">
            <Avatar name={picked.displayName} color={picked.avatarColor} size={48} />
            <View className="flex-1">
              <Text className="text-xl font-semibold text-fg">{picked.displayName}</Text>
              {picked.company ? <Text className="text-md text-muted">{picked.company}</Text> : null}
            </View>
          </View>

          {(["whatsapp", "email"] as const).map((ch) => {
            const meta = channelMeta(ch);
            const Glyph = meta.Glyph;
            const blocked = reason(picked, ch);
            const address = ch === "email" ? picked.email : picked.phone;
            return (
              <Pressable
                key={ch}
                disabled={!!blocked || !!busy}
                onPress={() => void start(picked, ch)}
                accessibilityRole="button"
                accessibilityLabel={`Start on ${meta.label}${blocked ? `. Unavailable: ${blocked}` : ""}`}
                accessibilityState={{ disabled: !!blocked }}
                style={{
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  opacity: blocked ? 0.55 : 1,
                }}
                className="flex-row items-center gap-3 rounded-16 border px-4 py-3.5 active:opacity-70"
              >
                <Glyph size={22} color={blocked ? c.textFaint : channelColor(ch, c)} />
                <View className="flex-1">
                  <Text className="text-lg font-medium text-fg">{meta.label}</Text>
                  <Text numberOfLines={1} className="text-sm text-muted">
                    {blocked ?? address}
                  </Text>
                </View>
                {busy === ch ? <ActivityIndicator color={c.brand} /> : null}
              </Pressable>
            );
          })}

          <Text className="pt-1 text-sm text-muted">
            If you're already talking to {picked.displayName.split(" ")[0]} on that channel, this opens
            that conversation rather than starting a second one.
          </Text>
        </ScrollView>
      ) : (
        // ── Step 1: who ──
        <>
          <View className="px-4 pb-2 pt-3">
            <View style={{ backgroundColor: c.surface2 }} className="flex-row items-center gap-2 rounded-full px-3.5">
              <SearchIcon size={17} color={c.textFaint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search customers"
                placeholderTextColor={c.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                clearButtonMode="while-editing"
                style={{ color: c.text }}
                className="flex-1 py-2.5 text-lg"
              />
            </View>
          </View>

          <FlatList
            data={matches}
            keyExtractor={(item) => item.id}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            ItemSeparatorComponent={() => <View style={{ backgroundColor: c.border }} className="ml-[68px] h-px" />}
            renderItem={({ item, index }) => {
              const row = (
                <Pressable
                  onPress={() => {
                    haptics.select();
                    setPicked(item);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.displayName}${item.company ? `, ${item.company}` : ""}`}
                  className="flex-row items-center gap-3 px-4 py-3 active:opacity-70"
                >
                  <Avatar name={item.displayName} color={item.avatarColor} size={40} />
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-lg font-medium text-fg">
                      {item.displayName}
                    </Text>
                    <Text numberOfLines={1} className="text-sm text-muted">
                      {item.company || item.phone || item.email || "No details yet"}
                    </Text>
                  </View>
                  {/* Which channels this customer is reachable on, before you
                      commit to opening them — it's the thing you'd otherwise
                      tap in to find out. */}
                  <View className="flex-row items-center gap-1.5">
                    {item.phone ? <ChannelMark channel="whatsapp" /> : null}
                    {item.email ? <ChannelMark channel="email" /> : null}
                  </View>
                </Pressable>
              );
              return index < 8 ? <Animated.View entering={rowIn(index)}>{row}</Animated.View> : row;
            }}
            ListEmptyComponent={
              isLoading ? (
                <ActivityIndicator color={c.brand} className="py-8" />
              ) : (
                <EmptyState
                  title={q ? "No one matching that" : "No customers yet"}
                  body={
                    q
                      ? "Add them as a new customer and you can message them straight away."
                      : "Add the first one to start a conversation."
                  }
                  action={{
                    label: "Add a customer",
                    onPress: () => {
                      // Carry the search over — it's usually their name.
                      setDraft((d) => ({ ...d, name: query.trim() }));
                      setAdding(true);
                    },
                  }}
                />
              )
            }
            ListFooterComponent={
              matches.length ? (
                <Pressable
                  onPress={() => {
                    setDraft((d) => ({ ...d, name: query.trim() }));
                    setAdding(true);
                  }}
                  accessibilityRole="button"
                  className="px-4 py-4 active:opacity-60"
                >
                  <Text style={{ color: c.brand }} className="text-md font-medium">
                    + Add a new customer
                  </Text>
                </Pressable>
              ) : null
            }
          />
        </>
      )}
    </KeyboardAvoidingView>
  );
}

/** A small channel glyph, for the "reachable on" cue in the picker. */
function ChannelMark({ channel }: { channel: ChannelType }) {
  const { c } = useTheme();
  const Glyph = channelMeta(channel).Glyph;
  return <Glyph size={14} color={channelColor(channel, c)} />;
}
