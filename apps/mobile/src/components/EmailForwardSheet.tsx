import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import type { Message } from "@ding/schemas";
import { haptics } from "../haptics";
import { ForwardIcon, XIcon } from "../icons";
import { useTheme } from "../theme";
import { Sheet } from "./Sheet";
import { Touchable } from "./Touchable";

/**
 * Pass an email on to someone else.
 *
 * The WhatsApp forward picks *customers* — you already know who they are, and
 * the point is to drop a message into an existing chat. An email forward picks
 * *addresses*, most of which belong to nobody in the CRM: a colleague, an
 * accountant, a supplier. So it's a typed field rather than a contact list, and
 * it is why this is a second sheet instead of a mode on `ForwardSheet`.
 *
 * It used to be web-only, on the reasoning that an addressed forward wants a
 * keyboard. It wants a keyboard on a phone too, and the phone has one — what it
 * doesn't have is a reason to make someone walk to a desk to send an email
 * onward, which is the sort of gap that quietly sends people back to Gmail.
 */
export function EmailForwardSheet({
  message,
  busy,
  onSubmit,
  onClose,
}: {
  message: Message | null;
  busy: boolean;
  /** Addresses, and the optional line the sender writes above the quote. */
  onSubmit: (to: string[], note: string) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");

  // Each opening is a fresh forward. Carrying the last one's recipients over is
  // a way to send a customer's email to the wrong person.
  useEffect(() => {
    if (message) {
      setTo("");
      setNote("");
    }
  }, [message?.id]);

  const addresses = to
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);
  // Deliberately loose: an address is anything with an @ and a dot after it.
  // A stricter pattern rejects real addresses, and the mail server is the thing
  // that actually knows — this only exists to catch a half-typed one.
  const valid = addresses.filter((a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));
  const bad = addresses.filter((a) => !valid.includes(a));
  const canSend = valid.length > 0 && bad.length === 0 && !busy;

  return (
    <Sheet visible={!!message} onClose={onClose} padded={false} closeLabel="Close forward">
      <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
        <View className="flex-1">
          <Text accessibilityRole="header" className="text-xl font-semibold text-fg">
            Forward email
          </Text>
          <Text numberOfLines={1} className="text-sm text-muted">
            {message?.email?.subject || "No subject"}
          </Text>
        </View>
        <Touchable
          feel="chip"
          borderless
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

      {/* `flexShrink: 1` is what makes this scroll at all — see Sheet.tsx. */}
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        <View className="gap-3 px-4 pt-3">
          <View>
            <Text className="pb-1 text-2xs font-semibold uppercase tracking-wide text-faint">To</Text>
            <TextInput
              value={to}
              onChangeText={setTo}
              placeholder="name@company.com, another@company.com"
              placeholderTextColor={c.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="email"
              keyboardType="email-address"
              multiline
              style={{ backgroundColor: c.surface2, borderColor: bad.length ? c.danger : c.border, color: c.text }}
              className="min-h-[44px] rounded-12 border px-3 py-2.5 text-md"
            />
            {bad.length ? (
              <Text style={{ color: c.danger }} className="pt-1 text-2xs">
                {bad.length === 1 ? `${bad[0]} doesn't look like an address` : `${bad.length} addresses don't look right`}
              </Text>
            ) : (
              <Text className="pt-1 text-2xs text-faint">
                The first address is the To; any others are copied.
              </Text>
            )}
          </View>

          <View>
            <Text className="pb-1 text-2xs font-semibold uppercase tracking-wide text-faint">
              Note (optional)
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Add a line above the forwarded email…"
              placeholderTextColor={c.textFaint}
              multiline
              style={{ backgroundColor: c.surface2, borderColor: c.border, color: c.text }}
              className="min-h-[72px] rounded-12 border px-3 py-2.5 text-md"
            />
          </View>

          <Touchable
            feel="slab"
            onPress={() => {
              haptics.select();
              onSubmit(valid, note);
            }}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            style={{ backgroundColor: canSend ? c.brand : c.surface2 }}
            className="mt-1 flex-row items-center justify-center gap-2 rounded-16 py-3.5"
          >
            <ForwardIcon size={18} color={canSend ? "#fff" : c.textFaint} />
            <Text
              style={{ color: canSend ? "#fff" : c.textFaint }}
              className="text-md font-semibold"
            >
              {busy ? "Forwarding…" : valid.length > 1 ? `Forward to ${valid.length}` : "Forward"}
            </Text>
          </Touchable>
        </View>
      </ScrollView>
    </Sheet>
  );
}
