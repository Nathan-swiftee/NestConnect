import { useMemo, useState } from "react";
import { ScrollView, Switch, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { api, useAccountMutation, usePeople, type ApiError } from "@ding/client";
import {
  SUGGESTED_SOP_CATEGORIES,
  type Account,
  type AccountContact,
  type AccountNote,
  type AccountResource,
  type AccountSop,
  type AccountStatus,
  type SopStatus,
} from "@ding/schemas";
import { ChevronDown, PlusIcon, TrashIcon, XIcon } from "../icons";
import { haptics } from "../haptics";
import { useTheme } from "../theme";
import { useInsets } from "../insets";
import { hasFormatting, htmlToKnowledgeText, knowledgeTextToHtml } from "../knowledge-text";
import { PeoplePicker } from "./PeoplePicker";
import { TagEditor } from "./TagEditor";
import { TAB_BAR_H } from "./TabBar";
import { Touchable } from "./Touchable";
import { useToast } from "./Toast";

/**
 * The organisation forms, on a phone: the same fields as the web's, one
 * screen each, with Save in the header where a thumb finds it and the
 * keyboard can't cover it.
 *
 * Full-screen layers over the organisation rather than sheets: several of
 * these are long (an SOP is a title, warnings, any number of steps and the
 * detailed instructions), and they're opened from a screen that is already a
 * layer over the Customers tab — a stack of views, not a stack of modals.
 */

const errText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/* --------------------------------- shell --------------------------------- */

export function FormScreen({
  title,
  onCancel,
  action,
  children,
}: {
  title: string;
  onCancel: () => void;
  action?: { label: string; disabled?: boolean; onPress: () => void };
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  const insets = useInsets();
  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="absolute inset-0">
      <ScreenHeader title={title} onClose={onCancel} closeLabel="Cancel" action={action} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          paddingTop: 16,
          paddingHorizontal: 16,
          gap: 14,
          paddingBottom: insets.bottom + 40 + TAB_BAR_H,
        }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function ScreenHeader({
  title,
  onClose,
  closeLabel,
  action,
  extra,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  action?: { label: string; disabled?: boolean; onPress: () => void };
  extra?: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{ borderBottomColor: c.border, backgroundColor: c.surface }}
      className="flex-row items-center gap-2 border-b px-3 py-2.5"
    >
      <Touchable
        feel="chip"
        borderless
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        hitSlop={10}
        style={{ backgroundColor: c.surface2 }}
        className="h-8 w-8 items-center justify-center rounded-full"
      >
        <XIcon size={16} color={c.textMuted} />
      </Touchable>
      <Text numberOfLines={1} className="flex-1 text-lg font-semibold text-fg">
        {title}
      </Text>
      {extra}
      {action ? (
        <Touchable
          feel="slab"
          onPress={action.onPress}
          disabled={action.disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!action.disabled }}
          style={{
            backgroundColor: c.brand,
            opacity: action.disabled ? 0.5 : 1,
          }}
          className="rounded-full px-4 py-1.5"
        >
          <Text className="text-md font-semibold text-white">{action.label}</Text>
        </Touchable>
      ) : null}
    </View>
  );
}

/* --------------------------------- fields --------------------------------- */

export function Input({ label, hint, ...props }: React.ComponentProps<typeof TextInput> & { label: string; hint?: string }) {
  const { c } = useTheme();
  return (
    <View className="gap-1.5">
      <Text accessibilityElementsHidden importantForAccessibility="no" className="text-sm font-medium text-muted">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.textFaint}
        textAlignVertical={props.multiline ? "top" : "center"}
        style={[
          { color: c.text, borderColor: c.border, backgroundColor: c.surface2 },
          props.multiline ? { minHeight: 88 } : null,
        ]}
        className="rounded-12 border px-3.5 py-3 text-md"
        {...props}
      />
      {hint ? <Text className="text-2xs text-muted">{hint}</Text> : null}
    </View>
  );
}

