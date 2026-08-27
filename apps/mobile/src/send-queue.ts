import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import { api } from "@ding/client";
import type { ChannelType } from "@ding/schemas";

const KEY = "nest.sendQueue.v1";

/**
 * A reply that has been written but not yet accepted by the server.
 *
 * Everything needed to send it later is here, because "later" may be after the
 * app has been killed — there is no React state to fall back on. Attachment ids
 * are safe to persist: the upload already succeeded, so the file is on the
 * server even though the message isn't.
 */
export interface QueuedSend {
  id: string;
  conversationId: string;
  body: string;
  internal: boolean;
  channel?: ChannelType;
  attachmentIds?: string[];
  quotedMsgId?: string;
  template?: { id: string; params: string[] };
  /** Email only: the thread's subject as it stood when this was written, and
   *  the extra recipients it was addressed to. Persisted because a queued reply
   *  is sent from a process that has none of the composer's state left. */
  subject?: string;
  cc?: string[];
  bcc?: string[];
  /** When it was written, so the thread can show it in the right place. */
  createdAt: string;
  attempts: number;
  /** Set after a failure that isn't worth retrying (a 4xx the server rejected). */
  deadLetter?: string;
}

let queue: QueuedSend[] = [];
let loaded = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

async function persist() {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // A phone with no writable storage left is beyond our help; the in-memory
    // queue still works for this session.
  }
}

/** Read the queue off disk. Called once, before the first flush. */
export async function loadQueue(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) queue = JSON.parse(raw) as QueuedSend[];
  } catch {
    queue = [];
  }
  emit();
}

let seq = 0;
/** Add a send to the queue and try it immediately. */
export async function enqueue(item: Omit<QueuedSend, "id" | "createdAt" | "attempts">): Promise<void> {
  queue = [
    ...queue,
    { ...item, id: `q_${Date.now()}_${++seq}`, createdAt: new Date().toISOString(), attempts: 0 },
  ];
  emit();
  await persist();
  void flush();
}

export async function discard(id: string): Promise<void> {
  queue = queue.filter((q) => q.id !== id);
  emit();
  await persist();
}

/** Clear a dead-letter flag and try again — the "Retry" on a failed bubble. */
export async function retryQueued(id: string): Promise<void> {
  queue = queue.map((q) => (q.id === id ? { ...q, deadLetter: undefined, attempts: 0 } : q));
  emit();
  await persist();
  void flush();
}

let flushing = false;

/**
 * Send everything queued, oldest first, stopping at the first network failure.
 *
 * Order matters and is why this is serial: two replies in one thread must arrive
 * in the order they were written. Stopping on the first network error rather
 * than carrying on is the same reasoning — if the connection is gone, the next
 * one will fail too, and burning attempts on it only risks duplicates.
 *
 * A 4xx is different: the server has looked at it and said no. Retrying that
 * forever would leave a permanently stuck queue, so it's marked dead and
 * surfaced to the agent, who can retry it or throw it away.
 */
export async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    await loadQueue();
    for (const item of [...queue]) {
      if (item.deadLetter) continue;
      try {
        await api.sendMessage(item.conversationId, item.body, item.internal, item.attachmentIds, {
          ...(item.channel ? { channel: item.channel } : {}),
          ...(item.quotedMsgId ? { quotedMsgId: item.quotedMsgId } : {}),
          ...(item.template ? { template: item.template } : {}),
          ...(item.subject !== undefined ? { subject: item.subject } : {}),
          ...(item.cc?.length ? { cc: item.cc } : {}),
          ...(item.bcc?.length ? { bcc: item.bcc } : {}),
        });
        queue = queue.filter((q) => q.id !== item.id);
        emit();
        await persist();
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          queue = queue.map((q) =>
            q.id === item.id
              ? { ...q, deadLetter: err instanceof Error ? err.message : "Rejected", attempts: q.attempts + 1 }
              : q,
          );
          emit();
          await persist();
          continue;
        }
        // Offline, or the server is down. Leave it queued and stop — the next
        // trigger (reconnect, app foreground, a new send) will pick it up.
        queue = queue.map((q) => (q.id === item.id ? { ...q, attempts: q.attempts + 1 } : q));
        emit();
        await persist();
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

/* ---- React binding ---- */

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => queue;

/**
 * The queue, live, plus a flush that runs when the phone comes back online.
 *
 * `expo-network`'s listener is the trigger rather than a timer: a poll either
 * wastes battery or adds latency, and the OS already knows the moment the radio
 * comes back.
 */
export function useSendQueue() {
  const items = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    void loadQueue().then(() => flush());
    const net = Network.addNetworkStateListener((s) => {
      if (s.isInternetReachable ?? s.isConnected) void flush();
    });
    // Coming back to the app is the other moment worth retrying on: the network
    // listener can't have fired while the process was suspended or killed.
    const app = AppState.addEventListener("change", (next) => {
      if (next === "active") void flush();
    });
    return () => {
      net.remove();
      app.remove();
    };
  }, []);

  return {
    items,
    /** Just this conversation's pending sends, for rendering in its thread. */
    forConversation: useCallback(
      (conversationId: string) => items.filter((q) => q.conversationId === conversationId),
      [items],
    ),
    retry: retryQueued,
    discard,
  };
}
