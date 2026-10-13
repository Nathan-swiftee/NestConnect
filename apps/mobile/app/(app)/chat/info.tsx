import { useMemo, useState } from "react";
import { Alert, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, chatLastSeen, seenAt, useChatMutation, useChatRoom, useMe, usePeople } from "@ding/client";
import { CHAT_GROUP_NAME_MAX, type ChatMember } from "@ding/schemas";
import { ActionSheet, type SheetAction } from "../../../src/components/ActionSheet";
import { Avatar } from "../../../src/components/Avatar";
import { ChatAvatar } from "../../../src/components/chat/ChatAvatar";
import { GROUP_EMOJIS } from "../../../src/components/chat/ChatSheets";
import { Sheet } from "../../../src/components/Sheet";
import { Loading } from "../../../src/components/States";
import { useToast } from "../../../src/components/Toast";
import { Touchable } from "../../../src/components/Touchable";
import { mediaSource } from "../../../src/api-config";
import { BackIcon, CheckIcon, EditIcon, LogoutIcon, PlusIcon } from "../../../src/icons";
import { useInsets } from "../../../src/insets";
import { useTheme } from "../../../src/theme";

/**
 * Who's in a chat and what it's called — and my own mute and pin. Group admins
 * (and workspace admins) rename it, change its icon, add and remove people and
 * make other admins. A team chat's members are the team's.
 */
