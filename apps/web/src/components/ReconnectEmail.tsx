import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Inbox } from "@ding/schemas";
import { useInboxes, useMe } from "../hooks";
import { AlertIcon, XIcon } from "../lib/icons";

/*
 * A Gmail channel Google has signed out: signing it back in, in place. The
 * same consent popup that adds a mailbox, told which channel it's for — so the
 * channel keeps its conversations, routing and signature, and the server
 * catches up on the mail that arrived while it was out. See docs/email.md.
 */

/** Sign this email channel in again. Returns the function that opens Google's popup. */
export function useReconnectEmail(onToast: (m: string) => void) {
  const qc = useQueryClient();
  const waiting = useRef<string | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Our own callback page, nothing else.
      if (e.origin !== window.location.origin) return;
      const data = e.data as { source?: string; ok?: boolean; reconnected?: boolean; email?: string; error?: string } | null;
      if (!data || data.source !== "ding-oauth" || !waiting.current) return;
      waiting.current = null;
      if (data.ok) {
        qc.invalidateQueries({ queryKey: ["inboxes"] });
        qc.invalidateQueries({ queryKey: ["conversations"] });
        onToast(`${data.email ?? "The mailbox"} is reconnected — catching up on the email it missed`);
      } else {
        onToast(data.error || "Couldn't reconnect the mailbox");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc, onToast]);

  return useCallback(
    (inbox: Pick<Inbox, "id" | "handle">) => {
      waiting.current = inbox.id;
      const popup = window.open(
        `/api/channels/google/oauth/start?inboxId=${encodeURIComponent(inbox.id)}`,
        "channel-oauth",
        "width=560,height=720,menubar=no,toolbar=no",
      );
      if (!popup) {
        waiting.current = null;
        onToast("Allow pop-ups for this site to reconnect the mailbox");
      }
    },
    [onToast],
  );
}

/** "Signed out 2 hours ago" — when it happened, in words. */
export function signedOutSince(since: string | null | undefined): string {
  if (!since) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Across the top of the app, for the people who can fix it: a mailbox Google
 * has signed out. New email isn't arriving and replies can't go out, which is
 * not something to find out from a customer chasing. Hidden for the rest of
 * the session once dismissed; it comes back if another mailbox drops.
 */
export function SignedOutBanner({ onToast, onOpenChannels }: { onToast: (m: string) => void; onOpenChannels: () => void }) {
  const role = useMe().data?.user.role;
  const inboxes = useInboxes();
  const reconnect = useReconnectEmail(onToast);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  if (role !== "admin" && role !== "manager") return null;
  const out = (inboxes.data ?? []).filter((i) => i.type === "email" && i.signedOut && !dismissed.has(i.id));
  if (!out.length) return null;
  const first = out[0]!;
  return (
    <div className="reauth-banner" role="alert">
      <AlertIcon />
      <span className="reauth-banner__text">
        <b>{first.handle}</b> needs reconnecting — Google signed it out{first.signedOut?.since ? ` ${signedOutSince(first.signedOut.since)}` : ""}. New email
        isn't arriving and replies can't be sent.
        {out.length > 1 ? ` (+${out.length - 1} more)` : ""}
      </span>
      <button type="button" className="btn-primary reauth-banner__go" onClick={() => reconnect(first)}>
        Reconnect
      </button>
      {out.length > 1 && (
        <button type="button" className="btn-ghost reauth-banner__more" onClick={onOpenChannels}>
          See channels
        </button>
      )}
      <button
        type="button"
        className="iconbtn"
        aria-label="Hide for now"
        title="Hide for now"
        onClick={() => setDismissed((cur) => new Set([...cur, ...out.map((i) => i.id)]))}
      >
        <XIcon />
      </button>
    </div>
  );
}
