import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useViews } from "@ding/client";
import { ChevronRight, InboxIcon, SnoozeIcon, TeamGlyph, XIcon, channelColor, channelMeta } from "../icons";
import { useTheme, useThemeVars } from "../theme";
import { haptics } from "../haptics";

/**
 * The inbox switcher — the web sidebar, as a sheet.
 *
 * This is navigation, not filtering, which is why it isn't a row of chips above
 * the list. It carries the same four sections the sidebar does, in the same
 * order: your own views, then team inboxes, then the channels themselves, then
 * labels. A phone that only offered "Inbound / Queue / Mine / Later" would be
 * missing every team, every channel and every label the workspace has.
 */
export function ViewSwitcher({
  visible,
  view,
  onSelect,
  onOpenConversation,
  onClose,
}: {
  visible: boolean;
  view: string;
  onSelect: (key: string) => void;
  onOpenConversation: (id: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const themeVars = useThemeVars();
  const { data } = useViews();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function pick(key: string) {
    // Every row in here goes through this, so one call covers the whole sheet.
    haptics.select();
    onSelect(key);
    onClose();
  }

  /** A section heading with the sidebar's trailing rule. */
  function SectionLabel({ children }: { children: string }) {
    return (
      <View className="flex-row items-center gap-2 px-4 pb-1.5 pt-4">
        <Text style={{ color: c.textFaint }} className="text-2xs font-semibold uppercase tracking-wider">
          {children}
        </Text>
        <View style={{ backgroundColor: c.border }} className="h-px flex-1" />
      </View>
    );
  }

  /** One navigable view. `sub` rows are the indented children of Inbound. */
  function Row({
    active,
    label,
    count,
    warn,
    sub,
    onPress,
    icon,
    trailing,
  }: {
    active: boolean;
    label: string;
    count?: number;
    warn?: boolean;
    sub?: boolean;
    onPress: () => void;
    icon?: React.ReactNode;
    trailing?: React.ReactNode;
  }) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        style={{ backgroundColor: active ? c.brandTint : "transparent" }}
        className={`mx-2 flex-row items-center gap-2.5 rounded-12 px-2.5 py-2.5 active:opacity-60 ${sub ? "ml-9" : ""}`}
      >
        {icon ? <View className="w-5 items-center">{icon}</View> : null}
        <Text
          numberOfLines={1}
          style={{ color: active ? c.brandStrong : c.text }}
          className={`flex-1 text-md ${active ? "font-semibold" : "font-medium"}`}
        >
          {label}
        </Text>
        {trailing}
        {typeof count === "number" && count > 0 ? (
          <Text
            style={{ color: warn ? c.amber : active ? c.brandStrong : c.textFaint }}
            className="text-2xs font-semibold tabular-nums"
          >
            {count}
          </Text>
        ) : null}
      </Pressable>
    );
  }

  const inbound = data?.my.find((v) => v.key === "inbound");
  const subs = (data?.my ?? []).filter((v) => v.key !== "inbound");

  return (
    <Modal visible={visible} animationType="slide" transparent accessibilityViewIsModal onRequestClose={onClose}>
      {/* A Modal renders outside the root that publishes the palette, so the
          scheme's variables have to be re-applied here or every colour utility
          inside resolves against nothing. */}
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={[themeVars, { backgroundColor: "rgba(13,21,18,0.4)" }]}
        className="flex-1 justify-end"
      >
        {/* Stop taps inside the sheet from closing it. */}
        <Pressable
          onPress={() => {}}
          // A sink, not a control: it exists so a tap on the sheet
          // doesn't reach the scrim behind it. Left accessible, a
          // screen reader announces the whole sheet as one button and
          // can skip everything inside it.
          accessible={false}
          style={{ backgroundColor: c.surface, maxHeight: "85%", paddingBottom: insets.bottom + 8 }}
          className="rounded-t-24"
        >
          <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
            <Text accessibilityRole="header" className="text-xl font-semibold text-fg">
              Inboxes
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

          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            <SectionLabel>My space</SectionLabel>
            {inbound ? (
              <Row
                active={view === inbound.key}
                label={inbound.title}
                count={inbound.count}
                onPress={() => pick(inbound.key)}
                icon={<InboxIcon size={18} color={view === inbound.key ? c.brandStrong : c.textMuted} />}
              />
            ) : null}
            {subs.map((s) => {
              // "Later" carries a bell when something has already woken —
              // a count alone doesn't say that any of it is due now.
              const due = s.key === "snoozed" && (s.due ?? 0) > 0;
              return (
                <Row
                  key={s.key}
                  sub
                  active={view === s.key}
                  label={s.title}
                  count={due ? s.due : s.count}
                  warn={due}
                  onPress={() => pick(s.key)}
                  icon={
                    due ? (
                      <SnoozeIcon size={15} color={c.amber} />
                    ) : (
                      <View style={{ backgroundColor: c.borderStrong }} className="h-1 w-1 rounded-full" />
                    )
                  }
                />
              );
            })}

            {data?.shared.teams.length ? (
              <>
                <SectionLabel>Team inboxes</SectionLabel>
                {data.shared.teams.map((t) => (
                  <Row
                    key={t.key}
                    active={view === t.key}
                    label={t.title}
                    count={t.count}
                    onPress={() => pick(t.key)}
                    icon={<TeamGlyph size={18} color={view === t.key ? c.brandStrong : c.textMuted} />}
                  />
                ))}
              </>
            ) : null}

            {data?.shared.inboxes.length ? (
              <>
                <SectionLabel>Channels</SectionLabel>
                {data.shared.inboxes.map((i) => {
                  const groups = i.groups ?? [];
                  const open = groups.length > 0 && expanded[i.key];
                  const Glyph = i.channel ? channelMeta(i.channel).Glyph : null;
                  const GroupGlyph = channelMeta("whatsapp_group").Glyph;
                  return (
                    <View key={i.key}>
                      <Row
                        active={view === i.key}
                        label={i.title}
                        count={i.count}
                        onPress={() => pick(i.key)}
                        icon={
                          Glyph ? (
                            <Glyph size={16} color={i.channel ? channelColor(i.channel, c) : c.textFaint} />
                          ) : null
                        }
                        trailing={
                          groups.length > 0 ? (
                            <Pressable
                              onPress={() => setExpanded((e) => ({ ...e, [i.key]: !e[i.key] }))}
                              accessibilityRole="button"
                              accessibilityLabel={open ? "Hide groups" : "Show groups"}
                              hitSlop={10}
                              className="px-1 active:opacity-60"
                              style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}
                            >
                              <ChevronRight size={14} color={c.textFaint} />
                            </Pressable>
                          ) : null
                        }
                      />
                      {open
                        ? groups.map((g) => (
                            <Row
                              key={g.id}
                              sub
                              active={false}
                              label={g.title}
                              onPress={() => {
                                onOpenConversation(g.id);
                                onClose();
                              }}
                              icon={<GroupGlyph size={14} color={c.group} />}
                            />
                          ))
                        : null}
                    </View>
                  );
                })}
              </>
            ) : null}

            {data?.shared.labels.length ? (
              <>
                <SectionLabel>Labels</SectionLabel>
                {data.shared.labels.map((l) => (
                  <Row
                    key={l.key}
                    active={view === l.key}
                    label={l.title}
                    count={l.count}
                    onPress={() => pick(l.key)}
                    icon={
                      <View
                        style={{ backgroundColor: l.color ?? c.textFaint }}
                        className="h-2.5 w-2.5 rounded-full"
                      />
                    }
                  />
                ))}
              </>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