/** One of a few: the phone's select. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  const { c } = useTheme();
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-muted">{label}</Text>
      <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Touchable
              feel="chip"
              key={o.value || "none"}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={o.label}
              style={{
                backgroundColor: on ? c.brand : c.surface2,
                borderColor: on ? c.brand : c.border,
              }}
              className="rounded-full border px-3 py-1.5"
            >
              <Text style={{ color: on ? "#fff" : c.text }} className="text-sm font-medium">
                {o.label}
              </Text>
            </Touchable>
          );
        })}
      </View>
    </View>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{ backgroundColor: c.surface2, borderColor: c.border }}
      className="flex-row items-center gap-3 rounded-12 border px-3.5 py-3"
    >
      <View className="flex-1">
        <Text className="text-md text-fg">{label}</Text>
        {hint ? <Text className="text-2xs text-muted">{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: c.brand, false: c.border }} />
    </View>
  );
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <Text accessibilityLiveRegion="polite" className="text-sm text-danger">
      {text}
    </Text>
  ) : null;
}

/** Plain text that becomes the web's rich text — and says what that costs. */
function KnowledgeInput({
  label,
  value,
  onChange,
  original,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  original: string;
  placeholder?: string;
}) {
  const styled = hasFormatting(original);
  return (
    <Input
      label={label}
      value={value}
      onChangeText={onChange}
      multiline
      placeholder={placeholder}
      hint={
        "A blank line starts a new paragraph; “- ” a bullet; “1. ” a numbered step." +
        (styled
          ? " This was written with bold, links or headings on the web — they're kept unless you change the text here."
          : "")
      }
    />
  );
}

/* ------------------------------ organisation ------------------------------ */

const STATUS_OPTIONS: Array<{ value: AccountStatus; label: string }> = [
  { value: "active", label: "Active" },
  { value: "prospect", label: "Prospect" },
  { value: "inactive", label: "Inactive" },
];

/**
 * Create or edit an organisation: every field the web has. Creating also
 * offers the customer list to tick the people who work there.
 */