export default function ChatInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const insets = useInsets();
  const toast = useToast();
  const me = useMe().data?.user;
  const room = useChatRoom(id);
  const people = usePeople();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<ChatMember | null>(null);
  const fail = (e: unknown) => toast({ text: (e as Error).message || "Couldn't do that" });

  const update = useChatMutation((input: { name?: string; emoji?: string | null }) => api.updateChatGroup(id, input));
  const prefs = useChatMutation((input: { muted?: boolean; pinned?: boolean }) => api.setChatRoomPrefs(id, input));
  const add = useChatMutation((ids: string[]) => api.addChatMembers(id, ids));
  const remove = useChatMutation((userId: string) => api.removeChatMember(id, userId));
  const role = useChatMutation(({ userId, r }: { userId: string; r: "admin" | "member" }) => api.setChatMemberRole(id, userId, r));
  const leave = useChatMutation(() => api.leaveChatRoom(id));
  const direct = useChatMutation((userId: string) => api.openDirectChat(userId));
  const audits = useQuery({
    queryKey: ["chat", "audits", id],
    queryFn: () => api.chatAudits(id),
    enabled: me?.role === "admin" && room.data?.kind !== "team" && !!room.data,
  });

  const r = room.data;
  const notIn = useMemo(() => {
    const ids = new Set((r?.members ?? []).map((m) => m.id));
    return (people.data ?? []).map((m) => m.user).filter((u) => !ids.has(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [people.data, r?.members]);

  if (!r) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }} className="items-center justify-center">
        <Loading />
      </View>
    );
  }

  const kindLine =
    r.kind === "direct"
      ? chatLastSeen(r.other) || "Direct chat"
      : `${r.kind === "team" ? "Team chat" : "Group"} · ${r.memberCount} member${r.memberCount === 1 ? "" : "s"}`;
  const memberActions: SheetAction[] = acting
    ? [
        {
          key: "message",
          label: `Message ${acting.name.split(" ")[0]}`,
          onPress: () => direct.mutate(acting.id, { onSuccess: (x) => router.replace({ pathname: "/(app)/chat/[id]", params: { id: x.id } }), onError: fail }),
        },
        ...(r.canManage && r.kind === "group"
          ? [
              {
                key: "role",
                label: acting.role === "admin" ? "Remove as group admin" : "Make group admin",
                onPress: () => role.mutate({ userId: acting.id, r: acting.role === "admin" ? "member" : "admin" }, { onError: fail }),
              },
              {
                key: "remove",
                label: "Remove from group",
                destructive: true,
                onPress: () => remove.mutate(acting.id, { onError: fail }),
              },
            ]
          : []),
      ]
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top, backgroundColor: c.surface, borderBottomColor: c.border }} className="flex-row items-center gap-2 border-b px-2 pb-2 pt-2">
        <Touchable feel="chip" onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} className="px-1">
          <BackIcon size={24} color={c.brand} />
        </Touchable>
        <Text accessibilityRole="header" className="text-lg font-semibold text-fg">
          {r.kind === "direct" ? "Contact info" : r.kind === "team" ? "Team chat info" : "Group info"}
        </Text>
      </View>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <View style={{ backgroundColor: c.surface }} className="items-center gap-1 px-6 pb-5 pt-6">
          <ChatAvatar room={r} size={96} />
          {renaming ? (
            <View className="mt-3 flex-row items-center gap-2">
              <TextInput
                value={name}
                onChangeText={setName}
                maxLength={CHAT_GROUP_NAME_MAX}
                autoFocus
                accessibilityLabel="Group name"
                style={{ color: c.text, borderBottomColor: c.wa, minWidth: 200 }}
                className="border-b-2 py-1 text-center text-xl font-semibold"
              />
              <Touchable
                feel="chip"
                borderless
                disabled={!name.trim()}
                onPress={() => update.mutate({ name: name.trim() }, { onSuccess: () => setRenaming(false), onError: fail })}
                accessibilityRole="button"
                accessibilityLabel="Save name"
                className="h-9 w-9 items-center justify-center"
              >
                <CheckIcon size={20} color={c.wa} />
              </Touchable>
            </View>
          ) : (
            <View className="mt-3 flex-row items-center gap-1">
              <Text className="text-center text-2xl font-semibold text-fg">{r.name}</Text>
              {r.canManage ? (
                <Touchable feel="chip" borderless onPress={() => { setName(r.name); setRenaming(true); }} accessibilityRole="button" accessibilityLabel="Rename group" hitSlop={8} className="h-8 w-8 items-center justify-center">
                  <EditIcon size={16} color={c.textMuted} />
                </Touchable>
              ) : null}
            </View>
          )}
          <Text className="text-md text-muted">{kindLine}</Text>
          {r.canManage ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 10 }}>
              {GROUP_EMOJIS.map((e) => (
                <Touchable
                  key={e}
                  feel="chip"
                  onPress={() => update.mutate({ emoji: r.emoji === e ? null : e }, { onError: fail })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: r.emoji === e }}
                  accessibilityLabel={`Icon ${e}`}
                  style={{ backgroundColor: r.emoji === e ? c.brandTint : c.surface2, borderColor: r.emoji === e ? c.brand : "transparent" }}
                  className="h-9 w-9 items-center justify-center rounded-12 border"
                >
                  <Text style={{ fontSize: 18 }}>{e}</Text>
                </Touchable>
              ))}
            </ScrollView>
          ) : null}
        </View>

        {r.isMember ? (
          <View style={{ backgroundColor: c.surface }} className="mt-2 px-4">
            <SwitchRow label="Mute notifications" hint="No push — an @mention still gets through." on={r.muted} onChange={(v) => prefs.mutate({ muted: v }, { onError: fail })} />
            <SwitchRow label="Pin chat" hint="Keep it at the top of your list." on={r.pinned} onChange={(v) => prefs.mutate({ pinned: v }, { onError: fail })} last />
          </View>
        ) : null}

        {r.kind !== "direct" ? (
          <View style={{ backgroundColor: c.surface }} className="mt-2 pb-1 pt-3">
            <Text className="px-4 pb-1 text-sm font-semibold text-muted">
              {r.memberCount} member{r.memberCount === 1 ? "" : "s"}
            </Text>
            {r.kind === "team" ? (
              <Text className="px-4 pb-2 text-2xs text-faint">Everyone on the team is in its chat. Change who's on it in Settings › Teams on the web.</Text>
            ) : null}
            {r.canManage ? (
              <Touchable feel="row" onPress={() => setAdding(true)} accessibilityRole="button" className="flex-row items-center gap-3 px-4 py-2.5">
                <View style={{ backgroundColor: c.wa }} className="h-10 w-10 items-center justify-center rounded-full">
                  <PlusIcon size={18} color="#fff" />
                </View>
                <Text style={{ color: c.wa }} className="text-lg font-semibold">
                  Add people
                </Text>
              </Touchable>
            ) : null}
            {r.members.map((m) => (
              <Touchable
                key={m.id}
                feel="row"
                disabled={m.id === me?.id}
                onPress={() => setActing(m)}
                accessibilityRole="button"
                accessibilityLabel={m.id === me?.id ? "You" : m.name}
                className="flex-row items-center gap-3 px-4 py-2"
              >
                <View>
                  <Avatar name={m.name} color={m.avatarColor} size={42} photo={m.avatarUrl ? mediaSource(m.avatarUrl) : null} />
                  {m.online ? (
                    <View style={{ position: "absolute", right: 0, bottom: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: "#25D366", borderWidth: 2, borderColor: c.surface }} />
                  ) : null}
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-medium text-fg">{m.id === me?.id ? "You" : m.name}</Text>
                  {chatLastSeen(m) ? <Text className="text-sm text-muted">{chatLastSeen(m)}</Text> : null}
                </View>
                {r.kind === "group" && m.role === "admin" ? (
                  <Text style={{ color: c.wa, backgroundColor: c.brandTint }} className="overflow-hidden rounded-full px-2 py-0.5 text-2xs font-bold">
                    Group admin
                  </Text>
                ) : null}
              </Touchable>
            ))}
          </View>
        ) : null}

        {me?.role === "admin" && audits.data && audits.data.length ? (
          <View style={{ backgroundColor: c.surface }} className="mt-2 px-4 py-3">
            <Text className="pb-1 text-sm font-semibold text-muted">Read by admins</Text>
            {audits.data.slice(0, 10).map((a, i) => (
              <View key={i} className="flex-row items-center gap-3 py-1.5">
                <Avatar name={a.person.name} color={a.person.avatarColor} size={28} />
                <Text className="flex-1 text-md text-fg">{a.person.name}</Text>
                <Text className="text-2xs text-faint">{seenAt(a.at)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {r.canLeave ? (
          <View style={{ backgroundColor: c.surface }} className="mt-2">
            <Touchable
              feel="row"
              onPress={() =>
                Alert.alert(`Leave “${r.name}”?`, "One of its admins can add you back.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Leave",
                    style: "destructive",
                    onPress: () =>
                      leave.mutate(undefined, {
                        onSuccess: () => {
                          toast({ text: `You left “${r.name}”` });
                          router.dismissTo("/(app)/(tabs)/chat");
                        },
                        onError: fail,
                      }),
                  },
                ])
              }
              accessibilityRole="button"
              className="flex-row items-center gap-3 px-4 py-3.5"
            >
              <LogoutIcon size={20} color={c.danger} />
              <Text style={{ color: c.danger }} className="text-lg font-semibold">
                Leave group
              </Text>
            </Touchable>
          </View>
        ) : null}

        <Text style={{ color: c.textFaint }} className="px-6 pt-5 text-center text-2xs">
          Admins in your workspace can read team chats.
        </Text>
      </ScrollView>

      <ActionSheet visible={!!acting} title={acting?.name ?? ""} actions={memberActions} onClose={() => setActing(null)} />
      <Sheet visible={adding} onClose={() => setAdding(false)} padded={false}>
        <View className="flex-row items-center px-4 pb-2 pt-4">
          <Text accessibilityRole="header" className="flex-1 text-xl font-semibold text-fg">
            Add people
          </Text>
          <Touchable
            feel="chip"
            disabled={!toAdd.size || add.isPending}
            onPress={() =>
              add.mutate([...toAdd], {
                onSuccess: () => {
                  setAdding(false);
                  setToAdd(new Set());
                },
                onError: fail,
              })
            }
            accessibilityRole="button"
            style={{ backgroundColor: c.wa, opacity: toAdd.size ? 1 : 0.5 }}
            className="rounded-full px-4 py-1.5"
          >
            <Text className="text-md font-semibold text-white">Add{toAdd.size ? ` ${toAdd.size}` : ""}</Text>
          </Touchable>
        </View>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {notIn.length ? (
            notIn.map((u) => {
              const on = toAdd.has(u.id);
              return (
                <Touchable
                  key={u.id}
                  feel="row"
                  onPress={() =>
                    setToAdd((cur) => {
                      const next = new Set(cur);
                      if (next.has(u.id)) next.delete(u.id);
                      else next.add(u.id);
                      return next;
                    })
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={u.name}
                  className="flex-row items-center gap-3 px-4 py-2"
                >
                  <Avatar name={u.name} color={u.avatarColor} size={40} photo={u.avatarUrl ? mediaSource(u.avatarUrl) : null} />
                  <Text className="flex-1 text-lg text-fg">{u.name}</Text>
                  <View style={{ backgroundColor: on ? c.wa : "transparent", borderColor: on ? c.wa : c.borderStrong }} className="h-6 w-6 items-center justify-center rounded-full border-2">
                    {on ? <CheckIcon size={13} color="#fff" /> : null}
                  </View>
                </Touchable>
              );
            })
          ) : (
            <Text className="px-4 py-6 text-center text-md text-muted">Everyone's already in it.</Text>
          )}
        </ScrollView>
      </Sheet>
    </View>
  );
}

function SwitchRow({ label, hint, on, onChange, last }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ borderBottomColor: last ? "transparent" : c.border }} className={`flex-row items-center gap-3 py-3 ${last ? "" : "border-b"}`}>
      <View className="flex-1">
        <Text className="text-lg font-medium text-fg">{label}</Text>
        <Text className="text-sm text-muted">{hint}</Text>
      </View>
      <Switch value={on} onValueChange={onChange} trackColor={{ true: c.brand, false: c.surface2 }} thumbColor="#fff" accessibilityLabel={label} />
    </View>
  );
}
