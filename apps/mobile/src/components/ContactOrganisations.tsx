import { useDeferredValue, useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import { api, useAccountMutation, useAccounts, useContactAccounts, type ApiError } from "@ding/client";
import { ChevronRight, EditIcon, PlusIcon, SearchIcon, XIcon } from "../icons";
import { haptics } from "../haptics";
import { useTheme } from "../theme";
import { Touchable } from "./Touchable";
import { useToast } from "./Toast";

/**
 * A customer's organisations, and the way to change them: add them to an
 * existing one, create a new one with them in it, or take them out.
 *
 * Inline, never a sheet of its own: this renders inside the details sheet,
 * which is a `Modal`, and a second modal on top of it doesn't present on iOS
 * (see `modal-slot.ts`). Expanding in place also keeps the customer in view.
 */
export function ContactOrganisations({
  contactId,
  onOpen,
  onDone,
}: {
  contactId: string;
  /** Tapping an organisation opens it, where there's somewhere to open it. */
  onOpen?: (accountId: string) => void;
  /** Shown as "Done" in the heading, for a caller that swapped this in. */
  onDone?: () => void;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const { data } = useContactAccounts(contactId);
  const [adding, setAdding] = useState(false);
  const unlink = useAccountMutation((accountId: string) => api.unlinkAccountContact(accountId, contactId));

  const remove = (accountId: string, name: string) =>
    Alert.alert(`Remove from ${name}?`, "The customer and their conversations stay as they are.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          unlink.mutate(accountId, {
            onSuccess: () => toast({ text: `Removed from ${name}` }),
            onError: (err) => toast({ text: err instanceof Error ? err.message : "Couldn't remove", tone: "error" }),
          }),
      },
    ]);

  const linked = data ?? [];
  return (
    <>
      <View className="flex-row items-center justify-between px-5 pb-1.5 pt-5">
        <Text style={{ color: c.textFaint }} className="text-2xs font-semibold uppercase tracking-wider">
          Organisations
        </Text>
        {onDone ? (
          <Touchable feel="chip" borderless onPress={onDone} accessibilityRole="button" hitSlop={10} className="py-0.5">
            <Text style={{ color: c.brand }} className="text-sm font-semibold">Done</Text>
          </Touchable>
        ) : null}
      </View>
      <View style={{ backgroundColor: c.surface2, borderColor: c.border }} className="mx-4 overflow-hidden rounded-16 border">
        {linked.map((l, i) => (
          <View
            key={l.account.id}
            style={{ borderTopColor: c.border }}
            className={`flex-row items-center gap-2 py-1 pl-4 pr-2 ${i ? "border-t" : ""}`}
          >
            <Touchable
              feel="row"
              disabled={!onOpen}
              onPress={() => onOpen?.(l.account.id)}
              accessibilityRole={onOpen ? "button" : undefined}
              accessibilityLabel={l.account.name}
              className="flex-1 flex-row items-center gap-2 py-1.5"
            >
              <View className="flex-1">
                <Text numberOfLines={1} className="text-md font-semibold text-fg">{l.account.name}</Text>
                <Text numberOfLines={1} className="text-2xs text-muted">
                  {[l.link.role, l.link.isPrimary ? "Primary" : null, l.account.archivedAt ? "Archived" : null]
                    .filter(Boolean)
                    .join(" · ") || "No role set"}
                </Text>
              </View>
              {onOpen ? <ChevronRight size={14} color={c.textFaint} /> : null}
            </Touchable>
            <Touchable
              feel="chip"
              borderless
              onPress={() => remove(l.account.id, l.account.name)}
              disabled={unlink.isPending}
              accessibilityRole="button"
              accessibilityLabel={`Remove from ${l.account.name}`}
              hitSlop={8}
              className="h-8 w-8 items-center justify-center"
            >
              <XIcon size={15} color={c.textMuted} />
            </Touchable>
          </View>
        ))}
        {data && !linked.length && !adding ? (
          <Text className="px-4 pt-3 text-md text-muted">Not in an organisation yet.</Text>
        ) : null}
        {adding ? (
          <OrganisationLinker contactId={contactId} exclude={linked.map((l) => l.account.id)} onClose={() => setAdding(false)} />
        ) : (
          <Touchable
            feel="row"
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            style={linked.length ? { borderTopColor: c.border } : undefined}
            className={`flex-row items-center gap-2 px-4 py-3 ${linked.length ? "border-t" : ""}`}
          >
            <PlusIcon size={15} color={c.brand} />
            <Text style={{ color: c.brand }} className="text-md font-semibold">
              {linked.length ? "Add to another organisation" : "Add to an organisation"}
            </Text>
          </Touchable>
        )}
      </View>
    </>
  );
}

