import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EMAIL_CUTOVER_DAYS, type Inbox } from "@ding/schemas";
import { api } from "../lib/api";
import { useInboxes, useMe } from "../hooks";
import { AlertIcon, XIcon } from "../lib/icons";

/*
 * A Gmail channel Google has signed out: signing it back in, in place. The
 * same consent popup that adds a mailbox, told which channel it's for — so the
 * channel keeps its conversations, routing and signature, and the server
 * catches up on the mail that arrived while it was out — or, if whoever
 * reconnects chooses, starts again from now. See docs/email.md.
 */

/** Sign this email channel in again. Returns the function that opens Google's popup. */
export function useReconnectEmail(onToast: (m: string) => void) {
  const qc = useQueryClient();
  const waiting = useRef<string | null>(null);
  const skipping = useRef(false);

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
        onToast(
          skipping.current
            ? `${data.email ?? "The mailbox"} is reconnected — new email comes in from now`
            : `${data.email ?? "The mailbox"} is reconnected — bringing in the email it missed`,
        );
      } else {
        onToast(data.error || "Couldn't reconnect the mailbox");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc, onToast]);

  return useCallback(
    (inbox: Pick<Inbox, "id" | "handle">, opts?: { skipMissed?: boolean }) => {
      waiting.current = inbox.id;
      skipping.current = !!opts?.skipMissed;
      const popup = window.open(
        `/api/channels/google/oauth/start?inboxId=${encodeURIComponent(inbox.id)}${opts?.skipMissed ? "&missed=skip" : ""}`,
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
 * Before Google's popup, for a mailbox that was signed out: what to do about
 * the email that arrived meanwhile. Bring it in (the default), or start again
 * from now and leave it in Gmail.
 */
export function ReconnectEmailDialog({
  inbox,
  onClose,
  onToast,
}: {
  inbox: Pick<Inbox, "id" | "handle" | "signedOut">;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const reconnect = useReconnectEmail(onToast);
  const [missed, setMissed] = useState<"pull" | "skip">("pull");
  const since = inbox.signedOut?.since;
  const go = (e: FormEvent) => {
    e.preventDefault();
    reconnect(inbox, { skipMissed: missed === "skip" });
    onClose();
  };
  return (
    <div className="modal" onClick={onClose}>
      <form className="modal__box reconnect" onClick={(e) => e.stopPropagation()} onSubmit={go}>
        <div className="modal__head">
          <h2>Reconnect {inbox.handle}</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="modal__body">
          <p className="fieldhint">
            Google signed it out{since ? ` ${signedOutSince(since)}` : ""}
            {since ? <> (since {new Date(since).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })})</> : null}. Email that
            arrived since then hasn't come into Nest yet.
          </p>
          <div className="reconnect__opts" role="radiogroup" aria-label="The email it missed">
            <label className={"reconnect__opt" + (missed === "pull" ? " on" : "")}>
              <input type="radio" name="missed" checked={missed === "pull"} onChange={() => setMissed("pull")} />
              <span>
                <b>Bring in the email it missed</b>
                <small>
                  Everything received and sent while it was out comes into the inbox — on its conversations, or as new ones — so
                  nothing goes unanswered.
                </small>
              </span>
            </label>
            <label className={"reconnect__opt" + (missed === "skip" ? " on" : "")}>
              <input type="radio" name="missed" checked={missed === "skip"} onChange={() => setMissed("skip")} />
              <span>
                <b>Start from now</b>
                <small>Only new email from here on. What it missed stays in Gmail.</small>
              </span>
            </label>
          </div>
        </div>
        <div className="modal__foot">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Continue with Google
          </button>
        </div>
      </form>
    </div>
  );
}

/** A date input's value, `days` ago. */
function daysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * On a connected Gmail channel: bring in the email it had since a date — for a
 * gap a reconnect didn't cover. Anything already in Nest is skipped.
 */
export function PullMissedEmail({ inbox, onToast }: { inbox: Pick<Inbox, "id">; onToast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [since, setSince] = useState(() => daysAgo(7));
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn-ghost reauth-box__pull" onClick={() => setOpen(true)}>
        Bring in missed email…
      </button>
    );
  }
  const go = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // Midnight, local time, on the day picked.
      await api.pullMissedEmail(inbox.id, new Date(`${since}T00:00:00`).toISOString());
      onToast(`Bringing in the email since ${new Date(`${since}T00:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" })} — it appears in the inbox as it's read`);
      setOpen(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Couldn't bring the email in");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="pullmissed" onSubmit={go}>
      <label className="field">
        <span>Bring in the email it received and sent since</span>
        <input type="date" value={since} min={daysAgo(EMAIL_CUTOVER_DAYS)} max={daysAgo(0)} required onChange={(e) => setSince(e.target.value)} />
      </label>
      <small>Anything already in Nest is skipped, so it's safe to go back further than you need.</small>
      <div className="pullmissed__row">
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy || !since}>
          {busy ? "Starting…" : "Bring it in"}
        </button>
      </div>
    </form>
  );
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
  const [asking, setAsking] = useState<Inbox | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  if (role !== "admin" && role !== "manager") return null;
  const out = (inboxes.data ?? []).filter((i) => i.type === "email" && i.signedOut && !dismissed.has(i.id));
  const dialog = asking && <ReconnectEmailDialog inbox={asking} onClose={() => setAsking(null)} onToast={onToast} />;
  if (!out.length) return dialog || null;
  const first = out[0]!;
  return (
    <>
    {dialog}
    <div className="reauth-banner" role="alert">
      <AlertIcon />
      <span className="reauth-banner__text">
        <b>{first.handle}</b> needs reconnecting — Google signed it out{first.signedOut?.since ? ` ${signedOutSince(first.signedOut.since)}` : ""}. New email
        isn't arriving and replies can't be sent.
        {out.length > 1 ? ` (+${out.length - 1} more)` : ""}
      </span>
      <button type="button" className="btn-primary reauth-banner__go" onClick={() => setAsking(first)}>
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
    </>
  );
}
