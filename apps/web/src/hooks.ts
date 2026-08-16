import { useCallback, useEffect, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ClientEvent,
  ServerEvent,
  type ConversationStatus,
  type ConversationWithMessages,
  type Priority,
  type CreateContactInput,
  type MergeContactsInput,
  type CreateGroupInput,
  type CreateInboxInput,
  type CreateLabelInput,
  type CreateTeamInput,
  type CreateTemplateInput,
  type CreateUserInput,
  type UpdateLabelInput,
  type ChannelType,
  type Message,
  type Notification,
  type UpdateContactInput,
  type UpdateInboxInput,
  type UpdateIntegrationSettingsInput,
  type UpdateMyPreferencesInput,
  type UpdateMyProfileInput,
  type ChangePasswordInput,
  type UpdateTeamInput,
  type UpdateTemplateInput,
  type UpdateUserInput,
  type UpdateWhatsAppBusinessProfileInput,
  type SendBroadcastInput,
  type AnalyticsRange,
} from "@ding/schemas";
import { api } from "./lib/api";
import { getSocket } from "./lib/socket";
import { isSoundOn, playReceived, playSent, subscribeSound, toggleSound } from "./lib/sound";
import { effectiveTheme } from "./lib/theme";

/** Statuses that mean an outbound message actually left our system — the point
 *  at which the "sent" cue should play (never on queued/sending/failed). */
const SENT_CUE_STATUSES = new Set<Message["status"]>(["sent", "delivered", "read"]);
/** Message ids we've already sounded, so the sent cue fires once per message
 *  (a message climbs sent → delivered → read, all as separate updates). */
const sentCuePlayed = new Set<string>();

export const useSession = () =>
  useQuery({ queryKey: ["session"], queryFn: api.session, retry: false, staleTime: 30_000 });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; password: string }) => api.login(v.email, v.password),
    onSuccess: (data) => {
      // A 2FA challenge isn't a session yet — the LoginScreen shows the code step.
      if ("twoFactorRequired" in data) return;
      qc.setQueryData(["session"], data);
      qc.invalidateQueries();
    },
  });
}

export function useLoginTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.loginTwoFactor(code),
    onSuccess: (data) => {
      qc.setQueryData(["session"], data);
      qc.invalidateQueries();
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(["session"], null);
      // Hard-navigate to the login screen. clear() re-triggers the active
      // ["session"] query, which can race and overwrite the null we just set
      // (bouncing back into the app); a full reload guarantees the app
      // re-initialises unauthenticated (the server has cleared the cookie).
      if (typeof window !== "undefined") window.location.assign("/");
    },
  });
}

export function useCreateInbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInboxInput) => api.createInbox(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["views"] });
      qc.invalidateQueries({ queryKey: ["inboxes"] });
    },
  });
}

export function useUpdateInbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: UpdateInboxInput }) => api.updateInbox(v.id, v.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inboxes"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

export function useDeleteInbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteInbox(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inboxes"] });
      qc.invalidateQueries({ queryKey: ["views"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useRerouteInbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rerouteInbox(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGroupInput) => api.createGroup(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["views"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useRemoveParticipant(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) => api.removeParticipant(conversationId, contactId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversation", conversationId] }),
  });
}

/** Revoke a group's invite link and get a fresh one (people re-join via the new link). */
export function useResetGroupInvite(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.resetGroupInvite(conversationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversation", conversationId] }),
  });
}

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: api.me });

/** The insights dashboard feed (admin/manager). Keeps the previous data on
 *  screen while a new range/filter loads, so the charts don't flash empty. */
export function useAnalytics(params: { range: AnalyticsRange; channel: string; teamId: string; agentUserId: string }) {
  return useQuery({
    queryKey: ["analytics", params.range, params.channel, params.teamId, params.agentUserId],
    queryFn: () => api.analytics(params),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** Update the current user's own personal settings (availability + signature). */
export function useUpdateMyPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMyPreferencesInput) => api.updateMyPreferences(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["people"] });
    },
  });
}

/** Update the current user's own profile (name, login email, photo). */
export function useUpdateMyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMyProfileInput) => api.updateMyProfile(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["people"] });
    },
  });
}

/** Change the current user's own password (current is re-verified server-side). */
export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api.changePassword(input),
  });
}

