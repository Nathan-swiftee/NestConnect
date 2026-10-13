import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api, seenAt, useChatMutation, useMe, usePeople } from "@ding/client";
import { CHAT_GROUP_NAME_MAX, canEditChatMessage, type ChatMessage } from "@ding/schemas";
import { mediaSource } from "../../api-config";
import { haptics } from "../../haptics";
import { BackIcon, CheckDouble, CheckIcon, EditIcon, PlusIcon, ReplyIcon, SearchIcon, TrashIcon, XIcon } from "../../icons";
import { useTheme } from "../../theme";
import { Avatar } from "../Avatar";
import { Sheet } from "../Sheet";
import { useToast } from "../Toast";
import { Touchable } from "../Touchable";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
export const GROUP_EMOJIS = ["💬", "🚚", "📦", "🛠️", "📞", "💼", "🎯", "⭐", "🔥", "☕", "🏢", "🧾"];

function SheetHeader({ title, onClose, onBack }: { title: string; onClose: () => void; onBack?: () => void }) {
  const { c } = useTheme();
  return (
    <View className="flex-row items-center gap-2 px-4 pb-2 pt-4">
      {onBack ? (
        <Touchable feel="chip" borderless onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
          <BackIcon size={22} color={c.brand} />
        </Touchable>
      ) : null}
      <Text accessibilityRole="header" className="flex-1 text-xl font-semibold text-fg">
        {title}
      </Text>
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
  );
}

