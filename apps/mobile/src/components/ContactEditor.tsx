import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useUpdateContact } from "@ding/client";
import type { Contact } from "@ding/schemas";
import { contactPatch } from "../contact";
import { useTheme } from "../theme";
import { haptics } from "../haptics";
import { EditIcon } from "../icons";
import { Touchable } from "./Touchable";
import { useToast } from "./Toast";

/**
 * The customer's own details — name, company, phone, email — and a way to fix
 * them.
 *
 * Until now the phone could only read these. The directory said so out loud:
 * "Reading, not editing … forms belong on the web". That holds for *creating* a
 * customer, which is a form with duplicate-checking behind it, but not for
 * correcting one. A name arrives from WhatsApp as whatever the customer set as
 * their profile name, an email address arrives as whatever was in the From
 * header, and the moment you notice either is wrong is the moment you're
 * reading the thread — which on this app is usually on a phone.
 *
 * Inline rather than a sheet of its own, and that is not a style choice: this
 * renders inside the details sheet, which is a `Modal`, and a `Modal` inside a
 * `Modal` is unreliable on Android. Expanding in place also keeps the customer's
 * name visible above the field you're editing.
 *
 * Explicit Save, unlike the tags and routing above it, which write on every tap.
 * Those are single reversible choices; this is four free-text fields where a
 * half-typed number is worse than the old one, and where "cancel" has to mean
 * something.
 */
export function ContactEditor({ contact }: { contact: Contact }) {
  const { c } = useTheme();
  const toast = useToast();
  const update = useUpdateContact();

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(contact.displayName);
  const [company, setCompany] = useState(contact.company ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [error, setError] = useState<string | null>(null);

  /** Start from what the server currently holds, not from whatever was left in
   *  state after a previous cancel. */
  const open = () => {
    setDisplayName(contact.displayName);
    setCompany(contact.company ?? "");
    setPhone(contact.phone ?? "");
    setEmail(contact.email ?? "");
    setError(null);
    setEditing(true);
  };

  async function save() {
    const name = displayName.trim();
    if (!name) {
      setError("A customer needs a name.");
      return;
    }
    const patch = contactPatch(contact, { displayName: name, company, phone, email });

    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    try {
      await update.mutateAsync({ id: contact.id, input: patch });
      haptics.success();
      toast({ text: "Customer updated" });
      setEditing(false);
      setError(null);
    } catch (err) {
      haptics.error();
      setError(err instanceof Error ? err.message : "Couldn't save. Please try again.");
    }
  }

  return (
    <>
      <View className="flex-row items-center justify-between px-5 pb-1.5 pt-5">
        <Text
          style={{ color: c.textFaint }}
          className="text-2xs font-semibold uppercase tracking-wider"
        >
          Customer details
        </Text>
        {editing ? null : (
          <Touchable
            feel="chip"
            borderless
            onPress={open}
            accessibilityRole="button"
            accessibilityLabel="Edit customer details"
            hitSlop={10}
            className="flex-row items-center gap-1.5 py-0.5"
          >
            <EditIcon size={13} color={c.brand} />
            <Text style={{ color: c.brand }} className="text-sm font-semibold">
              Edit
            </Text>
          </Touchable>
        )}
      </View>

      <View
        style={{ backgroundColor: c.surface2, borderColor: c.border }}
        className="mx-4 rounded-16 border"
      >
        {editing ? (
          <View className="gap-3 p-4">
            <Input label="Name" value={displayName} onChangeText={setDisplayName} autoFocus />
            <Input
              label="Company"
              value={company}
              onChangeText={setCompany}
              placeholder="Venue · Bristol"
            />
            <Input
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              placeholder="+44 117 496 0122"
              keyboardType="phone-pad"
            />
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="ops@example.co.uk"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {error ? (
              <Text accessibilityLiveRegion="polite" className="text-sm text-danger">
                {error}
              </Text>
            ) : null}

            <View className="flex-row justify-end gap-2 pt-1">
              <Touchable
                feel="chip"
                onPress={() => {
                  setEditing(false);
                  setError(null);
                }}
                disabled={update.isPending}
                accessibilityRole="button"
                className="rounded-12 px-4 py-2.5"
              >
                <Text className="text-md font-medium text-muted">Cancel</Text>
              </Touchable>
              <Touchable
                feel="slab"
                onPress={save}
                disabled={update.isPending}
                accessibilityRole="button"
                accessibilityState={{ busy: update.isPending }}
                style={{ backgroundColor: c.brand, opacity: update.isPending ? 0.6 : 1 }}
                className="rounded-12 px-4 py-2.5"
              >
                <Text className="text-md font-semibold text-white">
                  {update.isPending ? "Saving…" : "Save"}
                </Text>
              </Touchable>
            </View>
          </View>
        ) : (
          <>
            {/* The name isn't repeated here — it's the heading directly above
                this, at four times the size. It appears in the form, because
                that is where it needs to be fixable. */}
            <Row label="Company" value={contact.company} />
            <Row label="Phone" value={contact.phone} />
            <Row label="Email" value={contact.email} last />
          </>
        )}
      </View>
    </>
  );
}

/** One labelled input in the edit form. */
function Input({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { c } = useTheme();
  return (
    <View className="gap-1.5">
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        className="text-sm font-medium text-muted"
      >
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.textFaint}
        style={{ color: c.text, borderColor: c.border, backgroundColor: c.surface }}
        className="rounded-12 border px-3.5 py-3 text-md"
        {...props}
      />
    </View>
  );
}

/** One read-only detail. Empty fields still get a row, so the gap is visible
 *  and Edit has something obvious to fill in. */
function Row({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={{ borderBottomColor: last ? "transparent" : c.border }}
      className={`flex-row items-center gap-3 px-4 py-2.5 ${last ? "" : "border-b"}`}
    >
      <Text className="text-md text-muted">{label}</Text>
      <Text
        numberOfLines={1}
        style={value ? undefined : { color: c.textFaint }}
        className={`flex-1 text-right text-md ${value ? "font-medium text-fg" : ""}`}
      >
        {value || "—"}
      </Text>
    </View>
  );
}