/* ---- two-factor auth ---- */
export const useTwoFactorStatus = () => useQuery({ queryKey: ["2fa-status"], queryFn: api.twoFactorStatus });

/* ---- signed-in sessions ("where you're logged in") ---- */
export const useSessions = () => useQuery({ queryKey: ["sessions"], queryFn: api.sessions });
export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}
export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.revokeOtherSessions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}
export const useViews = () => useQuery({ queryKey: ["views"], queryFn: api.views });

/* ---- Bell notifications ---- */
export const useNotifications = () =>
  useQuery({ queryKey: ["notifications"], queryFn: api.notifications });

/** Mark some (by id) or all notifications read; flips them locally right away. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => api.markNotificationsRead(ids),
    onMutate: (ids) => {
      qc.setQueryData<Notification[]>(["notifications"], (cur) =>
        cur?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
export const useInboxes = () => useQuery({ queryKey: ["inboxes"], queryFn: api.inboxes });
export const useTeams = () => useQuery({ queryKey: ["teams"], queryFn: api.teams });
export const usePeople = () => useQuery({ queryKey: ["people"], queryFn: api.people });

/* ---- integrations (Settings › Setup) ---- */
export const useIntegrations = () =>
  useQuery({ queryKey: ["integrations"], queryFn: api.getIntegrations });

