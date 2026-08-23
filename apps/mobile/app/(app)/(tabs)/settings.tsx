import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useLogout,
  useMe,
  usePushPreferences,
  useUpdateMyPreferences,
  useUpdatePushPreferences,
} from "@ding/client";
import type { PushPreferences } from "@ding/schemas";
import { Avatar } from "../../../src/components/Avatar";
import { BellIcon, LogoutIcon } from "../../../src/icons";
import { usePushRegistration } from "../../../src/push";
import { useTheme } from "../../../src/theme";

/**
 * Settings on a phone: who you are, whether you're taking work, and what is
 * allowed to interrupt you.
 *
 * Deliberately not the web's Settings section. Channels, teams, people,
 * templates and integrations are administration — long forms, done sitting
 * down — and putting them behind a phone-sized tap target would be worse than
 * not offering them. What a phone genuinely owns is presence and notifications,
 * and those are here in full.
 *
 * No theme toggle either: on a phone the OS decides light or dark, and the app
 * follows it. A second, disagreeing switch inside the app is a bug waiting to
 * be reported.
 */
export default function Settings() {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const { data } = useMe();
  const me = data?.user;
  const prefs = useUpdateMyPreferences();
  const pushPrefs = usePushPreferences();
  const updatePush = useUpdatePushPreferences();
  const logout = useLogout();
  // The account's preferences and this phone's OS permission are two different
  // things, and a toggle means nothing while the second is off — hence both.
  const push = usePushRegistration(!!me);

  // Availability is tracked locally for an instant toggle, then synced — the
  // same arrangement the web's rail menu uses.
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    if (me) setAvailable(me.available);
  }, [me?.available]);

  function toggleAvailable() {
    const next = !available;
    setAvailable(next);
    prefs.mutate({ available: next }, { onError: () => setAvailable(!next) });
  }

  const p = pushPrefs.data;
  const setPush = (key: keyof PushPreferences, value: boolean) => updatePush.mutate({ [key]: value });

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }}
    >
      <Text className="px-4 pb-4 text-2xl font-semibold tracking-tight text-fg">Settings</Text>

      {/* Who you are */}
      <View style={{ backgroundColor: c.surface, borderColor: c.border }} className="mx-4 rounded-16 border p-4">
        <View className="flex-row items-center gap-3">
          <Avatar name={me?.name ?? ""} color={me?.avatarColor} size={52} />
          <View className="flex-1">
            <Text className="text-lg font-semibold text-fg">{me?.name ?? "—"}</Text>
            <Text numberOfLines={1} className="text-sm text-muted">
              {me?.email ?? ""}
            </Text>
          </View>
          <View style={{ backgroundColor: c.surface2 }} className="rounded-full px-2.5 py-1">
            <Text style={{ color: c.textMuted }} className="text-2xs font-semibold capitalize">
              {me?.role ?? ""}
            </Text>
          </View>
        </View>

        <View style={{ backgroundColor: c.border }} className="my-3.5 h-px" />

        <Pressable
          onPress={toggleAvailable}
          accessibilityRole="switch"
          accessibilityState={{ checked: available }}
          className="flex-row items-center gap-2.5"
        >
          <View
            style={{ backgroundColor: available ? c.wa : c.amber }}
            className="h-2.5 w-2.5 rounded-full"
          />
          <View className="flex-1">
            <Text className="text-md font-medium text-fg">{available ? "Available" : "Unavailable"}</Text>
            <Text className="text-2xs text-muted">
              {available ? "Round-robin can route work to you" : "You're skipped when work is routed"}
            </Text>
          </View>
          <Switch
            value={available}
            onValueChange={toggleAvailable}
            trackColor={{ true: c.brand, false: c.surface2 }}
            thumbColor="#fff"
          />
        </Pressable>
      </View>

      {/* What may interrupt you */}
      <View className="flex-row items-center gap-2 px-5 pb-1.5 pt-6">
        <BellIcon size={14} color={c.textFaint} />
        <Text style={{ color: c.textFaint }} className="text-2xs font-semibold uppercase tracking-wider">
          Notifications
        </Text>
      </View>

      {push.supported && push.status && !push.granted ? (
        <Pressable
          onPress={() => void push.requestPermission()}
          accessibilityRole="button"
          style={{ backgroundColor: c.amberTint, borderColor: c.amber }}
          className="mx-4 mb-2 rounded-16 border px-4 py-3 active:opacity-70"
        >
          <Text style={{ color: c.amber }} className="text-md font-semibold">
            Notifications are off for this phone
          </Text>
          <Text style={{ color: c.amber }} className="text-2xs">
            These settings have no effect until you allow them. Tap to turn them on.
          </Text>
        </Pressable>
      ) : null}

      <View style={{ backgroundColor: c.surface, borderColor: c.border }} className="mx-4 rounded-16 border">
        {pushPrefs.isLoading || !p ? (
          <ActivityIndicator color={c.brand} className="py-8" />
        ) : (
          <>
            <Toggle
              label="My conversations"
              detail="A new message on something assigned to me"
              value={p.assigned}
              onChange={(v) => setPush("assigned", v)}
            />
            <Toggle
              label="Mentions"
              detail="Someone @mentions me in an internal note"
              value={p.mentions}
              onChange={(v) => setPush("mentions", v)}
            />
            <Toggle
              label="Assignments"
              detail="A conversation is handed to me"
              value={p.assignments}
              onChange={(v) => setPush("assignments", v)}
            />
            <Toggle
              label="Snooze reminders"
              detail="Something I snoozed comes due"
              value={p.reminders}
              onChange={(v) => setPush("reminders", v)}
            />
            <Toggle
              label="Team inbound"
              detail="Any new message in my team's inboxes — noisy on a busy shift"
              value={p.teamInbound}
              onChange={(v) => setPush("teamInbound", v)}
              last
            />
          </>
        )}
      </View>

      {p?.quietHours ? (
        <Text className="px-5 pt-2 text-2xs text-faint">
          Quiet hours {p.quietHours.start}–{p.quietHours.end}
          {p.timezone ? ` (${p.timezone})` : ""} — set on the web.
        </Text>
      ) : null}

      <Pressable
        onPress={async () => {
          // Delete the device row *before* the session goes: the call needs the
          // token that logging out throws away. A phone that keeps buzzing
          // after sign-out is a bug people report as a security problem.
          await push.unregister();
          logout.mutate();
        }}
        accessibilityRole="button"
        style={{ backgroundColor: c.surface, borderColor: c.border }}
        className="mx-4 mt-6 flex-row items-center justify-center gap-2 rounded-16 border py-3.5 active:opacity-70"
      >
        <LogoutIcon size={18} color={c.danger} />
        <Text style={{ color: c.danger }} className="text-md font-semibold">
          Sign out
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Toggle({
  label,
  detail,
  value,
  onChange,
  last,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{ borderBottomColor: last ? "transparent" : c.border }}
      className={`flex-row items-center gap-3 px-4 py-3 ${last ? "" : "border-b"}`}
    >
      <View className="flex-1">
        <Text className="text-md font-medium text-fg">{label}</Text>
        <Text className="text-2xs text-muted">{detail}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.brand, false: c.surface2 }}
        thumbColor="#fff"
      />
    </View>
  );
}
