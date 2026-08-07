import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClientEvent,
  ServerEvent,
  type AddParticipantInput,
  type Conversation,
  type ConversationStatus,
  type Priority,
  type CreateContactInput,
  type CreateGroupInput,
  type CreateInboxInput,
  type CreateTeamInput,
  type CreateTemplateInput,
  type CreateUserInput,
  type Message,
  type UpdateContactInput,
  type UpdateInboxInput,
  type UpdateIntegrationSettingsInput,
  type UpdateTeamInput,
  type UpdateTemplateInput,
  type UpdateUserInput,
} from "@ding/schemas";
import { api } from "./lib/api";
import { getSocket } from "./lib/socket";
import { isSoundOn, playReceived, subscribeSound, toggleSound } from "./lib/sound";

export const useSession = () =>
  useQuery({ queryKey: ["session"], queryFn: api.session, retry: false, staleTime: 30_000 });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; password: string }) => api.login(v.email, v.password),
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

export function useAddParticipant(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddParticipantInput) => api.addParticipant(conversationId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversation", conversationId] }),
  });
}

export function useRemoveParticipant(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) => api.removeParticipant(conversationId, contactId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversation", conversationId] }),
  });
}

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: api.me });
export const useViews = () => useQuery({ queryKey: ["views"], queryFn: api.views });
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

export const useConversations = (view: string) =>
  useQuery({ queryKey: ["conversations", view], queryFn: () => api.conversations(view) });
export const useConversation = (id: string | null) =>
  useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api.conversation(id as string),
    enabled: !!id,
  });

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
    }) =>
      api.sendMessage(v.id, v.body, v.internal ?? false, v.attachmentIds, v.template, v.quotedMsgId, v.bodyHtml),
    onSuccess: (_msg, v) => {
      qc.invalidateQueries({ queryKey: ["conversation", v.id] });
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
    const invalidate = (conversationId?: string) => {
      if (conversationId) qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
      else qc.invalidateQueries({ queryKey: ["conversation"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    };
    const onMessage = (p: { conversationId: string; message: Message }) => {
      // Ping only for real inbound messages (not our own echoes or internal notes).
      if (p.message.direction === "in" && !p.message.internal) playReceived();
      invalidate(p.conversationId);
    };
    const onConversation = (p: { conversation: Conversation }) => invalidate(p.conversation.id);
    const onAssigned = () => invalidate();
    socket.on(ServerEvent.MessageCreated, onMessage);
    socket.on(ServerEvent.MessageUpdated, onMessage);
    socket.on(ServerEvent.ConversationAssigned, onAssigned);
    socket.on(ServerEvent.ConversationUpdated, onConversation);
    return () => {
      socket.off(ServerEvent.MessageCreated, onMessage);
      socket.off(ServerEvent.MessageUpdated, onMessage);
      socket.off(ServerEvent.ConversationAssigned, onAssigned);
      socket.off(ServerEvent.ConversationUpdated, onConversation);
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
