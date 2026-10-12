import { useMemo, useState } from "react";
import type { Inbox } from "@ding/schemas";
import { DEFAULT_SIGNATURE_LAYOUT, renderEmailSignature, SIGNATURE_TOKENS } from "@ding/schemas";
import { useMe, usePeople, useTeams } from "../hooks";
import { RichSignatureEditor, richHtmlIsEmpty } from "./RichSignatureEditor";

/** What the channel editor holds while someone works on the signature. */
export interface SignatureDraft {
  /** null = the default layout (never designed, or reset). */
  layoutHtml: string | null;
  footerHtml: string | null;
  dirty: boolean;
}

export function signatureDraftFor(inbox: Inbox): SignatureDraft {
  return { layoutHtml: inbox.signature?.layoutHtml ?? null, footerHtml: inbox.signature?.footerHtml ?? null, dirty: false };
}

/** The body PUT /inboxes/:id/signature takes, from a draft. */
export function signatureInput(d: SignatureDraft): { layoutHtml: string | null; footerHtml: string | null } {
  const clean = (h: string | null) => (h === null ? null : richHtmlIsEmpty(h) ? "" : h);
  return { layoutHtml: clean(d.layoutHtml), footerHtml: d.footerHtml === null || richHtmlIsEmpty(d.footerHtml) ? null : d.footerHtml };
}

/**
 * Settings › Channels › an email channel › Signature.
 *
 * One design for the mailbox: the layout, where tags like {{agent.position}}
 * fill in for whoever sends, and a marketing section under it. The preview
 * renders it exactly as the email will — pick a teammate to see theirs.
 */
export function ChannelSignature({
  inbox,
  draft,
  onChange,
  onToast,
}: {
  inbox: Inbox;
  draft: SignatureDraft;
  onChange: (d: SignatureDraft) => void;
  onToast: (msg: string) => void;
}) {
  const me = useMe().data?.user;
  const people = usePeople().data ?? [];
  const teams = useTeams().data ?? [];
  const [who, setWho] = useState<string>("");
  // Bumped to reload the layout editor (reset to default).
  const [layoutKey, setLayoutKey] = useState(0);

  const person = people.find((p) => p.user.id === (who || me?.id))?.user ?? me;
  const teamName = teams.find((t) => t.id === inbox.teamIds[0])?.name;
  const preview = useMemo(
    () =>
      renderEmailSignature(
        { layoutHtml: draft.layoutHtml, footerHtml: draft.footerHtml },
        {
          agentName: person?.name,
          agentPosition: person?.position,
          agentEmail: person?.email,
          teamName,
          channelName: inbox.name,
          channelEmail: inbox.handle,
        },
      ),
    [draft.layoutHtml, draft.footerHtml, person, teamName, inbox.name, inbox.handle],
  );

  const set = (patch: Partial<SignatureDraft>) => onChange({ ...draft, ...patch, dirty: true });

  return (
    <div className="chansig">
      <p className="fieldhint chansig__intro">
        Every email sent from <b>{inbox.handle}</b> ends with this. Tags fill in for whoever sends — their name, their
        position — and a line whose tag is empty is left out.
      </p>

      <div className="chansig__field">
        <div className="chansig__hd">
          <span>Signature</span>
          {draft.layoutHtml !== null && (
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                onChange({ ...draft, layoutHtml: null, dirty: true });
                setLayoutKey((k) => k + 1);
              }}
            >
              Reset to default
            </button>
          )}
        </div>
        <RichSignatureEditor
          key={layoutKey}
          initialHtml={draft.layoutHtml ?? DEFAULT_SIGNATURE_LAYOUT}
          onChange={(html) => set({ layoutHtml: html })}
          placeholder="Name, position, phone…"
          label="Signature"
          tokens={SIGNATURE_TOKENS}
          onToast={onToast}
        />
      </div>

      <div className="chansig__field">
        <div className="chansig__hd">
          <span>
            Marketing section <em>optional</em>
          </span>
        </div>
        <RichSignatureEditor
          initialHtml={draft.footerHtml ?? ""}
          onChange={(html) => set({ footerHtml: html })}
          placeholder="A banner, an offer, your socials, a legal line…"
          label="Marketing section"
          onToast={onToast}
        />
      </div>

      <div className="chansig__preview">
        <div className="chansig__hd">
          <span>Preview</span>
          <select className="chansig__who" value={who || me?.id || ""} onChange={(e) => setWho(e.target.value)} aria-label="Preview as">
            {people.map((p) => (
              <option key={p.user.id} value={p.user.id}>
                As {p.user.name}
                {p.user.position ? ` · ${p.user.position}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="chansig__mail">
          <p className="chansig__body">Hi Marta, thanks for getting in touch — …</p>
          {preview ? (
            <div className="chansig__sig" dangerouslySetInnerHTML={{ __html: preview }} />
          ) : (
            <p className="chansig__none">No signature — emails from this channel end with the message.</p>
          )}
        </div>
        {person && !person.position && (
          <small className="fieldhint">
            {person.name} has no position yet — add one in Settings › People, or they can in their own settings.
          </small>
        )}
      </div>
    </div>
  );
}