export function useUpdateIntegrations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateIntegrationSettingsInput) => api.updateIntegrations(input),
    onSuccess: (data) => {
      qc.setQueryData(["integrations"], data);
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTeamInput) => api.createTeam(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: UpdateTeamInput }) => api.updateTeam(v.id, v.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTeam(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["inboxes"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["views"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useReorderTeams() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) => api.reorderTeams(orderedIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

/* ---- labels ---- */
export const useLabels = () => useQuery({ queryKey: ["labels"], queryFn: api.labels });

export function useCreateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLabelInput) => api.createLabel(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labels"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

export function useUpdateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: UpdateLabelInput }) => api.updateLabel(v.id, v.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labels"] });
      qc.invalidateQueries({ queryKey: ["views"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

export function useDeleteLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteLabel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labels"] });
      qc.invalidateQueries({ queryKey: ["views"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

export function useSetConversationLabels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; labelIds: string[] }) => api.setConversationLabels(v.id, v.labelIds),
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: ["conversation", v.id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.createUser(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people"] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: UpdateUserInput }) => api.updateUser(v.id, v.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["views"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
/* ---- customers (CRM) ---- */
export const useContacts = () => useQuery({ queryKey: ["contacts"], queryFn: api.contacts });
export const useContactDuplicates = () =>
  useQuery({ queryKey: ["contact-duplicates"], queryFn: api.contactDuplicates });

export function useMergeContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MergeContactsInput) => api.mergeContacts(input),
    onSuccess: () => {
      // Contacts, duplicate clusters and conversations (which moved to the
      // winner) all change on a merge.
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact-duplicates"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
export const useContact = (id: string | null) =>
  useQuery({
    queryKey: ["contact", id],
    queryFn: () => api.contact(id as string),
    enabled: !!id,
  });

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContactInput) => api.createContact(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: UpdateContactInput }) => api.updateContact(v.id, v.input),
    onSuccess: (_c, v) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact", v.id] });
      // Owner/tag edits can change routing, so refresh conversation-derived views too.
      qc.invalidateQueries({ queryKey: ["conversation"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

/** Permanently delete a customer (and their conversations) from the directory. */
export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteContact(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

/** Cursor-paginated conversation list. `data` is the flattened rows so far;
 *  call fetchNextPage() to load the next page (never the whole inbox at once). */
export const useConversations = (view: string) =>
  useInfiniteQuery({
    queryKey: ["conversations", view],
    queryFn: ({ pageParam }) => api.conversations(view, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    select: (d) => d.pages.flatMap((p) => p.items),
  });

/** Global conversation search (contact, subject, preview, message body), paginated. */
export const useSearchConversations = (q: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: ["search", q],
    queryFn: ({ pageParam }) => api.searchConversations(q, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && q.trim().length > 0,
    staleTime: 5000,
    placeholderData: keepPreviousData,
    select: (d) => d.pages.flatMap((p) => p.items),
  });

export const useConversation = (id: string | null) =>
  useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api.conversation(id as string),
    enabled: !!id,
  });

/** Load older thread history (scroll-up) and prepend it into the thread cache. */
export function useLoadOlderMessages(conversationId: string | null) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const loadOlder = useCallback(async () => {
    if (!conversationId) return;
    const current = qc.getQueryData<ConversationWithMessages>(["conversation", conversationId]);
    if (!current?.hasMoreMessages || current.messages.length === 0) return;
    setLoading(true);
    try {
      const before = String(current.messages[0].seq);
      const page = await api.olderMessages(conversationId, before);
      qc.setQueryData<ConversationWithMessages>(["conversation", conversationId], (prev) =>
        prev
          ? { ...prev, messages: [...page.items, ...prev.messages], hasMoreMessages: page.nextCursor != null }
          : prev,
      );
    } finally {
      setLoading(false);
    }
  }, [conversationId, qc]);
  return { loadOlder, loading };
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: string;
      body: string;
      internal?: boolean;
      attachmentIds?: string[];
      /** Send an approved WhatsApp template instead of free text (window closed). */
      template?: { id: string; params: string[] };
      /** Quote an earlier message so it threads as a WhatsApp reply. */
      quotedMsgId?: string;
      /** Rich HTML body for an email reply (sanitized server-side). */
      bodyHtml?: string;
      /** Subject line for an email send (sets the thread's subject). */
      subject?: string;
      /** Cc / Bcc recipients on an email reply. */
      cc?: string[];
      bcc?: string[];
      /** Reply on a channel other than the conversation's own (cross-channel). */
      channel?: ChannelType;
      /** Forward this email on to other people (fresh "Fwd:" thread, logged here). */
      forwardTo?: string[];
    }) =>
      api.sendMessage(v.id, v.body, v.internal ?? false, v.attachmentIds, {
        template: v.template,
        quotedMsgId: v.quotedMsgId,
        bodyHtml: v.bodyHtml,
        subject: v.subject,
        cc: v.cc,
        bcc: v.bcc,
        channel: v.channel,
        forwardTo: v.forwardTo,
      }),
    // Optimistically render a plain text/HTML reply immediately (skip when it
    // carries attachments or a template — those render from the server result).
    onMutate: async (v) => {
      if (v.template || v.attachmentIds?.length) return { tempId: undefined as string | undefined };
      await qc.cancelQueries({ queryKey: ["conversation", v.id] });
      const prev = qc.getQueryData<ConversationWithMessages>(["conversation", v.id]);
      if (!prev) return { tempId: undefined };
      const tempId = `temp_${Date.now()}`;
      const optimistic: Message = {
        id: tempId,
        conversationId: v.id,
        seq: (prev.messages[prev.messages.length - 1]?.seq ?? 0) + 1,
        direction: "out",
        authorType: "user",
        body: v.body,
        status: v.internal ? "sent" : "queued",
        internal: v.internal ?? false,
        messageType: "text",
        attachments: [],
        reactions: [],
        bodyHtml: v.bodyHtml,
        channel: v.channel,
        // Show "Forwarded to …" on the bubble immediately (the server echoes it).
        email: v.forwardTo?.length ? { forwardedTo: v.forwardTo } : undefined,
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData<ConversationWithMessages>(["conversation", v.id], {
        ...prev,
        messages: [...prev.messages, optimistic],
      });
      return { tempId };
    },
    onError: (_e, v) => {
      // Drop the optimistic bubble on failure; the thread refetch restores truth.
      qc.invalidateQueries({ queryKey: ["conversation", v.id] });
    },
    onSuccess: (msg, v, ctx) => {
      // Swap the temp bubble for the real message (also arrives via socket; dedup by id).
      qc.setQueryData<ConversationWithMessages>(["conversation", v.id], (cur) => {
        if (!cur) return cur;
        const withoutTemp = ctx?.tempId ? cur.messages.filter((m) => m.id !== ctx.tempId) : cur.messages;
        const exists = withoutTemp.some((m) => m.id === msg.id);
        return { ...cur, messages: exists ? withoutTemp : [...withoutTemp, msg] };
      });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

/** React to a message with an emoji (empty string removes the agent's reaction).
 *  The update also arrives over the socket, but we invalidate for instant feedback. */
export function useReact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { conversationId: string; messageId: string; emoji: string }) =>
      api.react(v.conversationId, v.messageId, v.emoji),
    onSuccess: (_msg, v) => {
      qc.invalidateQueries({ queryKey: ["conversation", v.conversationId] });
    },
  });
}

/** Retry a failed outbound send: re-queues the message for delivery. The status
 *  ticks then flow back over the socket (sending → sent | failed again). */
export function useRetryMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { conversationId: string; messageId: string }) =>
      api.retryMessage(v.conversationId, v.messageId),
    onSuccess: (_msg, v) => {
      qc.invalidateQueries({ queryKey: ["conversation", v.conversationId] });
    },
  });
}

/** Mark a conversation read: clears the unread badge and sends a WhatsApp read
 *  receipt (blue ticks) for the customer's latest message. Idempotent server-side. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["views"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useMarkUnread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markUnread(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["views"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

/* ---- WhatsApp message templates ---- */
export const useTemplates = () => useQuery({ queryKey: ["templates"], queryFn: api.templates });

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTemplateInput) => api.createTemplate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: UpdateTemplateInput }) => api.updateTemplate(v.id, v.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useSyncTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.syncTemplates(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

/* ---- WhatsApp business profile ---- */
/** Read a WhatsApp number's public business profile (loads once a number is picked). */
export const useWhatsappProfile = (inboxId: string | null) =>
  useQuery({
    queryKey: ["wa-profile", inboxId],
    queryFn: () => api.whatsappProfile(inboxId as string),
    enabled: !!inboxId,
    retry: false,
    staleTime: 30_000,
  });

/** Save the editable fields of a number's business profile back to Meta. */
export function useUpdateWhatsappProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { inboxId: string; input: UpdateWhatsAppBusinessProfileInput }) =>
      api.updateWhatsappProfile(v.inboxId, v.input),
    onSuccess: (data, v) => qc.setQueryData(["wa-profile", v.inboxId], data),
  });
}

