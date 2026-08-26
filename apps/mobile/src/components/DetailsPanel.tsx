import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";
import {
  relativeTime,
  slaCountdown,
  useContact,
  useContacts,
  usePeople,
  usePushPreferences,
  useSetConversationMuted,
  useTeams,
  useUpdateContact,
  windowLeft,
} from "@ding/client";
import type { ConversationWithMessages } from "@ding/schemas";
import { Avatar } from "./Avatar";
import { ChannelDot } from "./ChannelDot";
import { TagEditor } from "./TagEditor";
import { BellIcon, CheckIcon, ChevronRight, TeamGlyph, XIcon, channelMeta } from "../icons";
import { useTheme } from "../theme";
import { Sheet } from "./Sheet";

/**
 * Who this conversation is with, and everything about it that isn't a message.
 *
 * The web keeps this permanently docked beside the thread; a phone has no room
 * for that, so it's a sheet off the thread header.
 *
 * What's editable here is what belongs to the *customer*: their tags, and where
 * their conversations get routed. Both are things you learn mid-thread — "these
 * people are wholesale", "this one should always go to Ops" — and having to
 * remember it until you're next at a desk is how it gets lost.
 *
 * Conversation labels used to be here and aren't any more. They describe the
 * thread, not the person, so they live in the thread's own ⋯ menu; having them
 * under the customer's face made them look like a property of the customer.
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
  const { c } = useTheme();
  const { data: pushPrefs } = usePushPreferences();
  const setMuted = useSetConversationMuted();
  const { data: teams } = useTeams();
  const { data: people } = usePeople();
  const { data: allContacts } = useContacts();
  const updateContact = useUpdateContact();
  // Only fetched while the sheet is open — the thread doesn't need it.
  const { data: contact } = useContact(visible ? conv.contact.id : null);

  const isGroup = conv.channel === "whatsapp_group";
  const meta = channelMeta(conv.channel);

  // The customer as the server last confirmed them. The thread's own copy is a
  // summary and doesn't carry routing, so edits are written against this one
  // and read back from the same query the mutation invalidates.
  const tags = contact?.tags ?? conv.contact.tags ?? [];
  const ownerTeamId = contact?.ownerTeamId ?? null;
  const ownerUserId = contact?.ownerUserId ?? null;
  const saving = updateContact.isPending;
  const edit = (input: Parameters<typeof updateContact.mutate>[0]["input"]) =>
    updateContact.mutate({ id: conv.contact.id, input });

  // Every tag in use across the directory, so adding an existing one is a tap.
  const tagSuggestions = [...new Set((allContacts ?? []).flatMap((x) => x.tags ?? []))].sort();

  const others = (contact?.conversations ?? []).filter((x) => x.id !== conv.id);
  const muted = pushPrefs?.mutedConversationIds.includes(conv.id) ?? false;

  return (
    <Sheet visible={visible} onClose={onClose} padded={false}>
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

          {/* `flexShrink: 1` is load-bearing: without it this sizes to its
              content, overflows the sheet's 85% cap, and — being as tall as its
              content — decides there is nothing to scroll to. See Sheet.tsx. */}
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ paddingBottom: 20 }}
            keyboardShouldPersistTaps="handled"
          >
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

            {/* Customer tags — what kind of customer this is, not what this
                thread is about. Saved on every change: a phone has nowhere
                sensible to put a Save button on a sheet, and an edit you have
                to confirm is an edit you can lose by swiping the sheet away. */}
            <Section>Tags</Section>
            <TagEditor
              tags={tags}
              suggestions={tagSuggestions}
              disabled={saving || !contact}
              onChange={(next) => edit({ tags: next })}
            />

            {/* Where this customer's conversations land, before anyone touches
                them. Groups excluded: a group belongs to its number, and its
                messages are routed by the inbox, not by whoever spoke last. */}
            {!isGroup ? (
              <>
                <Section>Auto-route new conversations</Section>
                <Card>
                  <RouteRow
                    label="Automatic"
                    detail="Follow the channel's own routing"
                    selected={!ownerTeamId && !ownerUserId}
                    disabled={saving || !contact}
                    onPress={() => edit({ ownerTeamId: null, ownerUserId: null })}
                  />
                  {(teams ?? []).map((t, i, arr) => (
                    <RouteRow
                      key={t.id}
                      label={t.name}
                      leading={<TeamGlyph icon={t.icon} size={17} color={c.textMuted} />}
                      selected={ownerTeamId === t.id}
                      disabled={saving || !contact}
                      last={i === arr.length - 1}
                      onPress={() => edit({ ownerTeamId: ownerTeamId === t.id ? null : t.id })}
                    />
                  ))}
                </Card>

                <Section>Straight to a person</Section>
                <Card>
                  <RouteRow
                    label="No one specific"
                    selected={!ownerUserId}
                    disabled={saving || !contact}
                    onPress={() => edit({ ownerUserId: null })}
                  />
                  {(people ?? []).map((m, i, arr) => (
                    <RouteRow
                      key={m.user.id}
                      label={m.user.name}
                      leading={<Avatar name={m.user.name} color={m.user.avatarColor} size={22} />}
                      selected={ownerUserId === m.user.id}
                      disabled={saving || !contact}
                      last={i === arr.length - 1}
                      onPress={() =>
                        edit({ ownerUserId: ownerUserId === m.user.id ? null : m.user.id })
                      }
                    />
                  ))}
                </Card>
              </>
            ) : null}

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
    </Sheet>
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

/** One choice in a routing list: a tick on the right, a glyph on the left, and
 *  the whole row is the target — a radio button on a phone is a 20pt hit area
 *  for a decision that deserves the full width. */
function RouteRow({
  label,
  detail,
  leading,
  selected,
  disabled,
  last,
  onPress,
}: {
  label: string;
  detail?: string;
  leading?: React.ReactNode;
  selected: boolean;
  disabled?: boolean;
  last?: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={label}
      style={{ borderBottomColor: last ? "transparent" : c.border, opacity: disabled ? 0.5 : 1 }}
      className={`flex-row items-center gap-3 px-4 py-2.5 active:opacity-60 ${last ? "" : "border-b"}`}
    >
      {leading ?? null}
      <View className="flex-1">
        <Text
          style={selected ? { color: c.brandStrong } : undefined}
          className={`text-md ${selected ? "font-semibold" : "font-medium text-fg"}`}
        >
          {label}
        </Text>
        {detail ? <Text className="text-2xs text-muted">{detail}</Text> : null}
      </View>
      {selected ? <CheckIcon size={16} color={c.brand} /> : null}
    </Pressable>
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
