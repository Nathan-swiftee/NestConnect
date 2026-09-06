import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useSendMessage, useTemplatesForInbox } from "@ding/client";
import type { ChannelType, Template, TemplateFillContext } from "@ding/schemas";
import { templateDefaults } from "@ding/schemas";
import { approvalLabel, renderPreview } from "../templates";
import { BackIcon, BoltIcon, XIcon } from "../icons";
import { haptics } from "../haptics";
import { useTheme } from "../theme";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { Touchable } from "./Touchable";
import { useToast } from "./Toast";

/**
 * Send an approved WhatsApp template.
 *
 * The composer has had a template button since the composer existed, and until
 * now it did nothing at all — no handler, no sheet, just a bolt you could press
 * forever. This is the missing half.
 *
 * Templates matter most exactly when free text won't go: once the 24-hour
 * window shuts, an approved template is the only way to reach the customer. The
 * composer already sends the workspace's *default* template invisibly in that
 * case, but that only covers one-variable templates and one choice. Picking a
 * specific one — a booking confirmation, a delivery update — needs this.
 *
 * Two steps, deliberately, rather than a list with inline inputs: a template
 * body is a paragraph, and a phone has room to show either a list of paragraphs
 * or one paragraph with fields under it, not both. Choosing is the first
 * decision and filling in is the second, so they get a screen each.
 */
