import { useState } from "react";
import { Linking, Text, View } from "react-native";
import type { AccountSop } from "@ding/schemas";
import { api, useAccountMutation, useConversationAccount } from "@ding/client";
import { AlertIcon, BoltIcon, CheckIcon, ChevronRight, DocIcon } from "../icons";
import { useTheme } from "../theme";
import { Touchable } from "./Touchable";

const PRIORITY = { critical: "Critical", important: "Important", info: "Note" } as const;

/**
 * The customer organisation behind a conversation, on the phone: who they are,
 * what everyone must know (pinned instructions, loudest first), and how their
 * work is done — each SOP opens to its warnings and numbered steps. With
 * several organisations and none chosen it asks, the same as the web. Editing
 * the knowledge itself is a desk job, done in Organisations on the web.
 */
export function OrganisationCard({ conversationId, visible }: { conversationId: string; visible: boolean }) {
  const { c } = useTheme();
  const { data } = useConversationAccount(visible ? conversationId : null);
  const choose = useAccountMutation((accountId: string) => api.setConversationAccount(conversationId, accountId));
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return null;
  const acc = data.account;

  return (
    <>
      <Text style={{ color: c.textFaint }} className="px-5 pb-1.5 pt-5 text-2xs font-semibold uppercase tracking-wider">
        Organisation
      </Text>

      {data.needsChoice ? (
        <View style={{ backgroundColor: c.amberTint, borderColor: c.border }} className="mx-4 rounded-16 border px-4 py-3">
          <Text className="mb-2 text-md text-fg">This contact works with more than one organisation. Which is this conversation about?</Text>
          {data.linked.map((l) => (
            <Touchable
              feel="row"
              key={l.account.id}
              onPress={() => choose.mutate(l.account.id)}
              disabled={choose.isPending}
              accessibilityRole="button"
              accessibilityLabel={l.account.name}
              style={{ backgroundColor: c.surface, borderColor: c.border }}
              className="mb-1.5 rounded-12 border px-3 py-2.5"
            >
              <Text className="text-md font-semibold text-fg">{l.account.name}</Text>
              {l.link.role ? <Text className="text-2xs text-muted">{l.link.role}</Text> : null}
            </Touchable>
          ))}
        </View>
      ) : !acc ? (
        <Text className="px-5 text-md text-muted">Not linked to an organisation. Link one from the web, under Organisations.</Text>
      ) : (
        <View style={{ backgroundColor: c.surface2, borderColor: c.border }} className="mx-4 overflow-hidden rounded-16 border">
          <View className="px-4 pb-2 pt-3">
            <Text className="text-lg font-semibold text-fg">{acc.account.name}</Text>
            <Text className="text-2xs text-muted">
              {[acc.link?.role, acc.account.reference, acc.account.summary].filter(Boolean).join(" · ") || "Customer organisation"}
            </Text>
          </View>

          {acc.alerts.map((a) => {
            const tint = a.priority === "critical" ? c.dangerTint : a.priority === "important" ? c.amberTint : c.surface;
            const tone = a.priority === "critical" ? c.danger : a.priority === "important" ? c.amber : c.textMuted;
            return (
              <View key={a.id} style={{ backgroundColor: tint }} className="mx-3 mb-1.5 flex-row gap-2.5 rounded-12 px-3 py-2.5">
                <AlertIcon size={16} color={tone} />
                <View className="flex-1">
                  <Text style={{ color: tone }} className="text-2xs font-bold uppercase tracking-wider">{PRIORITY[a.priority]}</Text>
                  <Text className="text-md text-fg">{a.body}</Text>
                </View>
              </View>
            );
          })}

          {acc.sops.map((s) => (
            <SopRow key={s.id} sop={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
          ))}

          {acc.resources
            .filter((r) => r.kind !== "file" && r.url)
            .map((r) => (
              <Touchable
                feel="row"
                key={r.id}
                onPress={() => void Linking.openURL(r.url!)}
                accessibilityRole="link"
                accessibilityLabel={r.title}
                style={{ borderTopColor: c.border }}
                className="flex-row items-center gap-3 border-t px-4 py-2.5"
              >
                <BoltIcon size={15} color={c.brandStrong} />
                <View className="flex-1">
                  <Text className="text-md font-medium text-fg">{r.title}</Text>
                  {r.instructions ? <Text className="text-2xs text-muted">{r.instructions}</Text> : null}
                </View>
                <ChevronRight size={14} color={c.textFaint} />
              </Touchable>
            ))}

          {!acc.alerts.length && !acc.sops.length ? (
            <Text className="px-4 pb-3 text-md text-muted">No instructions or procedures recorded yet.</Text>
          ) : (
            <View className="h-2" />
          )}
        </View>
      )}
    </>
  );
}

/** One SOP: its title, opening to the warnings and the steps to tick through. */
function SopRow({ sop, open, onToggle }: { sop: AccountSop; open: boolean; onToggle: () => void }) {
  const { c } = useTheme();
  const [done, setDone] = useState<Set<number>>(new Set());
  const tick = (i: number) =>
    setDone((d) => {
      const n = new Set(d);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  return (
    <View style={{ borderTopColor: c.border }} className="border-t">
      <Touchable
        feel="row"
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={sop.title}
        className="flex-row items-center gap-3 px-4 py-2.5"
      >
        <DocIcon size={15} color={c.brandStrong} />
        <View className="flex-1">
          <Text className="text-md font-semibold text-fg">{sop.title}</Text>
          <Text className="text-2xs text-muted">{sop.category}</Text>
        </View>
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <ChevronRight size={14} color={c.textFaint} />
        </View>
      </Touchable>
      {open ? (
        <View className="px-4 pb-3">
          {sop.warnings ? (
            <View style={{ backgroundColor: c.dangerTint }} className="mb-2 flex-row gap-2 rounded-12 px-3 py-2">
              <AlertIcon size={15} color={c.danger} />
              <Text className="flex-1 text-md text-fg">{sop.warnings}</Text>
            </View>
          ) : null}
          {sop.steps.map((s, i) => (
            <Touchable
              feel="row"
              key={i}
              onPress={() => tick(i)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done.has(i) }}
              accessibilityLabel={`Step ${i + 1}: ${s.text}`}
              style={{ backgroundColor: c.surface }}
              className="mb-1 flex-row items-start gap-2.5 rounded-12 px-3 py-2"
            >
              <View
                style={{ backgroundColor: done.has(i) ? c.brand : "transparent", borderColor: done.has(i) ? c.brand : c.border }}
                className="h-6 w-6 items-center justify-center rounded-full border"
              >
                {done.has(i) ? <CheckIcon size={12} color="#fff" /> : <Text className="text-2xs font-semibold text-muted">{i + 1}</Text>}
              </View>
              <Text style={done.has(i) ? { color: c.textMuted, textDecorationLine: "line-through" } : undefined} className="flex-1 text-md text-fg">
                {s.text}
              </Text>
            </Touchable>
          ))}
          {sop.body ? <Text className="mt-1 text-2xs text-muted">Detailed instructions and documents: open the organisation on the web.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