export function AccountForm({
  account,
  onClose,
  onSaved,
  onOpenExisting,
}: {
  account: Account | null;
  onClose: () => void;
  onSaved: (id: string) => void;
  onOpenExisting: (id: string) => void;
}) {
  const toast = useToast();
  const people = usePeople();
  const [name, setName] = useState(account?.name ?? "");
  const [legalName, setLegalName] = useState(account?.legalName ?? "");
  const [reference, setReference] = useState(account?.reference ?? "");
  const [summary, setSummary] = useState(account?.summary ?? "");
  const [overview, setOverview] = useState(account?.overview ?? "");
  const [status, setStatus] = useState<AccountStatus>(account?.status ?? "active");
  const [tags, setTags] = useState<string[]>(account?.tags ?? []);
  const [ownerUserId, setOwner] = useState<string>(account?.ownerUserId ?? "");
  const [phone, setPhone] = useState(account?.phone ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [website, setWebsite] = useState(account?.website ?? "");
  const [address, setAddress] = useState(account?.address ?? "");
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);

  const fields = () => ({
    name: name.trim(),
    legalName: legalName.trim() || null,
    reference: reference.trim() || null,
    summary: summary.trim(),
    overview: overview.trim(),
    status,
    tags,
    ownerUserId: ownerUserId || null,
    phone: phone.trim() || null,
    email: email.trim() || null,
    website: website.trim() ? (/^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`) : null,
    address: address.trim() || null,
  });
  const save = useAccountMutation((force: boolean) =>
    account
      ? api.updateAccount(account.id, fields())
      : api.createAccount({
          ...fields(),
          force,
          contactIds: members.length ? members : undefined,
        }),
  );

  const submit = (force = false) => {
    if (!name.trim()) {
      setError("An organisation needs a name.");
      return;
    }
    setError(null);
    save.mutate(force, {
      onSuccess: (a) => {
        haptics.success();
        toast({ text: account ? "Saved" : `${a.name} created` });
        onSaved(a.id);
      },
      onError: (err) => {
        const e = err as ApiError;
        const found = (e.body as { details?: { existing?: { id: string; name: string } } } | undefined)?.details?.existing;
        if (e.status === 409 && found) setExisting(found);
        else haptics.error();
        setError(errText(err, "Couldn't save. Please try again."));
      },
    });
  };

  const owners = [
    { value: "", label: "No one" },
    ...(people.data ?? []).map((p) => ({
      value: p.user.id,
      label: p.user.name,
    })),
  ];

  return (
    <FormScreen
      title={account ? "Edit organisation" : "New organisation"}
      onCancel={onClose}
      action={{
        label: save.isPending ? "Saving…" : account ? "Save" : "Create",
        disabled: !name.trim() || save.isPending,
        onPress: () => submit(),
      }}
    >
      <Input
        label="Name"
        value={name}
        onChangeText={(t) => {
          setName(t);
          setExisting(null);
          setError(null);
        }}
        autoFocus={!account}
        placeholder="ABC Magazines"
      />
      {error ? (
        existing ? (
          <ExistingOffer
            message={error}
            name={existing.name}
            onOpen={() => onOpenExisting(existing.id)}
            onForce={account ? undefined : () => submit(true)}
          />
        ) : (
          <Problem text={error} />
        )
      ) : null}
      <Input label="Legal name (optional)" value={legalName} onChangeText={setLegalName} placeholder="ABC Magazines Limited" />
      <Input
        label="Account reference (optional)"
        value={reference}
        onChangeText={setReference}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="SW-1042"
      />
      <Input
        label="One line about them (optional)"
        value={summary}
        onChangeText={setSummary}
        placeholder="Weekly magazine distribution, London"
      />
      <Input
        label="Overview (optional)"
        value={overview}
        onChangeText={setOverview}
        multiline
        placeholder="Who they are, what we do for them, what matters to them."
      />
      <Choice label="Status" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      <Choice label="Account owner" options={owners} value={ownerUserId} onChange={setOwner} />
      <View className="gap-1.5">
        <Text className="text-sm font-medium text-muted">Tags</Text>
        <TagEditor tags={tags} suggestions={[]} onChange={setTags} />
      </View>
      <Input label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Input
        label="Email (optional)"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Input
        label="Website (optional)"
        value={website}
        onChangeText={setWebsite}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="abcmagazines.co.uk"
      />
      <Input label="Address (optional)" value={address} onChangeText={setAddress} multiline />
      {account ? null : (
        <View className="-mx-4 gap-1.5">
          <Text className="px-4 text-sm font-medium text-muted">
            {members.length ? `People at this organisation · ${members.length} chosen` : "People at this organisation (optional)"}
          </Text>
          <PeoplePicker selected={members} onChange={setMembers} />
        </View>
      )}
    </FormScreen>
  );
}

function ExistingOffer({
  message,
  name,
  onOpen,
  onForce,
}: {
  message: string;
  name: string;
  onOpen: () => void;
  onForce?: () => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ backgroundColor: c.amberTint }} className="gap-2 rounded-12 px-3 py-2.5">
      <Text accessibilityLiveRegion="polite" className="text-md text-fg">
        {message}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Touchable
          feel="slab"
          onPress={onOpen}
          accessibilityRole="button"
          style={{ backgroundColor: c.brand }}
          className="rounded-12 px-3.5 py-2"
        >
          <Text className="text-md font-semibold text-white">Open {name}</Text>
        </Touchable>
        {onForce ? (
          <Touchable
            feel="chip"
            onPress={onForce}
            accessibilityRole="button"
            style={{ borderColor: c.border }}
            className="rounded-12 border px-3.5 py-2"
          >
            <Text className="text-md font-medium text-fg">It's a different company</Text>
          </Touchable>
        ) : null}
      </View>
    </View>
  );
}

/* ----------------------------------- SOPs ----------------------------------- */

/**
 * An SOP: title, category, when to use it, warnings, the steps in order, the
 * detailed instructions and its status. Every save of an existing one is a new
 * version; the old one stays in its history.
 */
export function SopForm({
  accountId,
  sop,
  categories,
  isManager,
  onClose,
  onSaved,
}: {
  accountId: string;
  sop: AccountSop | null;
  categories: string[];
  isManager: boolean;
  onClose: () => void;
  onSaved: (sop: AccountSop) => void;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const [title, setTitle] = useState(sop?.title ?? "");
  const [category, setCategory] = useState(sop?.category ?? "General");
  const [summary, setSummary] = useState(sop?.summary ?? "");
  const [warnings, setWarnings] = useState(sop?.warnings ?? "");
  const [steps, setSteps] = useState<string[]>(sop?.steps.length ? sop.steps.map((s) => s.text) : [""]);
  const startText = useMemo(() => htmlToKnowledgeText(sop?.body ?? ""), [sop]);
  const [bodyText, setBodyText] = useState(startText);
  const [status, setStatus] = useState<SopStatus>(sop?.status ?? "active");
  const [error, setError] = useState<string | null>(null);
  const cats = useMemo(() => [...new Set([...categories, ...SUGGESTED_SOP_CATEGORIES])], [categories]);

  const save = useAccountMutation(() => {
    const input = {
      title: title.trim(),
      category: category.trim() || "General",
      summary: summary.trim(),
      warnings: warnings.trim(),
      steps: steps
        .map((t) => t.trim())
        .filter(Boolean)
        .map((text) => ({ text })),
      // Untouched instructions keep the web's formatting exactly.
      ...(bodyText === startText && sop ? {} : { body: knowledgeTextToHtml(bodyText) }),
      status,
    };
    return sop ? api.updateAccountSop(accountId, sop.id, input) : api.createAccountSop(accountId, input);
  });

  const move = (i: number, d: -1 | 1) =>
    setSteps((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });

  const statuses: Array<{ value: SopStatus; label: string }> = [
    { value: "active", label: "Active" },
    { value: "draft", label: "Draft" },
    ...(isManager || sop?.status === "archived" ? [{ value: "archived" as const, label: "Archived" }] : []),
  ];

  return (
    <FormScreen
      title={sop ? `Edit SOP · v${sop.version}` : "New SOP"}
      onCancel={onClose}
      action={{
        label: save.isPending ? "Saving…" : sop ? "Save" : "Add",
        disabled: !title.trim() || save.isPending,
        onPress: () =>
          save.mutate(undefined, {
            onSuccess: (s) => {
              haptics.success();
              toast({
                text: sop ? `Saved — version ${s.version}` : "SOP added",
              });
              onSaved(s);
            },
            onError: (err) => setError(errText(err, "Couldn't save the SOP")),
          }),
      }}
    >
      <Input label="Title" value={title} onChangeText={setTitle} autoFocus={!sop} placeholder="Weekly Magazine Distribution" />
      <Problem text={error} />
      <View className="gap-1.5">
        <Input label="Category" value={category} onChangeText={setCategory} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 6 }}
        >
          {cats.map((cat) => (
            <Touchable
              feel="chip"
              key={cat}
              onPress={() => setCategory(cat)}
              accessibilityRole="button"
              style={{
                backgroundColor: cat === category ? c.brandTint : c.surface2,
              }}
              className="rounded-full px-3 py-1"
            >
              <Text
                style={{
                  color: cat === category ? c.brandStrong : c.textMuted,
                }}
                className="text-2xs font-medium"
              >
                {cat}
              </Text>
            </Touchable>
          ))}
        </ScrollView>
      </View>
      <Input
        label="When to use it (optional)"
        value={summary}
        onChangeText={setSummary}
        placeholder="Every Thursday's magazine run, booked the day before"
      />
      <Input
        label="Warnings — shown first, in red (optional)"
        value={warnings}
        onChangeText={setWarnings}
        multiline
        placeholder="Only approved couriers. Never split the pallet."
      />

      <View className="gap-1.5">
        <Text className="text-sm font-medium text-muted">Steps — read as a numbered checklist</Text>
        {steps.map((s, i) => (
          <View key={i} className="flex-row items-center gap-1.5">
            <View style={{ backgroundColor: c.surface2 }} className="h-7 w-7 items-center justify-center rounded-full">
              <Text className="text-2xs font-semibold text-muted">{i + 1}</Text>
            </View>
            <TextInput
              value={s}
              onChangeText={(t) => setSteps((all) => all.map((x, j) => (j === i ? t : x)))}
              placeholder="What to do"
              placeholderTextColor={c.textFaint}
              accessibilityLabel={`Step ${i + 1}`}
              multiline
              style={{
                color: c.text,
                borderColor: c.border,
                backgroundColor: c.surface2,
              }}
              className="flex-1 rounded-12 border px-3 py-2.5 text-md"
            />
            <IconButton label="Move up" disabled={i === 0} onPress={() => move(i, -1)}>
              <View style={{ transform: [{ rotate: "180deg" }] }}>
                <ChevronDown size={15} color={i === 0 ? c.border : c.textMuted} />
              </View>
            </IconButton>
            <IconButton label="Move down" disabled={i === steps.length - 1} onPress={() => move(i, 1)}>
              <ChevronDown size={15} color={i === steps.length - 1 ? c.border : c.textMuted} />
            </IconButton>
            <IconButton
              label="Remove step"
              onPress={() => setSteps((all) => (all.length > 1 ? all.filter((_, j) => j !== i) : [""]))}
            >
              <TrashIcon size={15} color={c.textMuted} />
            </IconButton>
          </View>
        ))}
        <Touchable
          feel="chip"
          onPress={() => setSteps((s) => [...s, ""])}
          accessibilityRole="button"
          className="flex-row items-center gap-1.5 self-start py-1.5"
        >
          <PlusIcon size={14} color={c.brand} />
          <Text style={{ color: c.brand }} className="text-md font-semibold">
            Add step
          </Text>
        </Touchable>
      </View>

      <KnowledgeInput
        label="Detailed instructions (optional)"
        value={bodyText}
        onChange={setBodyText}
        original={sop?.body ?? ""}
        placeholder="Anything the steps don't cover: contacts, exceptions, examples…"
      />
      <Choice label="Status" options={statuses} value={status} onChange={setStatus} />
      <Text className="text-2xs text-muted">
        {status === "active"
          ? "Active: this is how it's done, and it shows beside their conversations."
          : status === "draft"
            ? "Draft: kept on the profile, not shown as current yet."
            : "Archived: no longer used."}
      </Text>
    </FormScreen>
  );
}

function IconButton({
  label,
  onPress,
  disabled,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Touchable
      feel="chip"
      borderless
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      className="h-8 w-8 items-center justify-center"
    >
      {children}
    </Touchable>
  );
}

/* ---------------------------------- notes ---------------------------------- */

export function NoteForm({ accountId, note, onClose }: { accountId: string; note: AccountNote | null; onClose: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(note?.title ?? "");
  const [category, setCategory] = useState(note?.category ?? "General");
  const startText = useMemo(() => htmlToKnowledgeText(note?.body ?? ""), [note]);
  const [bodyText, setBodyText] = useState(startText);
  const [error, setError] = useState<string | null>(null);
  const save = useAccountMutation(() => {
    const input = {
      title: title.trim(),
      category: category.trim() || "General",
      ...(bodyText === startText && note ? {} : { body: knowledgeTextToHtml(bodyText) }),
    };
    return note
      ? api.updateAccountNote(accountId, note.id, input)
      : api.createAccountNote(accountId, { ...input, body: input.body ?? "" });
  });
  return (
    <FormScreen
      title={note ? "Edit note" : "New customer note"}
      onCancel={onClose}
      action={{
        label: save.isPending ? "Saving…" : "Save",
        disabled: !bodyText.trim() || save.isPending,
        onPress: () =>
          save.mutate(undefined, {
            onSuccess: () => {
              haptics.success();
              toast({ text: note ? "Note saved" : "Note added" });
              onClose();
            },
            onError: (err) => setError(errText(err, "Couldn't save the note")),
          }),
      }}
    >
      <Text className="text-2xs text-muted">
        Lasting knowledge about this customer — preferences, expectations, background. For something about one conversation, use a
        note in that conversation.
      </Text>
      <Input label="Title (optional)" value={title} onChangeText={setTitle} placeholder="Communication preferences" />
      <Input label="Category" value={category} onChangeText={setCategory} />
      <KnowledgeInput
        label="Note"
        value={bodyText}
        onChange={setBodyText}
        original={note?.body ?? ""}
        placeholder="Prefers WhatsApp; never call before 9am…"
      />
      <Problem text={error} />
    </FormScreen>
  );
}

/* -------------------------------- resources -------------------------------- */

const KIND_OPTIONS: Array<{ value: AccountResource["kind"]; label: string }> = [
  { value: "link", label: "Link" },
  { value: "file", label: "Document" },
  { value: "app", label: "External app" },
];

/** A link, an external app (with how to use it), or a document from the phone. */
export function ResourceForm({
  accountId,
  resource,
  sops,
  onClose,
}: {
  accountId: string;
  resource: AccountResource | null;
  sops: AccountSop[];
  onClose: () => void;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const [kind, setKind] = useState<AccountResource["kind"]>(resource?.kind ?? "link");
  const [title, setTitle] = useState(resource?.title ?? "");
  const [description, setDescription] = useState(resource?.description ?? "");
  const [category, setCategory] = useState(resource?.category ?? "General");
  const [url, setUrl] = useState(resource?.url ?? "");
  const [instructions, setInstructions] = useState(resource?.instructions ?? "");
  const [sopId, setSopId] = useState(resource?.sopId ?? "");
  const [file, setFile] = useState<{ id: string; name: string } | null>(
    resource?.attachmentId ? { id: resource.attachmentId, name: resource.fileName ?? "File" } : null,
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useAccountMutation(() => {
    const href = url.trim() && !/^https?:\/\//i.test(url.trim()) ? `https://${url.trim()}` : url.trim();
    if (resource) {
      return api.updateAccountResource(accountId, resource.id, {
        title: title.trim(),
        description: description.trim(),
        category: category.trim() || "General",
        instructions: instructions.trim(),
        sopId: sopId || null,
        ...(resource.kind !== "file" ? { url: href } : {}),
      });
    }
    return api.createAccountResource(accountId, {
      kind,
      title: title.trim(),
      description: description.trim(),
      category: category.trim() || "General",
      url: kind === "file" ? null : href,
      instructions: instructions.trim(),
      attachmentId: kind === "file" ? (file?.id ?? null) : null,
      sopId: sopId || null,
    });
  });

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    setUploading(true);
    setError(null);
    try {
      const att = await api.uploadMedia(
        {
          uri: a.uri,
          name: a.name,
          type: a.mimeType ?? "application/octet-stream",
        },
        { filename: a.name, kind: "document" },
      );
      setFile({ id: att.id, name: a.name });
      if (!title.trim()) setTitle(a.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setError(errText(err, "Upload failed"));
    } finally {
      setUploading(false);
    }
  };

  const valid = !!title.trim() && (kind === "file" ? !!file : !!url.trim());
  const sopOptions = [
    { value: "", label: "None" },
    ...sops.filter((s) => s.status !== "archived").map((s) => ({ value: s.id, label: s.title })),
  ];

  return (
    <FormScreen
      title={resource ? "Edit resource" : "Add a resource"}
      onCancel={onClose}
      action={{
        label: save.isPending ? "Saving…" : "Save",
        disabled: !valid || save.isPending || uploading,
        onPress: () =>
          save.mutate(undefined, {
            onSuccess: () => {
              haptics.success();
              toast({ text: resource ? "Saved" : "Added" });
              onClose();
            },
            onError: (err) => setError(errText(err, "Couldn't save")),
          }),
      }}
    >
      {resource ? null : <Choice label="Kind" options={KIND_OPTIONS} value={kind} onChange={setKind} />}
      {kind === "file" ? (
        <View className="gap-1.5">
          <Text className="text-sm font-medium text-muted">File</Text>
          <View
            style={{ backgroundColor: c.surface2, borderColor: c.border }}
            className="flex-row items-center gap-3 rounded-12 border px-3.5 py-3"
          >
            <Text numberOfLines={1} className={`flex-1 text-md ${file ? "font-semibold text-fg" : "text-muted"}`}>
              {file ? file.name : uploading ? "Uploading…" : "No file chosen"}
            </Text>
            {resource ? null : (
              <Touchable
                feel="chip"
                onPress={() => void pick()}
                disabled={uploading}
                accessibilityRole="button"
                style={{ borderColor: c.border }}
                className="rounded-full border px-3 py-1.5"
              >
                <Text className="text-sm font-medium text-fg">{file ? "Replace" : "Choose file"}</Text>
              </Touchable>
            )}
          </View>
        </View>
      ) : (
        <Input
          label="Web address"
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={kind === "app" ? "https://www.routexl.com" : "https://docs.google.com/…"}
        />
      )}
      <Problem text={error} />
      <Input
        label="Name"
        value={title}
        onChangeText={setTitle}
        placeholder={kind === "app" ? "RouteXL" : kind === "file" ? "Drop list template" : "Booking portal"}
      />
      <Input label="Category" value={category} onChangeText={setCategory} placeholder="Templates, Portals, Price lists…" />
      <Input label="What it is (optional)" value={description} onChangeText={setDescription} />
      {kind === "app" || instructions ? (
        <Input
          label="How to use it for this customer (optional)"
          value={instructions}
          onChangeText={setInstructions}
          multiline
          placeholder="Import their CSV, optimise, export to the dispatch sheet."
        />
      ) : null}
      {sops.length ? <Choice label="Goes with SOP (optional)" options={sopOptions} value={sopId} onChange={setSopId} /> : null}
    </FormScreen>
  );
}

/* ------------------------------ contact's role ------------------------------ */

export function RoleForm({ accountId, link, onClose }: { accountId: string; link: AccountContact; onClose: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState(link.role ?? "");
  const [department, setDepartment] = useState(link.department ?? "");
  const [notes, setNotes] = useState(link.notes ?? "");
  const [isPrimary, setPrimary] = useState(link.isPrimary);
  const [error, setError] = useState<string | null>(null);
  const save = useAccountMutation(() =>
    api.updateAccountContact(accountId, link.contactId, {
      role: role.trim() || null,
      department: department.trim() || null,
      notes: notes.trim() || null,
      isPrimary,
    }),
  );
  return (
    <FormScreen
      title={link.contact.displayName}
      onCancel={onClose}
      action={{
        label: save.isPending ? "Saving…" : "Save",
        disabled: save.isPending,
        onPress: () =>
          save.mutate(undefined, {
            onSuccess: () => {
              haptics.success();
              toast({ text: "Saved" });
              onClose();
            },
            onError: (err) => setError(errText(err, "Couldn't save")),
          }),
      }}
    >
      <Input label="Role" value={role} onChangeText={setRole} placeholder="Bookings Manager" />
      <Input label="Department (optional)" value={department} onChangeText={setDepartment} placeholder="Operations" />
      <Toggle label="Main contact" hint="One per organisation; shown first." value={isPrimary} onChange={setPrimary} />
      <Input
        label="Notes (optional)"
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder="Approves anything over £500. Off on Fridays."
      />
      <Problem text={error} />
    </FormScreen>
  );
}