/** Start a chat: tap a person, or (managers and admins) set up a group. */
export function NewChatSheet({
  visible,
  canCreateGroups,
  onClose,
  onOpened,
}: {
  visible: boolean;
  canCreateGroups: boolean;
  onClose: () => void;
  onOpened: (roomId: string) => void;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const me = useMe().data?.user;
  const people = usePeople();
  const [step, setStep] = useState<"pick" | "group">("pick");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const direct = useChatMutation((userId: string) => api.openDirectChat(userId));
  const group = useChatMutation(() => api.createChatGroup({ name: name.trim(), emoji, memberIds: [...chosen] }));

  const others = useMemo(
    () =>
      (people.data ?? [])
        .map((m) => m.user)
        .filter((u) => u.id !== me?.id && (!q.trim() || u.name.toLowerCase().includes(q.trim().toLowerCase())))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [people.data, me?.id, q],
  );
  const reset = () => {
    setStep("pick");
    setQ("");
    setName("");
    setEmoji(null);
    setChosen(new Set());
  };
  const close = () => {
    reset();
    onClose();
  };
  const fail = (e: unknown) => toast({ text: (e as Error).message || "Couldn't do that" });

  return (
    <Sheet visible={visible} onClose={close} padded={false}>
      <SheetHeader title={step === "group" ? "New group" : "New chat"} onClose={close} onBack={step === "group" ? () => setStep("pick") : undefined} />
      {step === "group" ? (
        // Shrinkable like everything between a sheet and its scroller — see Sheet.tsx.
        <View style={{ flexShrink: 1 }} className="gap-3 px-4 pb-2">
          <View className="flex-row items-center gap-3">
            <View style={{ backgroundColor: c.surface2 }} className="h-14 w-14 items-center justify-center rounded-full">
              <Text style={{ fontSize: 26 }}>{emoji ?? "💬"}</Text>
            </View>
            <TextInput
              value={name}
              onChangeText={setName}
              maxLength={CHAT_GROUP_NAME_MAX}
              placeholder="Group name, e.g. Dispatch London"
              placeholderTextColor={c.textFaint}
              accessibilityLabel="Group name"
              autoFocus
              style={{ color: c.text, borderBottomColor: c.wa }}
              className="flex-1 border-b-2 py-2 text-lg"
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {GROUP_EMOJIS.map((e) => (
              <Touchable
                key={e}
                feel="chip"
                onPress={() => setEmoji(emoji === e ? null : e)}
                accessibilityRole="radio"
                accessibilityState={{ selected: emoji === e }}
                accessibilityLabel={`Icon ${e}`}
                style={{ backgroundColor: emoji === e ? c.brandTint : c.surface2, borderColor: emoji === e ? c.brand : "transparent" }}
                className="h-10 w-10 items-center justify-center rounded-12 border"
              >
                <Text style={{ fontSize: 20 }}>{e}</Text>
              </Touchable>
            ))}
          </ScrollView>
          <Text className="text-2xs text-muted">
            {chosen.size ? `${chosen.size} ${chosen.size === 1 ? "person" : "people"} added — you'll be the group's admin.` : "Add people below. You'll be the group's admin."}
          </Text>
        </View>
      ) : null}
      <View className="px-4 pb-2">
        <View style={{ backgroundColor: c.surface2 }} className="flex-row items-center gap-2 rounded-full px-3.5">
          <SearchIcon size={16} color={c.textFaint} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search people"
            placeholderTextColor={c.textFaint}
            autoCorrect={false}
            accessibilityLabel="Search people"
            style={{ color: c.text }}
            className="flex-1 py-2 text-md"
          />
        </View>
      </View>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        {step === "pick" && canCreateGroups ? (
          <Touchable feel="row" onPress={() => setStep("group")} accessibilityRole="button" className="flex-row items-center gap-3 px-4 py-2.5">
            <View style={{ backgroundColor: c.wa }} className="h-11 w-11 items-center justify-center rounded-full">
              <PlusIcon size={20} color="#fff" />
            </View>
            <Text style={{ color: c.wa }} className="text-lg font-semibold">
              New group
            </Text>
          </Touchable>
        ) : null}
        {others.map((u) => {
          const on = chosen.has(u.id);
          return (
            <Touchable
              key={u.id}
              feel="row"
              disabled={direct.isPending}
              onPress={() => {
                if (step === "group") {
                  haptics.select();
                  setChosen((cur) => {
                    const next = new Set(cur);
                    if (next.has(u.id)) next.delete(u.id);
                    else next.add(u.id);
                    return next;
                  });
                } else {
                  direct.mutate(u.id, { onSuccess: (room) => { reset(); onOpened(room.id); }, onError: fail });
                }
              }}
              accessibilityRole={step === "group" ? "checkbox" : "button"}
              accessibilityState={step === "group" ? { checked: on } : undefined}
              accessibilityLabel={u.name}
              style={{ backgroundColor: on ? c.sel : "transparent" }}
              className="flex-row items-center gap-3 px-4 py-2"
            >
              <Avatar name={u.name} color={u.avatarColor} size={44} photo={u.avatarUrl ? mediaSource(u.avatarUrl) : null} />
              <View className="flex-1">
                <Text className="text-lg font-semibold text-fg">{u.name}</Text>
                <Text className="text-sm text-muted">{u.position || u.role.charAt(0).toUpperCase() + u.role.slice(1)}</Text>
              </View>
              {step === "group" ? (
                <View
                  style={{ backgroundColor: on ? c.wa : "transparent", borderColor: on ? c.wa : c.borderStrong }}
                  className="h-6 w-6 items-center justify-center rounded-full border-2"
                >
                  {on ? <CheckIcon size={13} color="#fff" /> : null}
                </View>
              ) : null}
            </Touchable>
          );
        })}
      </ScrollView>
      {step === "group" ? (
        <View style={{ borderTopColor: c.border }} className="border-t px-4 pb-4 pt-3">
          <Touchable
            feel="slab"
            disabled={!name.trim() || group.isPending}
            onPress={() =>
              group.mutate(undefined, {
                onSuccess: (room) => {
                  haptics.success();
                  reset();
                  onOpened(room.id);
                },
                onError: fail,
              })
            }
            accessibilityRole="button"
            style={{ backgroundColor: c.wa, opacity: !name.trim() || group.isPending ? 0.5 : 1 }}
            className="items-center rounded-full py-3"
          >
            <Text className="text-lg font-semibold text-white">Create group</Text>
          </Touchable>
        </View>
      ) : null}
    </Sheet>
  );
}

/**
 * Long-press on a message: a row of reactions, then what you can do with it —
 * reply, edit (your own, for 15 minutes), who's read it (your own), delete.
 */
export function ChatMessageSheet({
  message,
  meId,
  mine,
  canAct,
  canDelete,
  onClose,
  onReact,
  onReply,
  onEdit,
  onInfo,
  onDelete,
}: {
  message: ChatMessage | null;
  meId: string | undefined;
  mine: boolean;
  canAct: boolean;
  canDelete: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onInfo: () => void;
  onDelete: () => void;
}) {
  const { c } = useTheme();
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const rows: Array<{ key: string; label: string; icon: React.ReactNode; onPress: () => void; danger?: boolean }> = message
    ? [
        ...(canAct ? [{ key: "reply", label: "Reply", icon: <ReplyIcon size={20} color={c.textMuted} />, onPress: act(onReply) }] : []),
        ...(mine && canEditChatMessage(message)
          ? [{ key: "edit", label: "Edit", icon: <EditIcon size={20} color={c.textMuted} />, onPress: act(onEdit) }]
          : []),
        ...(mine ? [{ key: "info", label: "Info", icon: <CheckDouble size={18} color={c.textMuted} />, onPress: act(onInfo) }] : []),
        ...(canDelete
          ? [{ key: "delete", label: "Delete for everyone", icon: <TrashIcon size={20} color={c.danger} />, onPress: act(onDelete), danger: true }]
          : []),
      ]
    : [];
  return (
    <Sheet visible={!!message} onClose={onClose}>
      {canAct ? (
        <View style={{ backgroundColor: c.surface2 }} className="mb-3 flex-row justify-between rounded-full px-2 py-1.5">
          {QUICK_REACTIONS.map((e) => {
            const mineAlready = !!meId && !!message?.reactions.some((r) => r.emoji === e && r.userIds.includes(meId));
            return (
              <Touchable
                key={e}
                feel="chip"
                borderless
                onPress={() => {
                  haptics.select();
                  onClose();
                  onReact(e);
                }}
                accessibilityRole="button"
                accessibilityLabel={`React ${e}`}
                className="h-11 w-11 items-center justify-center rounded-full"
                style={{ backgroundColor: mineAlready ? c.brandTint : "transparent" }}
              >
                <Text style={{ fontSize: 26 }}>{e}</Text>
              </Touchable>
            );
          })}
        </View>
      ) : null}
      {rows.map((r) => (
        <Touchable key={r.key} feel="row" onPress={r.onPress} accessibilityRole="button" className="flex-row items-center gap-4 py-3">
          {r.icon}
          <Text style={{ color: r.danger ? c.danger : c.text }} className="text-lg">
            {r.label}
          </Text>
        </Touchable>
      ))}
    </Sheet>
  );
}

/** Who has read one of my messages, who only has it, and who hasn't yet. */
export function ChatInfoSheet({ message, onClose }: { message: ChatMessage | null; onClose: () => void }) {
  const { c } = useTheme();
  const info = useQuery({
    queryKey: ["chat", "info", message?.id],
    queryFn: () => api.chatMessageInfo(message!.id),
    enabled: !!message,
    staleTime: 0,
  });
  const Section = ({ title, rows, read }: { title: string; rows: Array<{ id: string; name: string; avatarColor: string | null; avatarUrl: string | null; at?: string }>; read?: boolean }) =>
    rows.length ? (
      <View className="mt-3">
        <View className="mb-1 flex-row items-center gap-1.5">
          {title !== "Not delivered yet" ? <CheckDouble size={14} color={read ? c.email : c.textFaint} /> : null}
          <Text className="text-2xs font-semibold uppercase tracking-wide text-faint">{title}</Text>
        </View>
        {rows.map((p) => (
          <View key={p.id} className="flex-row items-center gap-3 py-1.5">
            <Avatar name={p.name} color={p.avatarColor} size={34} photo={p.avatarUrl ? mediaSource(p.avatarUrl) : null} />
            <Text className="flex-1 text-md font-medium text-fg">{p.name}</Text>
            {p.at ? <Text className="text-2xs text-faint">{seenAt(p.at)}</Text> : null}
          </View>
        ))}
      </View>
    ) : null;
  return (
    <Sheet visible={!!message} onClose={onClose} padded={false}>
      <SheetHeader title="Message info" onClose={onClose} />
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
        <View style={{ backgroundColor: c.brandTint }} className="self-end rounded-12 px-3 py-2">
          <Text className="text-md text-fg">{message?.body}</Text>
        </View>
        {info.data ? (
          <>
            <Section title="Read by" rows={info.data.readBy.map((r) => ({ ...r.person, at: r.at }))} read />
            <Section title="Delivered to" rows={info.data.deliveredTo.map((r) => ({ ...r.person, at: r.at }))} />
            <Section title="Not delivered yet" rows={info.data.waiting} />
          </>
        ) : (
          <Text className="py-6 text-center text-md text-muted">{info.isError ? "Couldn't load this." : "Loading…"}</Text>
        )}
      </ScrollView>
    </Sheet>
  );
}
