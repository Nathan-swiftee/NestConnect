import { useEffect, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { api, relativeTime, useOpsLibrary, useOpsMutation, useOpsSop, useOpsStatus, useOpsVersions, useTeams } from "@ding/client";
import type { Attachment, OpsResource, OpsRevision, OpsSop } from "@ding/schemas";
import { describeOpsChanges, opsProgress } from "@ding/schemas";
import { mediaSource } from "../../../src/api-config";
import { DocumentViewer } from "../../../src/components/DocumentViewer";
import { KnowledgeView } from "../../../src/components/OrganisationScreen";
import { OpsChip, OpsTile, teamsLabel } from "../../../src/components/OpsParts";
import { QueryState } from "../../../src/components/States";
import { useToast } from "../../../src/components/Toast";
import { Touchable } from "../../../src/components/Touchable";
import { haptics } from "../../../src/haptics";
import { AlertIcon, BackIcon, CheckIcon, ChevronRight, DocIcon, HistoryIcon, LinkIcon } from "../../../src/icons";
import { useInsets } from "../../../src/insets";
import { hostOf } from "../../../src/ops";
import { useTheme } from "../../../src/theme";

const errText = (err: unknown) => (err instanceof Error && err.message ? err.message : "Something went wrong");
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * One SOP on the phone: warnings first, then the steps — as a list to read or a
 * checklist to tick through — then details, files and links. A must-read asks
 * to be confirmed here. History shows what each version changed.
 *
 * Read-only: editing is on the web. A full screen on the stack (like a thread),
 * so it can be opened from the library, a notification or the bell alike.
 */
export default function OpsSopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const insets = useInsets();
  const sopQ = useOpsSop(id);
  const sop = sopQ.data;
  const [history, setHistory] = useState(false);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  const openResource = (r: OpsResource) => {
    if (r.kind === "file" && r.url.startsWith("/api/media/")) {
      setViewing({
        id: r.url.slice("/api/media/".length),
        kind: "document",
        mime: "application/octet-stream",
        size: 0,
        filename: r.title,
        url: r.url,
      } as Attachment);
    } else void Linking.openURL(r.url);
  };

  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="flex-1">
      <View style={{ borderBottomColor: c.border, backgroundColor: c.surface }} className="flex-row items-center gap-2 border-b px-3 py-2">
        <Touchable feel="chip" onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} className="px-1">
          <BackIcon size={24} color={c.brand} />
        </Touchable>
        <Text numberOfLines={1} className="flex-1 text-lg font-semibold text-fg">
          {sop?.title ?? "SOP"}
        </Text>
        {sop && sop.version > 0 ? (
          <Touchable
            feel="chip"
            onPress={() => setHistory(true)}
            accessibilityRole="button"
            accessibilityLabel="Version history"
            hitSlop={8}
            style={{ backgroundColor: c.surface2 }}
            className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
          >
            <HistoryIcon size={15} color={c.textMuted} />
            <Text className="text-sm font-medium text-muted">History</Text>
          </Touchable>
        ) : null}
      </View>

      {!sop ? (
        <View className="flex-1 items-center justify-center px-6">
          <QueryState query={sopQ} what="this SOP" empty={<Text className="text-md text-muted">This SOP isn't available.</Text>} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
          <Hero sop={sop} />
          <Banners sop={sop} />
          {sop.warnings ? (
            <View style={{ backgroundColor: c.dangerTint, borderColor: c.danger }} className="mx-4 mt-3 flex-row gap-3 rounded-16 border px-3.5 py-3">
              <AlertIcon size={18} color={c.danger} />
              <View className="flex-1">
                <Text style={{ color: c.danger }} className="text-2xs font-bold uppercase tracking-wider">
                  Before you start
                </Text>
                <Text className="mt-0.5 text-md text-fg">{sop.warnings}</Text>
              </View>
            </View>
          ) : null}
          {sop.steps.length ? <Steps sop={sop} onZoom={setZoom} /> : null}
          {sop.body ? (
            <Section title="Details">
              <View style={{ backgroundColor: c.surface, borderColor: c.border }} className="mx-4 rounded-16 border px-4 py-3">
                <KnowledgeView html={sop.body} />
              </View>
            </Section>
          ) : null}
          {sop.resources.length ? (
            <Section title="Files and links">
              <View style={{ backgroundColor: c.surface, borderColor: c.border }} className="mx-4 overflow-hidden rounded-16 border">
                {sop.resources.map((r, i) => (
                  <Touchable
                    key={r.id}
                    feel="row"
                    onPress={() => openResource(r)}
                    accessibilityRole="link"
                    accessibilityLabel={r.title}
                    style={{ borderTopColor: c.border }}
                    className={`flex-row items-center gap-3 px-4 py-3 ${i ? "border-t" : ""}`}
                  >
                    <View style={{ backgroundColor: c.surface2 }} className="h-8 w-8 items-center justify-center rounded-8">
                      {r.kind === "file" ? <DocIcon size={16} color={c.textMuted} /> : <LinkIcon size={16} color={c.textMuted} />}
                    </View>
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-md font-medium text-fg">
                        {r.title}
                      </Text>
                      <Text numberOfLines={1} className="text-2xs text-muted">
                        {r.kind === "file" ? "File" : hostOf(r.url)}
                      </Text>
                    </View>
                    <ChevronRight size={14} color={c.textFaint} />
                  </Touchable>
                ))}
              </View>
            </Section>
          ) : null}
          <Text style={{ color: c.textFaint }} className="px-5 pt-6 text-2xs">
            {[
              sop.version > 0 ? `Version ${sop.version}` : "Not published yet",
              sop.publishedAt ? `published ${shortDate(sop.publishedAt)}` : null,
              sop.updatedBy ? `last edited by ${sop.updatedBy.name} ${relativeTime(sop.updatedAt)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </ScrollView>
      )}

      {history && sop ? <HistorySheet sop={sop} onClose={() => setHistory(false)} /> : null}
      {viewing ? <DocumentViewer attachment={viewing} onClose={() => setViewing(null)} /> : null}
      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <Pressable onPress={() => setZoom(null)} accessibilityLabel="Close picture" style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center" }}>
          {zoom ? <Image source={mediaSource(zoom)} contentFit="contain" style={{ width: "100%", height: "80%" }} /> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View className="pt-5">
      <View className="flex-row items-center justify-between px-5 pb-1.5">
        <Text style={{ color: c.textFaint }} className="text-2xs font-semibold uppercase tracking-wider">
          {title}
        </Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function Hero({ sop }: { sop: OpsSop }) {
  const { c } = useTheme();
  const teams = useTeams().data ?? [];
  const collection = useOpsLibrary("").data?.collections.find((col) => col.id === sop.collectionId);
  return (
    <View className="flex-row gap-3.5 px-4 pb-1 pt-4">
      <OpsTile icon={sop.icon} color={sop.color} size={56} />
      <View className="min-w-0 flex-1">
        {collection ? <Text className="text-2xs font-semibold text-muted">{`${collection.icon} ${collection.name}`}</Text> : null}
        <Text accessibilityRole="header" className="text-xl font-semibold leading-tight text-fg">
          {sop.title}
        </Text>
        {sop.summary ? <Text className="mt-1 text-md text-muted">{sop.summary}</Text> : null}
        <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
          <OpsChip label={teamsLabel(sop, teams)} />
          {sop.status === "draft" ? <OpsChip label="Draft" /> : null}
          {sop.status === "archived" ? <OpsChip label="Archived" /> : null}
          {sop.mustRead ? <OpsChip label="Must read" tone="brand" /> : null}
          {sop.version > 0 ? <OpsChip label={`v${sop.version}`} /> : null}
        </View>
        {sop.owner || sop.reviewDueAt ? (
          <Text style={{ color: sop.reviewOverdue ? c.danger : c.textFaint }} className="mt-1.5 text-2xs">
            {[
              sop.owner ? `Owner: ${sop.owner.name}` : null,
              sop.reviewDueAt ? `${sop.reviewOverdue ? "Review overdue since" : "Next review"} ${shortDate(sop.reviewDueAt)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Banners({ sop }: { sop: OpsSop }) {
  const { c } = useTheme();
  const toast = useToast();
  const canEdit = !!useOpsStatus().data?.canEdit;
  const ack = useOpsMutation(() => api.ackOpsSop(sop.id));
  const reviewed = useOpsMutation(() => api.reviewedOpsSop(sop.id));
  return (
    <View className="gap-2 px-4 pt-3">
      {sop.status === "draft" ? (
        <View style={{ backgroundColor: c.surface2 }} className="rounded-12 px-3.5 py-2.5">
          <Text className="text-sm text-fg">
            <Text className="font-semibold">Draft</Text> — only admins and managers can see this. Publish it on the web when it's ready.
          </Text>
        </View>
      ) : null}
      {sop.needsMyAck ? (
        <View style={{ backgroundColor: c.amberTint, borderColor: c.amber }} className="gap-2.5 rounded-16 border px-3.5 py-3">
          <Text className="text-md text-fg">
            <Text className="font-semibold">{sop.myAck ? `Updated to version ${sop.version}` : "This is a must-read"}</Text>
            {sop.myAck ? ` — you confirmed v${sop.myAck.version}. Read what's changed, then confirm again.` : " — read it through, then confirm you have."}
          </Text>
          <Touchable
            feel="slab"
            disabled={ack.isPending}
            onPress={() =>
              ack.mutate(undefined, {
                onSuccess: () => {
                  haptics.success();
                  toast({ text: "Thanks — confirmed" });
                },
                onError: (e) => toast({ text: errText(e), tone: "error" }),
              })
            }
            accessibilityRole="button"
            accessibilityLabel="I've read this"
            style={{ backgroundColor: c.brand, opacity: ack.isPending ? 0.6 : 1 }}
            className="flex-row items-center justify-center gap-2 rounded-12 py-2.5"
          >
            <CheckIcon size={16} color="#fff" />
            <Text className="text-md font-semibold text-white">I've read this</Text>
          </Touchable>
        </View>
      ) : null}
      {sop.mustRead && sop.myAck && !sop.needsMyAck && sop.myAck.version === sop.version ? (
        <View style={{ backgroundColor: c.brandTint }} className="flex-row items-center gap-2 rounded-12 px-3.5 py-2.5">
          <CheckIcon size={15} color={c.brandStrong} />
          <Text style={{ color: c.brandStrong }} className="flex-1 text-sm font-medium">
            {`You confirmed version ${sop.version} ${relativeTime(sop.myAck.at)}.`}
          </Text>
        </View>
      ) : null}
      {canEdit && sop.reviewOverdue ? (
        <View style={{ backgroundColor: c.dangerTint }} className="gap-2 rounded-16 px-3.5 py-3">
          <Text className="text-sm text-fg">
            <Text className="font-semibold">Due for review</Text> — is this still how it's done?
          </Text>
          <Touchable
            feel="chip"
            onPress={() =>
              reviewed.mutate(undefined, {
                onSuccess: (s) => toast({ text: s.reviewDueAt ? `Reviewed — next ${shortDate(s.reviewDueAt)}` : "Reviewed" }),
                onError: (e) => toast({ text: errText(e), tone: "error" }),
              })
            }
            accessibilityRole="button"
            style={{ backgroundColor: c.surface, borderColor: c.border }}
            className="self-start rounded-full border px-3.5 py-1.5"
          >
            <Text className="text-sm font-semibold text-fg">Still right — mark reviewed</Text>
          </Touchable>
        </View>
      ) : null}
    </View>
  );
}

function Steps({ sop, onZoom }: { sop: OpsSop; onZoom: (url: string) => void }) {
  const { c } = useTheme();
  const toast = useToast();
  const [checklist, setChecklist] = useState(sop.myChecklist.length > 0);
  const [done, setDone] = useState<number[]>(sop.myChecklist);
  useEffect(() => setDone(sop.myChecklist), [sop.id, sop.myChecklist]);
  const save = useOpsMutation((next: number[]) => api.setOpsChecklist(sop.id, next));
  const progress = opsProgress(sop.steps.length, done);
  const accent = sop.color;

  const toggle = (i: number) => {
    haptics.select();
    const before = done;
    const next = done.includes(i) ? done.filter((x) => x !== i) : [...done, i].sort((a, b) => a - b);
    setDone(next);
    save.mutate(next, {
      onError: (e) => {
        setDone(before);
        toast({ text: errText(e), tone: "error" });
      },
    });
  };

  return (
    <Section
      title={`Steps · ${sop.steps.length}`}
      right={
        <View className="flex-row items-center gap-2">
          <Text className="text-sm text-muted">Checklist</Text>
          <Switch
            value={checklist}
            onValueChange={setChecklist}
            accessibilityLabel="Checklist mode"
            trackColor={{ true: c.brand, false: c.surface2 }}
            thumbColor="#fff"
          />
        </View>
      }
    >
      {checklist ? (
        <View className="flex-row items-center gap-3 px-4 pb-2" accessibilityLiveRegion="polite">
          <View style={{ backgroundColor: c.surface2 }} className="h-2 flex-1 overflow-hidden rounded-full">
            <View style={{ width: `${progress.pct}%`, backgroundColor: accent }} className="h-full rounded-full" />
          </View>
          <Text className="text-sm font-semibold text-fg">
            {progress.done === progress.total ? "All done 🎉" : `${progress.done} of ${progress.total}`}
          </Text>
          {progress.done > 0 ? (
            <Touchable
              feel="chip"
              onPress={() => {
                setDone([]);
                save.mutate([]);
              }}
              accessibilityRole="button"
              accessibilityLabel="Reset checklist"
              hitSlop={8}
            >
              <Text style={{ color: c.brand }} className="text-sm font-semibold">
                Reset
              </Text>
            </Touchable>
          ) : null}
        </View>
      ) : null}
      <View className="gap-2 px-4">
        {sop.steps.map((s, i) => {
          const ticked = checklist && done.includes(i);
          const Body = (
            <>
              <View
                style={{
                  backgroundColor: ticked ? accent : checklist ? c.surface : c.surface2,
                  borderColor: checklist ? accent : "transparent",
                  borderWidth: checklist ? 2 : 0,
                }}
                className="h-7 w-7 items-center justify-center rounded-full"
              >
                {ticked ? <CheckIcon size={15} color="#fff" /> : <Text className="text-sm font-bold text-fg">{i + 1}</Text>}
              </View>
              <View className="min-w-0 flex-1 gap-2">
                <Text
                  style={[{ paddingTop: 3 }, ticked ? { textDecorationLine: "line-through", color: c.textMuted } : null]}
                  className="text-md leading-snug text-fg"
                >
                  {s.text}
                </Text>
                {s.imageUrl ? (
                  <Pressable onPress={() => onZoom(s.imageUrl!)} accessibilityRole="imagebutton" accessibilityLabel={`Picture for step ${i + 1}`}>
                    <Image source={mediaSource(s.imageUrl)} contentFit="cover" style={{ width: "100%", height: 160, borderRadius: 10 }} />
                  </Pressable>
                ) : null}
                {s.link ? (
                  <Touchable
                    feel="chip"
                    onPress={() => void Linking.openURL(s.link!)}
                    accessibilityRole="link"
                    style={{ backgroundColor: c.brandTint }}
                    className="flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1"
                  >
                    <LinkIcon size={13} color={c.brandStrong} />
                    <Text style={{ color: c.brandStrong }} className="text-sm font-semibold">
                      {hostOf(s.link)}
                    </Text>
                  </Touchable>
                ) : null}
              </View>
            </>
          );
          const style = { backgroundColor: ticked ? c.surface2 : c.surface, borderColor: c.border };
          return checklist ? (
            <Touchable
              key={i}
              feel="row"
              onPress={() => toggle(i)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: ticked }}
              accessibilityLabel={`Step ${i + 1}: ${s.text}`}
              style={style}
              className="flex-row gap-3 rounded-16 border px-3.5 py-3"
            >
              {Body}
            </Touchable>
          ) : (
            <View key={i} style={style} className="flex-row gap-3 rounded-16 border px-3.5 py-3">
              {Body}
            </View>
          );
        })}
      </View>
    </Section>
  );
}

function HistorySheet({ sop, onClose }: { sop: OpsSop; onClose: () => void }) {
  const { c } = useTheme();
  const insets = useInsets();
  const versions = useOpsVersions(sop.id);
  const list = versions.data ?? [];
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ backgroundColor: c.bg, paddingBottom: insets.bottom }} className="flex-1">
        <View style={{ borderBottomColor: c.border }} className="flex-row items-center border-b px-4 py-3">
          <Text className="flex-1 text-lg font-semibold text-fg">Version history</Text>
          <Touchable feel="chip" onPress={onClose} accessibilityRole="button" hitSlop={10}>
            <Text style={{ color: c.brand }} className="text-md font-semibold">
              Done
            </Text>
          </Touchable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
          {versions.isLoading ? <Text className="text-md text-muted">Loading…</Text> : null}
          {list.map((v, i) => (
            <VersionRow
              key={v.version}
              v={v}
              prev={list[i + 1] ?? null}
              current={v.version === sop.version}
              open={open === v.version}
              onToggle={() => setOpen(open === v.version ? null : v.version)}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function VersionRow({ v, prev, current, open, onToggle }: { v: OpsRevision; prev: OpsRevision | null; current: boolean; open: boolean; onToggle: () => void }) {
  const { c } = useTheme();
  const changes = describeOpsChanges(prev, v);
  return (
    <View style={{ backgroundColor: c.surface, borderColor: c.border }} className="overflow-hidden rounded-16 border">
      <Touchable feel="row" onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} className="flex-row items-start gap-3 px-3.5 py-3">
        <View style={{ backgroundColor: current ? c.brand : c.surface2 }} className="rounded-full px-2 py-0.5">
          <Text style={{ color: current ? "#fff" : c.text }} className="text-2xs font-bold">{`v${v.version}`}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-md font-semibold text-fg">{v.note || changes[0] || "No visible changes"}</Text>
          {changes.length ? <Text className="text-2xs text-muted">{changes.join(" · ")}</Text> : null}
          <Text style={{ color: c.textFaint }} className="text-2xs">
            {`${v.publishedBy?.name ?? "Someone"} · ${shortDate(v.publishedAt)}${current ? " · current" : ""}`}
          </Text>
        </View>
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }} className="pt-1">
          <ChevronRight size={14} color={c.textFaint} />
        </View>
      </Touchable>
      {open ? (
        <View style={{ borderTopColor: c.border }} className="gap-1.5 border-t px-3.5 py-3">
          <Text className="text-md font-semibold text-fg">{v.title}</Text>
          {v.warnings ? (
            <Text style={{ color: c.danger }} className="text-md">
              {v.warnings}
            </Text>
          ) : null}
          {v.steps.map((s, j) => (
            <Text key={j} className="text-md text-fg">{`${j + 1}. ${s.text}`}</Text>
          ))}
          {v.body ? <KnowledgeView html={v.body} /> : null}
        </View>
      ) : null}
    </View>
  );
}
