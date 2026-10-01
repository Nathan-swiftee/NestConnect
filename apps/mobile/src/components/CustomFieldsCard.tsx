import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useCustomFields, useCustomFieldValues, useSetCustomFieldValues } from "@ding/client";
import { fieldsForInbox } from "@ding/schemas";
import type { CustomField, CustomFieldEntity, CustomFieldValue } from "@ding/schemas";
import { useTheme } from "../theme";
import { haptics } from "../haptics";
import { CheckIcon } from "../icons";
import { Touchable } from "./Touchable";
import { useToast } from "./Toast";

/**
 * The channel's own fields, on the thread they belong to.
 *
 * The web has had these beside every conversation since they existed; the phone
 * has never shown them at all. That is the half of the feature that matters
 * least to whoever defined the field and most to whoever reads the thread: an
 * order number arrives from an app's SDK, attached to the conversation before
 * anybody has said a word, and the person who needs it is the one holding a
 * phone looking at the message about it.
 *
 * Editable here, not just readable, for the same reason the customer's details
 * became editable on the phone: the moment you learn the right value is the
 * moment you are reading the thread.
 *
 * Nothing is drawn when the channel has no fields. A section that is always
 * there and always empty teaches people to stop looking at it.
 */
export function CustomFieldsCard({
  inboxId,
  conversationId,
  contactId,
}: {
  inboxId: string | null;
  conversationId: string;
  contactId: string;
}) {
  const { c } = useTheme();
  const fields = useCustomFields();
  const convValues = useCustomFieldValues("conversation", conversationId);
  const contactValues = useCustomFieldValues("contact", contactId);

  const here = fieldsForInbox(fields.data ?? [], inboxId);
  const convFields = here.filter((f) => f.entity === "conversation");
  const contactFields = here.filter((f) => f.entity === "contact");
  if (!convFields.length && !contactFields.length) return null;

  const rows: Array<{ field: CustomField; entityId: string; values?: CustomFieldValue[] }> = [
    ...convFields.map((field) => ({ field, entityId: conversationId, values: convValues.data })),
    ...contactFields.map((field) => ({ field, entityId: contactId, values: contactValues.data })),
  ];

  return (
    <>
      <Text
        style={{ color: c.textFaint }}
        className="px-5 pb-1.5 pt-5 text-2xs font-semibold uppercase tracking-wider"
      >
        {/* Named for what it is to the business, not for how it is stored. An
            agent has never heard the phrase "custom field". */}
        This channel's details
      </Text>
      <View
        style={{ backgroundColor: c.surface2, borderColor: c.border }}
        className="mx-4 rounded-16 border"
      >
        {rows.map((row, i) => (
          <FieldRow
            key={row.field.id}
            field={row.field}
            entity={row.field.entity}
            entityId={row.entityId}
            value={row.values?.find((v) => v.key === row.field.key)?.value ?? ""}
            last={i === rows.length - 1}
          />
        ))}
      </View>
      {convFields.length > 0 && contactFields.length > 0 ? (
        <Text className="px-5 pt-1.5 text-2xs text-muted">
          The last {contactFields.length === 1 ? "one follows" : "few follow"} the customer, not
          this chat.
        </Text>
      ) : null}
    </>
  );
}

/**
 * One field: what it holds, and a tap to change it.
 *
 * Expanded in place rather than in a sheet. This renders inside the details
 * sheet, which is a `Modal`, and a `Modal` inside a `Modal` is unreliable on
 * Android — the same reason the customer's own editor is inline.
 */
function FieldRow({
  field,
  entity,
  entityId,
  value,
  last,
}: {
  field: CustomField;
  entity: CustomFieldEntity;
  entityId: string;
  value: string;
  last?: boolean;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const save = useSetCustomFieldValues();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const write = (next: string) => {
    setEditing(false);
    if (next.trim() === value) return;
    save.mutate(
      // Null, not an empty string: clearing a field is deleting the value, and
      // an empty one would be a value that happens to read as nothing.
      { entity, entityId, values: { [field.key]: next.trim() || null } },
      {
        onSuccess: () => haptics.success(),
        onError: (err) => {
          haptics.error();
          toast({ text: err instanceof Error ? err.message : "Couldn't save that" });
        },
      },
    );
  };

  const open = () => {
    // From what the server holds, not from whatever a previous edit left in
    // state — an SDK or another agent may have written it since.
    setDraft(value);
    setEditing(true);
  };

  if (editing && field.type === "select") {
    return (
      <View
        style={{ borderBottomColor: last ? "transparent" : c.border }}
        className={`gap-2 px-4 py-3 ${last ? "" : "border-b"}`}
      >
        <Text className="text-sm font-medium text-muted">{field.label}</Text>
        <View className="flex-row flex-wrap gap-2">
          {field.options.map((option) => (
            <Touchable
              feel="chip"
              key={option}
              onPress={() => write(option === value ? "" : option)}
              accessibilityRole="button"
              accessibilityState={{ selected: option === value }}
              style={{
                backgroundColor: option === value ? c.brand : c.surface,
                borderColor: option === value ? c.brand : c.border,
              }}
              className="flex-row items-center gap-1.5 rounded-full border px-3 py-1.5"
            >
              {option === value ? <CheckIcon size={12} color="#fff" /> : null}
              <Text
                style={option === value ? undefined : { color: c.text }}
                className={`text-sm ${option === value ? "font-semibold text-white" : "font-medium"}`}
              >
                {option}
              </Text>
            </Touchable>
          ))}
          <Touchable
            feel="chip"
            onPress={() => setEditing(false)}
            accessibilityRole="button"
            style={{ borderColor: c.border }}
            className="rounded-full border px-3 py-1.5"
          >
            <Text className="text-sm font-medium text-muted">Cancel</Text>
          </Touchable>
        </View>
      </View>
    );
  }

  if (editing) {
    return (
      <View
        style={{ borderBottomColor: last ? "transparent" : c.border }}
        className={`gap-1.5 px-4 py-3 ${last ? "" : "border-b"}`}
      >
        <Text className="text-sm font-medium text-muted">{field.label}</Text>
        <TextInput
          accessibilityLabel={field.label}
          autoFocus
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => write(draft)}
          onBlur={() => write(draft)}
          returnKeyType="done"
          placeholder={field.type === "date" ? "2026-04-20" : "—"}
          placeholderTextColor={c.textFaint}
          // Not a number pad for `number`: an order reference is a reference,
          // not a quantity — it can start with a zero and carry a letter.
          keyboardType={field.type === "number" ? "numbers-and-punctuation" : "default"}
          autoCapitalize={field.type === "url" ? "none" : "sentences"}
          autoCorrect={field.type !== "url"}
          style={{ color: c.text, borderColor: c.border, backgroundColor: c.surface }}
          className="rounded-12 border px-3.5 py-3 text-md"
        />
      </View>
    );
  }

  return (
    <Touchable
      feel="row"
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${field.label}: ${value || "not set"}`}
      style={{ borderBottomColor: last ? "transparent" : c.border }}
      className={`flex-row items-center gap-3 px-4 py-2.5 ${last ? "" : "border-b"}`}
    >
      <Text className="text-md text-muted">{field.label}</Text>
      <Text
        numberOfLines={1}
        style={value ? undefined : { color: c.textFaint }}
        className={`flex-1 text-right text-md ${value ? "font-medium text-fg" : ""}`}
      >
        {/* An empty field still gets its row: the gap is the information, and
            a tap away from being filled in. */}
        {value || "—"}
      </Text>
    </Touchable>
  );
}