export function TemplateSheet({
  conversationId,
  inboxId,
  fill,
  channel,
  visible,
  onClose,
}: {
  conversationId: string;
  /** The facts a template's saved pre-fill can draw on. */
  fill?: TemplateFillContext;
  /** The conversation's channel, so the list can be narrowed to the templates
   *  its WhatsApp account actually has — a template belongs to one account, and
   *  offering another's is offering a send Meta rejects. */
  inboxId?: string;
  /** The channel to send on. In a cross-channel thread this carries the
   *  composer's WhatsApp selection — without it the send falls back to the
   *  conversation's own channel and a template goes out by email. */
  channel?: ChannelType;
  visible: boolean;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { data: templates, isLoading } = useTemplatesForInbox(inboxId);
  const send = useSendMessage();
  const toast = useToast();
  const [selected, setSelected] = useState<Template | null>(null);
  const [params, setParams] = useState<string[]>([]);

  const varCount = selected?.variableCount ?? 0;
  const ready = !!selected && params.slice(0, varCount).every((p) => p.trim().length > 0);

  /** Reset to the list, and clear the fill — reopening should not resume a
   *  half-filled template the agent walked away from. */
  const close = () => {
    onClose();
    setSelected(null);
    setParams([]);
  };

  const pick = (tpl: Template) => {
    setSelected(tpl);
    // The template's own saved pre-fill, resolved against this conversation.
    // Still editable — a head start, not a decision.
    setParams(templateDefaults(tpl, fill ?? {}));
  };

  async function doSend() {
    if (!selected || !ready || send.isPending) return;
    try {
      await send.mutateAsync({
        id: conversationId,
        body: "",
        template: { id: selected.id, params },
        channel,
      });
      haptics.success();
      toast({ text: "Template sent" });
      close();
    } catch {
      // No offline queue for this one. A template send is the thing that
      // re-opens a closed window, and one that silently goes out hours later —
      // possibly after the customer has written in and re-opened it anyway — is
      // a message nobody meant to send. Failing here leaves the sheet up with
      // the fill intact, which is recoverable; a surprise send isn't.
      haptics.error();
      toast({ text: "Couldn't send the template. Please try again.", tone: "error" });
    }
  }

  const list = templates ?? [];

  return (
    <Sheet visible={visible} onClose={close} padded={false} closeLabel="Close templates">
      <View className="flex-row items-center justify-between px-4 pb-3 pt-1">
        <View className="flex-1">
          <Text accessibilityRole="header" className="text-xl font-semibold text-fg">
            {selected ? "Fill in the template" : "Templates"}
          </Text>
          <Text className="text-2xs text-muted">
            {selected ? selected.name : "Approved WhatsApp messages"}
          </Text>
        </View>
        <Touchable
          feel="chip"
          borderless
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={{ backgroundColor: c.surface2 }}
          className="h-8 w-8 items-center justify-center rounded-full"
        >
          <XIcon size={16} color={c.textMuted} />
        </Touchable>
      </View>

      {/* `flexShrink: 1` is required of every scroller inside a Sheet — without
          it this sizes to its content, overflows the sheet's 85% cap and then
          believes it has nothing to scroll. See Sheet.tsx; check:layout enforces
          it. */}
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {selected ? (
          <View className="px-4">
            <Touchable
              feel="chip"
              borderless
              onPress={() => setSelected(null)}
              accessibilityRole="button"
              className="mb-3 flex-row items-center gap-1.5 self-start py-1"
            >
              <BackIcon size={15} color={c.textMuted} />
              <Text className="text-sm font-medium text-muted">All templates</Text>
            </Touchable>

            {varCount > 0 ? (
              <View className="gap-3">
                {Array.from({ length: varCount }, (_, i) => (
                  <View key={i} className="gap-1.5">
                    <Text className="text-sm font-medium text-muted">{`Variable {{${i + 1}}}`}</Text>
                    <TextInput
                      value={params[i] ?? ""}
                      onChangeText={(v) => setParams((p) => p.map((x, idx) => (idx === i ? v : x)))}
                      placeholder={`Value for {{${i + 1}}}`}
                      placeholderTextColor={c.textFaint}
                      autoFocus={i === 0}
                      style={{ color: c.text, borderColor: c.border, backgroundColor: c.surface2 }}
                      className="rounded-12 border px-4 py-3 text-lg"
                    />
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-sm text-muted">
                This template has no variables — it sends exactly as written.
              </Text>
            )}

            {/* The preview is the point of the second step: what actually
                reaches the customer, with anything still blank left visibly
                blank rather than quietly sent as "{{2}}". */}
            <Text
              style={{ color: c.textFaint }}
              className="pb-1.5 pt-5 text-2xs font-semibold uppercase tracking-wider"
            >
              Preview
            </Text>
            <View
              style={{ backgroundColor: c.surface2, borderColor: c.border }}
              className="rounded-16 border px-4 py-3"
            >
              <Text className="text-md leading-6 text-fg">
                {renderPreview(selected.body).map((seg, i) =>
                  seg.slot == null ? (
                    <Text key={i}>{seg.text}</Text>
                  ) : params[seg.slot - 1]?.trim() ? (
                    <Text key={i} className="font-semibold">
                      {params[seg.slot - 1]}
                    </Text>
                  ) : (
                    <Text key={i} style={{ color: c.amber }} className="font-semibold">
                      {seg.text}
                    </Text>
                  ),
                )}
              </Text>
            </View>

            <View className="pt-5">
              <Button
                title={send.isPending ? "Sending…" : "Send template"}
                busy={send.isPending}
                disabled={!ready}
                onPress={doSend}
              />
            </View>
          </View>
        ) : isLoading ? (
          <ActivityIndicator color={c.brand} className="py-8" />
        ) : list.length === 0 ? (
          <View className="items-center gap-2 px-8 py-8">
            <BoltIcon size={26} color={c.textFaint} />
            <Text className="text-center text-md text-muted">
              No templates yet. Create one in Settings › Templates on the web, or sync your approved
              templates from a connected WhatsApp number.
            </Text>
          </View>
        ) : (
          <View>
            {list.map((tpl, i, arr) => {
              const selectable = tpl.approvalStatus === "approved";
              return (
                <Touchable
                  feel="row"
                  key={tpl.id}
                  onPress={() => pick(tpl)}
                  disabled={!selectable}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !selectable }}
                  accessibilityLabel={`${tpl.name}, ${approvalLabel(tpl.approvalStatus)}`}
                  style={{
                    borderBottomColor: i === arr.length - 1 ? "transparent" : c.border,
                    opacity: selectable ? 1 : 0.55,
                  }}
                  className={`gap-1 px-4 py-3 ${i === arr.length - 1 ? "" : "border-b"}`}
                >
                  <View className="flex-row items-center gap-2">
                    <Text numberOfLines={1} className="flex-1 text-md font-semibold text-fg">
                      {tpl.name}
                    </Text>
                    <Text style={{ color: c.textFaint }} className="text-2xs font-medium uppercase">
                      {tpl.language}
                    </Text>
                    <Text
                      style={{ color: selectable ? c.brandStrong : c.textFaint }}
                      className="text-2xs font-semibold"
                    >
                      {approvalLabel(tpl.approvalStatus)}
                    </Text>
                  </View>
                  <Text numberOfLines={2} className="text-sm text-muted">
                    {tpl.body}
                  </Text>
                </Touchable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}
