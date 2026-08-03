import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClientEvent,
  ServerEvent,
  type AddParticipantInput,
  type Conversation,
  type CreateGroupInput,
  type CreateInboxInput,
  type Message,
} from "@ding/schemas";
import { api } from "./lib/api";
import { getSocket } from "./lib/socket";

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
    mutationFn: (v: { id: string; body: string; internal?: boolean }) =>
      api.sendMessage(v.id, v.body, v.internal ?? false),
    onSuccess: (_msg, v) => {
      qc.invalidateQueries({ queryKey: ["conversation", v.id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    },
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

/**
 * Live sync: server events invalidate the relevant queries so lists, counts and
 * the open thread refresh instantly — across every connected client/tab.
 */
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
    const onMessage = (p: { conversationId: string; message: Message }) => invalidate(p.conversationId);
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
