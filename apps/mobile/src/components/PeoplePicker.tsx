import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useContacts } from "@ding/client";
import { CheckIcon, SearchIcon } from "../icons";
import { useTheme } from "../theme";
import { Avatar } from "./Avatar";
import { Touchable } from "./Touchable";

/** How many rows to draw at once. Search narrows it; nobody scrolls 2,000. */
const SHOWN = 60;

/**
 * Tick any number of customers: search, tap, tap, done. Used when creating an
 * organisation and from an organisation's People section, so people can be
 * added from the organisation's side instead of one customer at a time.
 *
 * Rows rather than a list component: it sits inside a form's ScrollView, and a
 * virtualised list inside a scroller of the same direction is a warning and a
 * broken scroll on Android.
 */
export function PeoplePicker({
  selected,
  onChange,
  exclude = [],
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
}) {
  const { c } = useTheme();
  const contacts = useContacts();
  const [query, setQuery] = useState("");
  const skip = new Set(exclude);
  const chosen = new Set(selected);
  const q = query.trim().toLowerCase();
  const list = (contacts.data ?? [])
    .filter((ct) => !skip.has(ct.id) && !ct.blocked)
    .filter((ct) => !q || [ct.displayName, ct.company, ct.phone, ct.email].some((f) => f?.toLowerCase().includes(q)))
    // Ticked people stay at the top while you search for the next one.
    .sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)))
    .slice(0, SHOWN);
  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <View>
      <View style={{ backgroundColor: c.surface2 }} className="mx-4 mb-2 flex-row items-center gap-2 rounded-full px-3.5">
        <SearchIcon size={16} color={c.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, phone or email"
          placeholderTextColor={c.textFaint}
          accessibilityLabel="Search customers"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={{ color: c.text }}
          className="flex-1 py-2.5 text-md"
        />
      </View>
      {list.map((ct) => {
        const on = chosen.has(ct.id);
        return (
          <Touchable
            feel="row"
            key={ct.id}
            onPress={() => toggle(ct.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={ct.displayName}
            style={on ? { backgroundColor: c.brandTint } : undefined}
            className="flex-row items-center gap-3 px-4 py-2.5"
          >
            <View
              style={{ backgroundColor: on ? c.brand : "transparent", borderColor: on ? c.brand : c.borderStrong }}
              className="h-6 w-6 items-center justify-center rounded-full border"
            >
              {on ? <CheckIcon size={13} color="#fff" /> : null}
            </View>
            <Avatar name={ct.displayName} color={ct.avatarColor} size={34} />
            <View className="flex-1">
              <Text numberOfLines={1} className="text-md font-medium text-fg">{ct.displayName}</Text>
              <Text numberOfLines={1} className="text-2xs text-muted">
                {[ct.company, ct.phone, ct.email].filter(Boolean).join(" · ") || "No contact details"}
              </Text>
            </View>
          </Touchable>
        );
      })}
      {contacts.isLoading ? <Text className="px-5 py-3 text-md text-muted">Loading…</Text> : null}
      {contacts.data && !list.length ? (
        <Text className="px-5 py-3 text-md text-muted">{q ? "No customers match." : "Everyone's already here."}</Text>
      ) : null}
    </View>
  );
}
