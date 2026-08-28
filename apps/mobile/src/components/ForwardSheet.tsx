import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Text, TextInput, View } from "react-native";
import type { Contact, Message } from "@ding/schemas";
import { FORWARD_MAX_TARGETS } from "@ding/schemas";
import { useContacts } from "@ding/client";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { CheckIcon, SearchIcon } from "../icons";
import { haptics } from "../haptics";
import { useTheme } from "../theme";
import { Touchable } from "./Touchable";

/** One line describing what's being passed on, for the header. */
function summarise(m: Message): string {
  const body = m.body?.trim();
  if (body) return body;
  const a = m.attachments?.[0];
  if (!a) return "Message";
  switch (a.kind) {
    case "image": return "Photo";
    case "video": return "Video";
    case "voice": return "Voice message";
    case "audio": return "Audio";
    case "sticker": return "Sticker";
    default: return a.filename || "Document";
  }
}

/**
 * Pick the chats to forward a message into.
 *
 * Customers, not addresses — a WhatsApp forward lands in a chat, and the chat is
 * opened as part of the send if there isn't one yet. Capped at the same number
 * WhatsApp caps itself at, and the rows past the cap go quiet rather than
 * swallowing taps, so the limit is visible instead of just felt.
 */
export function ForwardSheet({
  message,
  busy,
  onSubmit,
  onClose,
}: {
  message: Message | null;
  busy: boolean;
  onSubmit: (contactIds: string[]) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { data: contacts, isLoading } = useContacts();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  // Each time the sheet opens it's a fresh forward — carrying the last one's
  // selection over would be a way to send something to the wrong customer.
  useEffect(() => {
    if (message) {
      setQuery("");
      setPicked([]);
    }
  }, [message]);

  // A WhatsApp forward needs a number to land on, and a blocked customer is one
  // we've deliberately stopped messaging.
  const reachable = useMemo(
    () => (contacts ?? []).filter((x) => x.phone && !x.blocked),
    [contacts],
  );
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return reachable.slice(0, 60);
    return reachable
      .filter((x) => [x.displayName, x.company, x.phone].some((f) => f?.toLowerCase().includes(q)))
      .slice(0, 60);
  }, [reachable, q]);

  const atCap = picked.length >= FORWARD_MAX_TARGETS;
  const toggle = (contact: Contact) => {
    setPicked((prev) => {
      if (prev.includes(contact.id)) return prev.filter((x) => x !== contact.id);
      if (prev.length >= FORWARD_MAX_TARGETS) return prev;
      return [...prev, contact.id];
    });
    haptics.select();
  };

  return (
    <Sheet visible={!!message} onClose={onClose} closeLabel="Cancel forwarding">
      {message ? (
        <>
          <Text className="text-2xs font-semibold uppercase tracking-wide text-faint">Forward</Text>
          <Text numberOfLines={2} className="pb-3 pt-0.5 text-md text-muted">
            {summarise(message)}
          </Text>

          <View style={{ backgroundColor: c.surface2 }} className="flex-row items-center gap-2 rounded-full px-3.5">
            <SearchIcon size={17} color={c.textFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search customers"
              placeholderTextColor={c.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              style={{ color: c.text }}
              className="flex-1 py-2.5 text-lg"
            />
          </View>

          {/* Bounded so the list can't grow the sheet past the screen; it
              scrolls inside instead. */}
          <View className="mt-2 h-[280px]">
            <FlatList
              data={matches}
              keyExtractor={(item) => item.id}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              ItemSeparatorComponent={() => (
                <View style={{ backgroundColor: c.border }} className="ml-[52px] h-px" />
              )}
              renderItem={({ item }) => {
                const on = picked.includes(item.id);
                const off = !on && atCap;
                return (
                  <Touchable feel="row"
                    onPress={() => toggle(item)}
                    disabled={off}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: off }}
                    accessibilityLabel={item.displayName}
                    style={{ opacity: off ? 0.4 : 1 }}
                    className="flex-row items-center gap-3 py-2.5"
                  >
                    <Avatar name={item.displayName} color={item.avatarColor} size={38} />
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-lg font-medium text-fg">
                        {item.displayName}
                      </Text>
                      <Text numberOfLines={1} className="text-sm text-muted">
                        {item.company || item.phone}
                      </Text>
                    </View>
                    <View
                      style={{
                        backgroundColor: on ? c.brand : "transparent",
                        borderColor: on ? c.brand : c.borderStrong,
                      }}
                      className="h-6 w-6 items-center justify-center rounded-full border"
                    >
                      {on ? <CheckIcon size={14} color="#fff" /> : null}
                    </View>
                  </Touchable>
                );
              }}
              ListEmptyComponent={
                isLoading ? (
                  <ActivityIndicator color={c.brand} className="py-8" />
                ) : (
                  <Text className="py-8 text-center text-md text-muted">
                    {q ? "No customer matching that." : "No customers with a WhatsApp number yet."}
                  </Text>
                )
              }
            />
          </View>

          {/* A rule above it, because the list clips mid-row when it scrolls and
              without one the hint reads as sitting on top of that last row
              rather than under the list. */}
          <Text
            style={{ borderTopColor: c.border }}
            className="border-t pb-2 pt-2 text-2xs text-faint"
          >
            {atCap
              ? `That's the most WhatsApp forwards to at once (${FORWARD_MAX_TARGETS}).`
              : `Up to ${FORWARD_MAX_TARGETS} chats. Each gets its own copy, marked “Forwarded”.`}
          </Text>

          <Button
            title={picked.length > 1 ? `Forward to ${picked.length}` : "Forward"}
            busy={busy}
            disabled={!picked.length}
            onPress={() => onSubmit(picked)}
          />
        </>
      ) : null}
    </Sheet>
  );
}
