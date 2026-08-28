import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { PlusIcon, XIcon } from "../icons";
import { useTheme } from "../theme";
import { Touchable } from "./Touchable";

/**
 * Free-form customer tags: removable pills, an add field, and one-tap
 * suggestions drawn from tags already in use elsewhere in the workspace.
 *
 * The web's version of this is the same three parts. What's different here is
 * which one does the work: on a desktop you type a tag and the suggestions are
 * a convenience, on a phone typing is the expensive part, so the suggestion row
 * is the primary way in and the field is the fallback for a tag that doesn't
 * exist yet. Same data, opposite emphasis.
 */
export function TagEditor({
  tags,
  suggestions,
  onChange,
  disabled,
}: {
  tags: string[];
  /** Every tag in use across the workspace — the ones already applied here are
   *  filtered out below, so this can be passed unfiltered. */
  suggestions: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  const [draft, setDraft] = useState("");

  const has = (t: string) => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t || has(t)) {
      setDraft("");
      return;
    }
    onChange([...tags, t]);
    setDraft("");
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t));
  const open = suggestions.filter((s) => !has(s)).slice(0, 8);

  return (
    <View className="gap-2 px-4">
      <View className="flex-row flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <View
            key={t}
            style={{ backgroundColor: c.brandTint, borderColor: c.brand }}
            className="flex-row items-center gap-1.5 rounded-full border py-1 pl-3 pr-1.5"
          >
            <Text style={{ color: c.brandStrong }} className="text-sm font-semibold">
              {t}
            </Text>
            <Touchable feel="chip"
              onPress={() => remove(t)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${t}`}
              hitSlop={8}
              className="h-5 w-5 items-center justify-center rounded-full"
            >
              <XIcon size={11} color={c.brandStrong} />
            </Touchable>
          </View>
        ))}
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => add(draft)}
          editable={!disabled}
          returnKeyType="done"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={tags.length ? "Add another…" : "Add a tag…"}
          placeholderTextColor={c.textFaint}
          accessibilityLabel="Add a tag"
          style={{ color: c.text, backgroundColor: c.surface2, minWidth: 120 }}
          className="flex-1 rounded-full px-3 py-1.5 text-sm"
        />
      </View>

      {open.length ? (
        <View className="flex-row flex-wrap gap-1.5">
          {open.map((s) => (
            <Touchable feel="chip"
              key={s}
              onPress={() => add(s)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Add ${s}`}
              style={{ borderColor: c.border }}
              className="flex-row items-center gap-1 rounded-full border border-dashed px-2.5 py-1"
            >
              <PlusIcon size={11} color={c.textFaint} />
              <Text style={{ color: c.textMuted }} className="text-2xs font-medium">
                {s}
              </Text>
            </Touchable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
