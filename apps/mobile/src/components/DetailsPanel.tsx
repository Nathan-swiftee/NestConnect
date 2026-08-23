import { ActivityIndicator, Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  relativeTime,
  slaCountdown,
  useContact,
  useLabels,
  usePushPreferences,
  useSetConversationLabels,
  useSetConversationMuted,
  windowLeft,
} from "@ding/client";
import type { ConversationWithMessages } from "@ding/schemas";
import { Avatar } from "./Avatar";
import { ChannelDot } from "./ChannelDot";
import { BellIcon, CheckIcon, ChevronRight, XIcon, channelMeta } from "../icons";
import { useTheme, useThemeVars } from "../theme";

/**
 * Who this conversation is with, and everything about it that isn't a message.
 *
 * The web keeps this permanently docked beside the thread; a phone has no room
 * for that, so it's a sheet off the thread header. Same contents, minus the
 * blocks that are really admin forms — editing a customer's routing rules or
 * their tag list belongs on a screen with a keyboard and a mouse.
 *
 * Labels are the exception and are fully editable here, because labelling is
 * something you do *while working a thread*, not while administering the
 * workspace — it's how the next person knows what this is about.
 */
export function DetailsPanel({
  conv,
  visible,
  onClose,
  onOpenConversation,
}: {
  conv: ConversationWithMessages;
  visible: boolean;
  onClose: () => void;
  onOpenConversation: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const themeVars = useThemeVars();
  const { data: catalog } = useLabels();
  const setLabels = useSetConversationLabels();
  const { data: pushPrefs } = usePushPreferences();
  const setMuted = useSetConversationMuted();
  // Only fetched while the sheet is open — the thread doesn't need it.
  const { data: contact } = useContact(visible ? conv.contact.id : null);

  const applied = new Set((conv.labels ?? []).map((l) => l.id));
  const isGroup = conv.channel === "whatsapp_group";
  const meta = channelMeta(conv.channel);

  function toggleLabel(id: string) {
    const next = applied.has(id)
      ? [...applied].filter((x) => x !== id)
      : [...applied, id];
    setLabels.mutate({ id: conv.id, labelIds: next });
  }

  const others = (contact?.conversations ?? []).filter((x) => x.id !== conv.id);
  const muted = pushPrefs?.mutedConversationIds.includes(conv.id) ?? false;

  return (
    <Modal visible={visible} transparent animationType="slide" accessibilityViewIsModal onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={[themeVars, { backgroundColor: c.scrim }]}
        className="flex-1 justify-end"
      >
        <Pressable
          onPress={() => {}}
          // A sink, not a control: it exists so a tap on the sheet
          // doesn't reach the scrim behind it. Left accessible, a
          // screen reader announces the whole sheet as one button and
          // can skip everything inside it.
          accessible={false}
          style={{ backgroundColor: c.surface, maxHeight: "88%", paddingBottom: insets.bottom + 8 }}
          className="rounded-t-24"
        >
          <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
            <Text accessibilityRole="header" className="text-xl font-semibold text-fg">
              Details
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              style={{ backgroundColor: c.surface2 }}
              className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
            >
              <XIcon size={16} color={c.textMuted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
            {/* Who */}
            <View className="items-center px-6 pb-2 pt-3">
              <Avatar name={conv.contact.displayName} color={conv.contact.avatarColor} size={64} />
              <Text className="mt-2.5 text-xl font-semibold text-fg">{conv.contact.displayName}</Text>
              {conv.contact.company ? (
                <Text className="text-md text-muted">{conv.contact.company}</Text>
              ) : null}
              <View className="mt-1.5 flex-row items-center gap-1.5">
                <ChannelDot channel={conv.channel} size={13} />
                <Text className="text-sm text-muted">{meta.label}</Text>
              </View>
              {conv.contact.tags?.length ? (
                <View className="mt-3 flex-row flex-wrap justify-center gap-1.5">
                  {conv.contact.tags.map((t) => (
                    <View key={t} style={{ backgroundColor: c.surface2 }} className="rounded-full px-2.5 py-1">
                      <Text style={{ color: c.textMuted }} className="text-2xs font-medium">
                        {t}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            {/* Reachable on */}
            {conv.contact.phone || conv.contact.email ? (
              <>
                <Section>Reachable on</Section>
                <Card>
                  {conv.contact.phone ? <Field label="Phone" value={conv.contact.phone} /> : null}
                  {conv.contact.email ? <Field label="Email" value={conv.contact.email} last /> : null}
                </Card>
              </>
            ) : null}

            {/* This conversation */}
            <Section>This conversation</Section>
            <Card>
              <Field
                label="Status"
                value={
                  conv.status === "closed"
                    ? "Resolved"
                    : conv.status === "snoozed"
                      ? "Snoozed"
                      : conv.status === "pending"
                        ? "Pending"
                        : "Open"
                }
              />
              <Field label="Assigned to" value={conv.assigneeName ?? "Nobody"} />
              {conv.slaDueAt && conv.status !== "closed" ? (
                <Field
                  label="SLA"
                  value={slaCountdown(conv.slaDueAt)}
                  tone={new Date(conv.slaDueAt).getTime() < Date.now() ? c.danger : undefined}
                />
              ) : null}
              {conv.waWindow ? (
                <Field
                  label="24-hour window"
                  value={
                    conv.waWindow.open
                      ? `${windowLeft(new Date(conv.waWindow.expiresAt ?? 0).getTime() - Date.now())} left`
                      : "Closed — template required"
                  }
                  tone={conv.waWindow.open ? c.brandStrong : c.amber}
                />
              ) : null}
              <Field label="Last activity" value={`${relativeTime(conv.lastActivityAt)} ago`} last />
            </Card>

            {/* Notifications for this one thread */}
            <Section>Notifications</Section>
            <Card>
              <View className="flex-row items-center gap-3 px-4 py-3">
                <BellIcon size={17} color={muted ? c.textFaint : c.textMuted} />
                <View className="flex-1">
                  <Text className="text-md font-medium text-fg">{muted ? "Muted" : "Notifications on"}</Text>
                  <Text className="text-2xs text-muted">
                    {muted
                      ? "No pushes from this thread — snooze reminders still arrive"
                      : "You'll be pushed about this thread as usual"}
                  </Text>
                </View>
                <Switch
                  value={!muted}
                  onValueChange={(on) => setMuted.mutate({ conversationId: conv.id, muted: !on })}
                  disabled={setMuted.isPending}
                  trackColor={{ true: c.brand, false: c.surface2 }}
                  thumbColor="#fff"
                />
              </View>
            </Card>

            {/* Labels — the editable one */}
            <Section>Labels</Section>
            {catalog?.length ? (
              <View className="flex-row flex-wrap gap-2 px-4">
                {catalog.map((l) => {
                  const on = applied.has(l.id);
                  return (
                    <Pressable
                      key={l.id}
                      onPress={() => toggleLabel(l.id)}
                      disabled={setLabels.isPending}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={l.name}
                      style={{
                        backgroundColor: on ? (l.color ?? c.brand) + "22" : c.surface2,
                        borderColor: on ? (l.color ?? c.brand) : "transparent",
                      }}
                      className="flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 active:opacity-60"
                    >
                      <View
                        style={{ backgroundColor: l.color ?? c.textFaint }}
                        className="h-2 w-2 rounded-full"
                      />
                      <Text
                        style={{ color: on ? c.text : c.textMuted }}
                        className={`text-sm ${on ? "font-semibold" : "font-medium"}`}
                      >
                        {l.name}
                      </Text>
                      {on ? <CheckIcon size={13} color={l.color ?? c.brand} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text className="px-5 text-md text-muted">
                No labels yet — they're created in Settings on the web.
              </Text>
            )}

            {/* Group members */}
            {isGroup && conv.participants?.length ? (
              <>
                <Section>{`In this group (${conv.participants.length})`}</Section>
                <Card>
                  {conv.participants.map((p, i, arr) => (
                    <View
                      key={p.id}
                      style={{ borderBottomColor: i === arr.length - 1 ? "transparent" : c.border }}
                      className={`flex-row items-center gap-3 px-4 py-2.5 ${i === arr.length - 1 ? "" : "border-b"}`}
                    >
                      <Avatar name={p.contact.displayName} color={p.contact.avatarColor} size={30} />
                      <Text numberOfLines={1} className="flex-1 text-md text-fg">
                        {p.contact.displayName}
                      </Text>
                      {p.role !== "member" ? (
                        <Text style={{ color: c.textFaint }} className="text-2xs font-semibold capitalize">
                          {p.role}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Their other threads */}
            {others.length ? (
              <>
                <Section>Other conversations</Section>
                <Card>
                  {others.slice(0, 6).map((x, i, arr) => (
                    <Pressable
                      key={x.id}
                      onPress={() => {
                        onClose();
                        onOpenConversation(x.id);
                      }}
                      accessibilityRole="button"
                      style={{ borderBottomColor: i === arr.length - 1 ? "transparent" : c.border }}
                      className={`flex-row items-center gap-2.5 px-4 py-2.5 active:opacity-60 ${i === arr.length - 1 ? "" : "border-b"}`}
                    >
                      <ChannelDot channel={x.lastChannel ?? x.channel} size={14} />
                      <View className="flex-1">
                        <Text numberOfLines={1} className="text-md text-fg">
                          {x.subject || x.preview || "Conversation"}
                        </Text>
                        <Text className="text-2xs text-faint">
                          {x.status === "closed" ? "Resolved · " : ""}
                          {relativeTime(x.lastActivityAt)} ago
                        </Text>
                      </View>
                      <ChevronRight size={14} color={c.textFaint} />
                    </Pressable>
                  ))}
                </Card>
              </>
            ) : contact === undefined ? (
              <ActivityIndicator color={c.brand} className="py-4" />
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Section({ children }: { children: string }) {
  const { c } = useTheme();
  return (
    <Text
      style={{ color: c.textFaint }}
      className="px-5 pb-1.5 pt-5 text-2xs font-semibold uppercase tracking-wider"
    >
      {children}
    </Text>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ backgroundColor: c.surface2, borderColor: c.border }} className="mx-4 rounded-16 border">
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  tone,
  last,
}: {
  label: string;
  value: string;
  tone?: string;
  last?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{ borderBottomColor: last ? "transparent" : c.border }}
      className={`flex-row items-center gap-3 px-4 py-2.5 ${last ? "" : "border-b"}`}
    >
      <Text className="text-md text-muted">{label}</Text>
      <Text
        numberOfLines={1}
        style={tone ? { color: tone } : undefined}
        className={`flex-1 text-right text-md ${tone ? "font-semibold" : "font-medium text-fg"}`}
      >
        {value}
      </Text>
    </View>
  );
}
