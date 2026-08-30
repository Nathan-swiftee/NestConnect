import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { relativeTime, useMarkNotificationsRead, useNotifications } from "@ding/client";
import type { Notification } from "@ding/schemas";
import { haptics } from "../haptics";
import { AtIcon, BellIcon, SnoozeIcon, XIcon } from "../icons";
import { useTheme } from "../theme";
import { Sheet } from "./Sheet";
import { Touchable } from "./Touchable";

/**
 * The bell: what happened while you weren't looking.
 *
 * The web has had this since the beginning and the phone never did, which is
 * backwards — a phone is where you find out something happened, and a desk is
 * where you were already looking. Two things land here, and only two: someone
 * @mentioned you in an internal note, and a conversation you snoozed has come
 * back. Both are addressed to *you* and neither repeats.
 *
 * What deliberately does not land here is a new inbound message. Those are the
 * inbox, and a bell that lists them is a second unread count disagreeing with
 * the first one two lines above it. The server draws the same line — see
 * `notificationTypeSchema`, which has exactly these two members.
 *
 * The list is the account's, not this device's, so it agrees with the web bell
 * and survives a reinstall. That also makes it the honest fallback for the whole
 * push stack: if a notification never reached the phone's tray, it is still
 * here, and "I never got told" and "I got told and missed it" stop looking the
 * same.
 */
export function NotificationBell({
  onOpenConversation,
}: {
  /** Where a tapped notification goes. Passed in rather than routed here, so
   *  this doesn't need to know how the app spells its thread route. */
  onOpenConversation: (conversationId: string) => void;
}) {
  const { c } = useTheme();
  const { data } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [open, setOpen] = useState(false);

  const list = data ?? [];
  const unread = list.filter((n) => !n.read).length;

  const openOne = (n: Notification) => {
    haptics.select();
    // Read first, and locally — `useMarkNotificationsRead` flips the cache in
    // `onMutate`, so the dot is gone before the screen changes rather than
    // still sitting there when you come back.
    if (!n.read) markRead.mutate([n.id]);
    setOpen(false);
    if (n.conversationId) onOpenConversation(n.conversationId);
  };

  return (
    <>
      <Touchable
        feel="chip"
        onPress={() => {
          haptics.tap();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"}
        hitSlop={10}
        style={{ backgroundColor: c.surface2 }}
        className="h-10 w-10 flex-none items-center justify-center rounded-full"
      >
        <BellIcon size={19} color={c.textMuted} />
        {unread > 0 ? (
          // Brand, matching the inbox row's unread badge — the two counts are
          // the same idea and should not be two colours. Absolutely positioned
          // so it can sit proud of the circle rather than shrinking the glyph.
          <View
            pointerEvents="none"
            style={{
              backgroundColor: c.brand,
              borderColor: c.bg,
              position: "absolute",
              top: -1,
              right: -1,
              minWidth: 17,
              height: 17,
              borderWidth: 2,
            }}
            className="items-center justify-center rounded-full px-1"
          >
            <Text style={{ fontSize: 9.5, lineHeight: 12 }} className="font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </Text>
          </View>
        ) : null}
      </Touchable>

      <Sheet visible={open} onClose={() => setOpen(false)} padded={false} closeLabel="Close notifications">
        <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
          <View className="flex-1">
            <Text accessibilityRole="header" className="text-xl font-semibold text-fg">
              Notifications
            </Text>
            <Text className="text-sm text-muted">
              {unread > 0 ? `${unread} unread` : "Nothing new"}
            </Text>
          </View>
          {unread > 0 ? (
            <Touchable
              feel="chip"
              onPress={() => {
                haptics.select();
                markRead.mutate(undefined);
              }}
              accessibilityRole="button"
              hitSlop={8}
              className="mr-1 px-2 py-1"
            >
              <Text style={{ color: c.brandStrong }} className="text-sm font-semibold">
                Mark all read
              </Text>
            </Touchable>
          ) : null}
          <Touchable
            feel="chip"
            borderless
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
            style={{ backgroundColor: c.surface2 }}
            className="h-8 w-8 items-center justify-center rounded-full"
          >
            <XIcon size={16} color={c.textMuted} />
          </Touchable>
        </View>

        {/* `flexShrink: 1` is what makes this scroll at all — see Sheet.tsx. */}
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
          {list.length === 0 ? (
            <Text className="px-5 py-8 text-center text-md text-muted">You're all caught up.</Text>
          ) : (
            <View
              style={{ backgroundColor: c.surface2, borderColor: c.border }}
              className="mx-4 mt-3 rounded-16 border"
            >
              {list.map((n, i) => {
                const last = i === list.length - 1;
                const mention = n.type === "mention";
                return (
                  <Touchable
                    key={n.id}
                    feel="row"
                    onPress={() => openOne(n)}
                    accessibilityRole="button"
                    accessibilityLabel={`${n.title}. ${n.body}${n.read ? "" : ". Unread"}`}
                    style={{ borderBottomColor: last ? "transparent" : c.border }}
                    className={`flex-row items-center gap-3 px-4 py-3 ${last ? "" : "border-b"}`}
                  >
                    {/* Tinted disc rather than a bare glyph: a mention and a
                        snooze coming due are different *kinds* of interruption,
                        and the colour says which before the words do. */}
                    <View
                      style={{ backgroundColor: mention ? c.brandTint : c.amberTint }}
                      className="h-9 w-9 flex-none items-center justify-center rounded-full"
                    >
                      {mention ? (
                        <AtIcon size={17} color={c.brandStrong} />
                      ) : (
                        <SnoozeIcon size={17} color={c.amber} />
                      )}
                    </View>

                    <View className="min-w-0 flex-1">
                      <Text
                        numberOfLines={1}
                        className={`text-md text-fg ${n.read ? "font-medium" : "font-semibold"}`}
                      >
                        {n.title}
                      </Text>
                      {n.body ? (
                        <Text numberOfLines={2} className="text-2xs leading-snug text-muted">
                          {n.body}
                        </Text>
                      ) : null}
                      <Text className="pt-0.5 text-2xs text-faint">{relativeTime(n.createdAt)}</Text>
                    </View>

                    {!n.read ? (
                      <View
                        style={{ backgroundColor: c.brand, height: 9, width: 9 }}
                        className="flex-none rounded-full"
                      />
                    ) : null}
                  </Touchable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </Sheet>
    </>
  );
}
