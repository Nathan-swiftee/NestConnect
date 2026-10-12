import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import type { Macro, TemplateFillContext } from "@ding/schemas";
import { resolveTemplateDefault, searchMacros } from "@ding/schemas";
import { MacroIcon, SearchIcon, XIcon } from "../icons";
import { useTheme } from "../theme";
import { Sheet } from "./Sheet";
import { Touchable } from "./Touchable";

/**
 * Pick a macro — a saved reply — for the reply box.
 *
 * Picking doesn't send. The text, its placeholders filled for this chat, goes
 * into the composer to be read and edited first; Send is still the agent's.
 * Which macros are here is the server's call: this conversation's team inbox's,
 * plus the ones every team gets.
 */
export function MacroSheet({
  macros,
  fill,
  visible,
  onPick,
  onClose,
}: {
  macros: Macro[];
  /** The facts the placeholders fill from, so each row reads as it will send. */
  fill: TemplateFillContext;
  visible: boolean;
  onPick: (m: Macro) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const [q, setQ] = useState("");
  const list = searchMacros(macros, q);
  const close = () => {
    setQ("");
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={close} padded={false} closeLabel="Close macros">
      <View className="flex-row items-center justify-between px-4 pb-3 pt-1">
        <View className="flex-1">
          <Text accessibilityRole="header" className="text-xl font-semibold text-fg">
            Macros
          </Text>
          <Text className="text-2xs text-muted">Saved replies — or type / in the message</Text>
        </View>
        <Touchable
          feel="chip"
          borderless
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={{ backgroundColor: c.surface2 }}
          className="h-8 w-8 items-center justify-center rounded-full"
        >
          <XIcon size={16} color={c.textMuted} />
        </Touchable>
      </View>

      {macros.length > 6 ? (
        <View style={{ backgroundColor: c.surface2 }} className="mx-4 mb-2 flex-row items-center gap-2 rounded-12 px-3">
          <SearchIcon size={16} color={c.textFaint} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search macros"
            placeholderTextColor={c.textFaint}
            accessibilityLabel="Search macros"
            autoCorrect={false}
            autoCapitalize="none"
            style={{ color: c.text }}
            className="flex-1 py-2.5 text-md"
          />
        </View>
      ) : null}

      {/* `flexShrink: 1` — see Sheet.tsx; check:layout enforces it. */}
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        {list.length === 0 ? (
          <View className="items-center gap-2 px-8 py-8">
            <MacroIcon size={26} color={c.textFaint} />
            <Text className="text-center text-md text-muted">
              {macros.length ? `No macro matches “${q}”.` : "No macros for this team yet. Admins add them in Settings › Macros on the web."}
            </Text>
          </View>
        ) : (
          list.map((m, i, arr) => (
            <Touchable
              feel="row"
              key={m.id}
              onPress={() => {
                setQ("");
                onPick(m);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${m.name}`}
              style={{ borderBottomColor: i === arr.length - 1 ? "transparent" : c.border }}
              className={`gap-1 px-4 py-3 ${i === arr.length - 1 ? "" : "border-b"}`}
            >
              <View className="flex-row items-center gap-2">
                <Text numberOfLines={1} className="flex-1 text-md font-semibold text-fg">
                  {m.name}
                </Text>
                {m.shortcut ? (
                  <Text style={{ color: c.brandStrong }} className="text-2xs font-semibold">
                    /{m.shortcut}
                  </Text>
                ) : null}
              </View>
              <Text numberOfLines={2} className="text-sm text-muted">
                {resolveTemplateDefault(m.body, fill)}
              </Text>
            </Touchable>
          ))
        )}
      </ScrollView>
    </Sheet>
  );
}
