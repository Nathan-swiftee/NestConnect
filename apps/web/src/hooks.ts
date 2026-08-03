import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientEvent, ServerEvent, type Message } from "@ding/schemas";
import { api } from "./lib/api";
import { getSocket } from "./lib/socket";

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
    const onMessage = (p: { conversationId: string; message: Message }) => {
      qc.invalidateQueries({ queryKey: ["conversation", p.conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
    };
    const onAssigned = () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["views"] });
      qc.invalidateQueries({ queryKey: ["conversation"] });
    };
    socket.on(ServerEvent.MessageCreated, onMessage);
    socket.on(ServerEvent.ConversationAssigned, onAssigned);
    return () => {
      socket.off(ServerEvent.MessageCreated, onMessage);
      socket.off(ServerEvent.ConversationAssigned, onAssigned);
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
