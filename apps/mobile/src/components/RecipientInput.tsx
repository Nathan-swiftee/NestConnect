import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import type { Contact } from "@ding/schemas";
import { isEmailAddress, parseAddressList, recipientSuggestions } from "@ding/schemas";
import { XIcon } from "../icons";
import { useTheme } from "../theme";
import { Avatar } from "./Avatar";
import { Touchable } from "./Touchable";

/**
 * Email recipients on a phone: type a name, company or address and tap a
 * customer from the list underneath, or type any address and finish it with a
 * comma, a space or Return. Each one becomes a chip with its own ×.
 *
 * The list sits under the field rather than floating over it — there's no room
 * to float anything above a phone keyboard. Teammates aren't offered; an
 * internal note is how you reach them.
 *
 * `autoCapitalize`/`autoCorrect` off and the email keyboard on: a phone
 * otherwise capitalises the first letter of every address and "corrects"
 * domains into English words, which is how a Cc silently goes nowhere.
 */
export function RecipientInput({
  value,
  onChange,
  contacts,
  label,
  placeholder,
  compact,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  contacts: Contact[];
  /** Read out with the field: "Forward to", "Cc", "Bcc". */
  label: string;
  placeholder?: string;
  /** The composer's one-line Cc/Bcc rows, rather than a form field. */
  compact?: boolean;
}) {
  const { c } = useTheme();
  const [text, setText] = useState("");
  const byEmail = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const ct of contacts) if (ct.email) m.set(ct.email.toLowerCase(), ct);
    return m;
  }, [contacts]);
  const suggestions = recipientSuggestions(contacts, text, value, 6);

  const add = (addresses: string[]) => {
    const next = [...value];
    for (const a of addresses) if (a && !next.includes(a)) next.push(a);
    onChange(next);
    setText("");
  };

  function onChangeText(next: string) {
    // A separator typed (or pasted) after something: that something is done.
    if (/[,;\s]$/.test(next) && next.trim()) {
      add(parseAddressList(next));
      return;
    }
    setText(next);
  }

  return (
    <View>
      <View
        style={
          compact
            ? undefined
            : { backgroundColor: c.surface2, borderColor: value.some((a) => !isEmailAddress(a)) ? c.danger : c.border }
        }
        className={compact ? "flex-row flex-wrap items-center gap-1.5" : "min-h-[44px] flex-row flex-wrap items-center gap-1.5 rounded-12 border px-2 py-1.5"}
      >
        {value.map((a) => {
          const known = byEmail.get(a);
          const ok = isEmailAddress(a);
          return (
            <View
              key={a}
              style={{ backgroundColor: ok ? c.brandTint : c.dangerTint }}
              className="flex-row items-center gap-1 rounded-full py-1 pl-2.5 pr-1"
            >
              <Text numberOfLines={1} style={{ color: ok ? c.brandStrong : c.danger, maxWidth: 200 }} className="text-sm font-medium">
                {known ? known.displayName : a}
              </Text>
              <Touchable
                feel="chip"
                borderless
                onPress={() => onChange(value.filter((x) => x !== a))}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${known?.displayName ?? a}`}
                hitSlop={8}
                className="h-5 w-5 items-center justify-center rounded-full"
              >
                <XIcon size={11} color={ok ? c.brandStrong : c.danger} />
              </Touchable>
            </View>
          );
        })}
        <TextInput
          value={text}
          onChangeText={onChangeText}
          onSubmitEditing={() => text.trim() && add(parseAddressList(text))}
          // Only an address-like entry becomes a chip on its own. "nor", half
          // typed when a suggestion is tapped, must stay text — the tap blurs
          // the field first, and turning it into a chip would swallow the pick.
          onBlur={() => text.includes("@") && add(parseAddressList(text))}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
          }}
          blurOnSubmit={false}
          placeholder={value.length ? undefined : placeholder}
          placeholderTextColor={c.textFaint}
          keyboardType="email-address"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          returnKeyType="done"
          accessibilityLabel={label}
          style={{ color: c.text, minWidth: 120 }}
          className={compact ? "flex-1 p-0 text-sm" : "flex-1 px-1 py-1 text-md"}
        />
      </View>
      {suggestions.length ? (
        <View style={{ backgroundColor: c.surface, borderColor: c.border, maxHeight: 220 }} className="mt-1.5 overflow-hidden rounded-12 border">
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ flexShrink: 1 }}>
            {suggestions.map((ct, i, arr) => (
              <Touchable
                feel="row"
                key={ct.id}
                onPress={() => add([ct.email!.toLowerCase()])}
                accessibilityRole="button"
                accessibilityLabel={`Add ${ct.displayName}, ${ct.email}`}
                style={{ borderBottomColor: i === arr.length - 1 ? "transparent" : c.border }}
                className={`flex-row items-center gap-2.5 px-3 py-2 ${i === arr.length - 1 ? "" : "border-b"}`}
              >
                <Avatar name={ct.displayName} color={ct.avatarColor} size={28} />
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-md font-medium text-fg">
                    {ct.displayName}
                  </Text>
                  <Text numberOfLines={1} style={{ color: c.textFaint }} className="text-2xs">
                    {ct.email}
                    {ct.company ? ` · ${ct.company}` : ""}
                  </Text>
                </View>
              </Touchable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