/**
 * Search the organisations, tap one to put the customer in it, or create a new
 * one under the name you typed. A name that already exists (ignoring "Ltd",
 * case and punctuation) is caught by the server and offered back to link
 * instead, so the same company doesn't get made twice from two phones.
 */
export function OrganisationLinker({
  contactId,
  exclude = [],
  onClose,
}: {
  contactId: string;
  exclude?: string[];
  onClose: () => void;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const { data, isLoading } = useAccounts(q ? { search: q } : {});
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);
  const skip = new Set(exclude);
  const matches = (data ?? []).filter((a) => !skip.has(a.id)).slice(0, 8);
  const exact = matches.some((a) => a.name.toLowerCase() === query.trim().toLowerCase());

  const link = useAccountMutation((accountId: string) => api.linkAccountContact(accountId, { contactId }));
  const create = useAccountMutation((name: string) => api.createAccount({ name, contactId }));
  const busy = link.isPending || create.isPending;

  const join = (id: string, name: string) =>
    link.mutate(id, {
      onSuccess: () => {
        haptics.success();
        toast({ text: `Added to ${name}` });
        onClose();
      },
      onError: (err) => toast({ text: err instanceof Error ? err.message : "Couldn't add", tone: "error" }),
    });

  const make = () =>
    create.mutate(query.trim(), {
      onSuccess: (a) => {
        haptics.success();
        toast({ text: `${a.name} created` });
        onClose();
      },
      onError: (err) => {
        const e = err as ApiError;
        const found = (e.body as { details?: { existing?: { id: string; name: string; archived: boolean } } } | undefined)
          ?.details?.existing;
        if (e.status === 409 && found && !found.archived) setExisting(found);
        else toast({ text: e.message || "Couldn't create it", tone: "error" });
      },
    });

  return (
    <View style={{ borderTopColor: c.border }} className="border-t pb-1 pt-3">
      <View className="mx-3 mb-1 flex-row items-center gap-2">
        <View style={{ backgroundColor: c.surface, borderColor: c.border }} className="flex-1 flex-row items-center gap-2 rounded-12 border px-3">
          <SearchIcon size={15} color={c.textFaint} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              setExisting(null);
            }}
            placeholder="Organisation name"
            placeholderTextColor={c.textFaint}
            accessibilityLabel="Search organisations"
            autoCorrect={false}
            returnKeyType="done"
            style={{ color: c.text }}
            className="flex-1 py-2.5 text-md"
          />
        </View>
        <Touchable feel="chip" onPress={onClose} accessibilityRole="button" className="px-2 py-2">
          <Text className="text-md font-medium text-muted">Cancel</Text>
        </Touchable>
      </View>

      {existing ? (
        <View style={{ backgroundColor: c.amberTint }} className="mx-3 my-1.5 gap-2 rounded-12 px-3 py-2.5">
          <Text className="text-md text-fg">{existing.name} already exists.</Text>
          <Touchable
            feel="slab"
            onPress={() => join(existing.id, existing.name)}
            disabled={busy}
            accessibilityRole="button"
            style={{ backgroundColor: c.brand }}
            className="self-start rounded-12 px-3.5 py-2"
          >
            <Text className="text-md font-semibold text-white">Add to {existing.name}</Text>
          </Touchable>
        </View>
      ) : null}

      {matches.map((a) => (
        <Touchable
          feel="row"
          key={a.id}
          onPress={() => join(a.id, a.name)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Add to ${a.name}`}
          className="flex-row items-center gap-2 px-4 py-2.5"
        >
          <View className="flex-1">
            <Text numberOfLines={1} className="text-md font-medium text-fg">{a.name}</Text>
            <Text numberOfLines={1} className="text-2xs text-muted">
              {[a.reference, a.summary, `${a.contactCount} ${a.contactCount === 1 ? "person" : "people"}`].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <PlusIcon size={15} color={c.textFaint} />
        </Touchable>
      ))}
      {!isLoading && q && !matches.length ? <Text className="px-4 py-1.5 text-2xs text-muted">No organisation by that name.</Text> : null}

      {query.trim() && !exact ? (
        <Touchable
          feel="row"
          onPress={make}
          disabled={busy}
          accessibilityRole="button"
          className="flex-row items-center gap-2 px-4 py-2.5"
        >
          <EditIcon size={14} color={c.brand} />
          <Text numberOfLines={1} style={{ color: c.brand }} className="flex-1 text-md font-semibold">
            Create “{query.trim()}”
          </Text>
        </Touchable>
      ) : null}
    </View>
  );
}