/** Upload a new public profile photo for a number (pushed to Meta). */
export function useSetWhatsappProfilePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { inboxId: string; file: File | Blob }) =>
      api.setWhatsappProfilePhoto(v.inboxId, v.file),
    onSuccess: (data, v) => qc.setQueryData(["wa-profile", v.inboxId], data),
  });
}

/* ---- WhatsApp broadcast ---- */
/** Send an approved template to many recipients at once (a compliant 1:1 loop). */
export function useSendBroadcast() {
  return useMutation({
    mutationFn: (input: SendBroadcastInput) => api.sendBroadcast(input),
  });
}

export function useAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: string;
      input: { assigneeUserId?: string | null; assignedTeamId?: string | null };
    }) => api.assign(v.id, v.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
      qc.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

export function useSetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: ConversationStatus }) => api.setStatus(v.id, v.status),
    onSuccess: (_conv, v) => {
      qc.invalidateQueries({ queryKey: ["conversation", v.id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

export function useSetPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; priority: Priority }) => api.setPriority(v.id, v.priority),
    onSuccess: (_conv, v) => {
      qc.invalidateQueries({ queryKey: ["conversation", v.id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

export function useSnooze() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; until: string }) => api.snooze(v.id, v.until),
    onSuccess: (_conv, v) => {
      qc.invalidateQueries({ queryKey: ["conversation", v.id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}

/** Periodically refresh lists so snoozed conversations wake out of "Later" on
 *  time and the countdowns tick, without needing a manual reload. */
export function useSnoozeSweep() {
  const qc = useQueryClient();
  useEffect(() => {
    const t = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["views"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    }, 30_000);
    return () => window.clearInterval(t);
  }, [qc]);
}

/** Reactive `matchMedia` for responsive (mobile ⇄ desktop) layout switches. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Sound on/off state bound to the shared sound module. */
export function useSound(): { on: boolean; toggle: () => void } {
  const [on, setOn] = useState(isSoundOn);
  useEffect(() => subscribeSound(setOn), []);
  return { on, toggle: toggleSound };
}

/** The theme currently in effect, re-read whenever it's toggled or the OS flips. */
export function useTheme(): "light" | "dark" {
  const [theme, setTheme] = useState(effectiveTheme);
  useEffect(() => {
    const update = () => setTheme(effectiveTheme());
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("themechange", update);
    mql.addEventListener("change", update);
    return () => {
      window.removeEventListener("themechange", update);
      mql.removeEventListener("change", update);
    };
  }, []);
  return theme;
}

/**
 * Live sync: server events invalidate the relevant queries so lists, counts and
 * the open thread refresh instantly — across every connected client/tab.
 */
/**
 * On-demand refresh (pull-to-refresh / refresh button): pull any new Gmail now,
 * then refetch the lists. Best-effort — a failed Gmail sync (or no Gmail inbox)
 * still refreshes the conversation lists. `refreshing` drives the spinner.
 */
export function useRefresh() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await api.syncGmail().catch(() => undefined);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["conversations"] }),
        qc.invalidateQueries({ queryKey: ["conversation"] }),
        qc.invalidateQueries({ queryKey: ["views"] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [qc]);
  return { refresh, refreshing };
}

export function useRealtime(openConversationId: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    // Patch the open thread's cache in place instead of refetching the whole
    // thread on every event. Returns whether the message was appended (i.e. new).
    const patchThread = (conversationId: string, message: Message): boolean => {
      let appended = false;
      qc.setQueryData<ConversationWithMessages>(["conversation", conversationId], (cur) => {
        if (!cur) return cur; // thread not open/cached — nothing to patch
        const idx = cur.messages.findIndex((m) => m.id === message.id);
        if (idx >= 0) {
          const next = cur.messages.slice();
          next[idx] = message;
          return { ...cur, messages: next };
        }
        appended = true;
        return { ...cur, messages: [...cur.messages, message] };
      });
      return appended;
    };
    const invalidateLists = () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    };
    // Play the outbound "sent" cue exactly once, when a message first reaches a
    // success status — so the WhatsApp/email sound means "actually sent", not
    // "queued". Never fires on failure. The channel picks the sound.
    const maybePlaySentCue = (conversationId: string, m: Message) => {
      if (m.direction !== "out" || m.internal) return;
      if (!SENT_CUE_STATUSES.has(m.status) || sentCuePlayed.has(m.id)) return;
      sentCuePlayed.add(m.id);
      const conv = qc.getQueryData<ConversationWithMessages>(["conversation", conversationId]);
      playSent(m.channel ?? conv?.channel);
    };
    // A brand-new message changes list previews/counts/order → patch thread + refresh lists.
    const onCreated = (p: { conversationId: string; message: Message }) => {
      if (p.message.direction === "in" && !p.message.internal) playReceived();
      else maybePlaySentCue(p.conversationId, p.message);
      patchThread(p.conversationId, p.message);
      invalidateLists();
    };
    // A status tick (sent→delivered→read) only moves the ticks — patch the thread
    // in place and do NOT refetch the lists (this is the frequent, cheap path).
    const onUpdated = (p: { conversationId: string; message: Message }) => {
      maybePlaySentCue(p.conversationId, p.message);
      patchThread(p.conversationId, p.message);
    };
    // Assignment/status/snooze change the lists → refresh them (infrequent).
    const onConversation = () => invalidateLists();
    const onAssigned = () => invalidateLists();
    // A bell notification (mention / snooze due) → prepend it and give a cue.
    const onNotification = (p: { notification: Notification }) => {
      qc.setQueryData<Notification[]>(["notifications"], (cur) =>
        [p.notification, ...(cur ?? []).filter((n) => n.id !== p.notification.id)].slice(0, 50),
      );
      playReceived();
    };
    socket.on(ServerEvent.MessageCreated, onCreated);
    socket.on(ServerEvent.MessageUpdated, onUpdated);
    socket.on(ServerEvent.ConversationAssigned, onAssigned);
    socket.on(ServerEvent.ConversationUpdated, onConversation);
    socket.on(ServerEvent.Notification, onNotification);
    return () => {
      socket.off(ServerEvent.MessageCreated, onCreated);
      socket.off(ServerEvent.MessageUpdated, onUpdated);
      socket.off(ServerEvent.ConversationAssigned, onAssigned);
      socket.off(ServerEvent.ConversationUpdated, onConversation);
      socket.off(ServerEvent.Notification, onNotification);
    };
  }, [qc]);

  useEffect(() => {
    if (!openConversationId) return;
    const socket = getSocket();
    socket.emit(ClientEvent.JoinConversation, { conversationId: openConversationId });
    return () => {
      socket.emit(ClientEvent.LeaveConversation, { conversationId: openConversationId });
    };
  }, [openConversationId]);
}
