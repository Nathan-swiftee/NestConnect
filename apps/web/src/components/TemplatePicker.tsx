import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import type { Template, TemplateApproval, TemplateCategory } from "@ding/schemas";
import { useSendMessage, useTemplates } from "../hooks";
import { playSent, unlock } from "../lib/sound";
import { BackIcon, BoltIcon, SendIcon, XIcon } from "../lib/icons";
import { useScrollLock } from "../lib/useScrollLock";

/* Shared template presentation helpers — reused by Settings › Templates. */

export const TEMPLATE_CATEGORIES: { value: TemplateCategory; label: string }[] = [
  { value: "utility", label: "Utility" },
  { value: "marketing", label: "Marketing" },
  { value: "authentication", label: "Authentication" },
];

/** Human label + status class for a template's Meta approval state. */
export function approvalMeta(status: TemplateApproval): { label: string; cls: string } {
  switch (status) {
    case "approved":
      return { label: "Approved", cls: "ok" };
    case "pending":
      return { label: "Pending review", cls: "pending" };
    case "rejected":
      return { label: "Rejected", cls: "bad" };
    case "paused":
      return { label: "Paused", cls: "warn" };
    case "disabled":
      return { label: "Disabled", cls: "muted" };
    case "draft":
      return { label: "Draft", cls: "muted" };
  }
}

/** How many {{n}} variables a body references (max index seen). */
export function countVariables(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Render a template body with {{n}} substituted; unfilled slots stay highlighted. */
function renderPreview(body: string, params: string[]): JSX.Element[] {
  return body.split(/(\{\{\d+\}\})/g).map((seg, i) => {
    const m = seg.match(/^\{\{(\d+)\}\}$/);
    if (m) {
      const v = params[Number(m[1]) - 1];
      if (v && v.trim()) return <span key={i}>{v}</span>;
      return (
        <span key={i} className="tpl-preview__ph">
          {seg}
        </span>
      );
    }
    return <span key={i}>{seg}</span>;
  });
}

interface Props {
  conversationId: string;
  onClose: () => void;
  onToast: (msg: string) => void;
}

/** Chips shown beside a template name: category, language, approval. */
function TemplateBadges({ tpl }: { tpl: Template }) {
  const ap = approvalMeta(tpl.approvalStatus);
  return (
    <>
      <span className={"tpl-cat tpl-cat--" + tpl.category}>{tpl.category}</span>
      <span className="tpl-lang">{tpl.language}</span>
      <span className={"tpl-appr " + ap.cls}>
        <span className="tpl-appr__dot" />
        {ap.label}
      </span>
    </>
  );
}

export function TemplatePicker({ conversationId, onClose, onToast }: Props) {
  const { data: templates, isLoading } = useTemplates();
  const send = useSendMessage();
  const boxRef = useRef<HTMLDivElement>(null);
  useScrollLock(boxRef);
  const [selected, setSelected] = useState<Template | null>(null);
  const [params, setParams] = useState<string[]>([]);

  // Esc closes the picker (matches the app's other overlays).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const varCount = selected?.variableCount ?? 0;
  const pick = (tpl: Template) => {
    setSelected(tpl);
    setParams(Array.from({ length: tpl.variableCount }, () => ""));
  };
  const setParam = (i: number, v: string) =>
    setParams((p) => p.map((x, idx) => (idx === i ? v : x)));

  const ready = useMemo(
    () => !!selected && params.slice(0, varCount).every((p) => p.trim().length > 0),
    [selected, params, varCount],
  );

  const doSend = () => {
    if (!selected || !ready || send.isPending) return;
    unlock();
    send.mutate(
      { id: conversationId, body: "", template: { id: selected.id, params } },
      {
        onSuccess: () => {
          playSent();
          onToast("Template sent");
          onClose();
        },
        onError: () => onToast("Couldn’t send the template. Please try again."),
      },
    );
  };

  const list = templates ?? [];

  return createPortal(
    <div className="modal" onClick={onClose}>
      <div
        className="modal__box"
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label="Send a template"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2>{selected ? "Fill in the template" : "Choose a template"}</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        {selected ? (
          <>
            <div className="modal__body">
              <button type="button" className="tpl-detail__back" onClick={() => setSelected(null)}>
                <BackIcon /> All templates
              </button>
              <div className="tpl-detail__top">
                <b className="tpl-detail__name">{selected.name}</b>
                <TemplateBadges tpl={selected} />
              </div>

              {varCount > 0 && (
                <div className="tpl-fill">
                  {Array.from({ length: varCount }, (_, i) => (
                    <label className="tpl-var" key={i}>
                      <span className="tpl-var__lbl">{`Variable {{${i + 1}}}`}</span>
                      <input
                        value={params[i] ?? ""}
                        onChange={(e) => setParam(i, e.target.value)}
                        placeholder={`Value for {{${i + 1}}}`}
                        autoFocus={i === 0}
                      />
                    </label>
                  ))}
                </div>
              )}

              <div className="tpl-preview">
                <div className="tpl-preview__hd">Preview</div>
                <div className="tpl-preview__body">{renderPreview(selected.body, params)}</div>
              </div>
            </div>
            <div className="modal__foot">
              <button type="button" className="btn-ghost" onClick={() => setSelected(null)}>
                Back
              </button>
              <button
                type="button"
                className="btn-primary tpl-send"
                onClick={doSend}
                disabled={!ready || send.isPending}
              >
                <SendIcon /> {send.isPending ? "Sending…" : "Send template"}
              </button>
            </div>
          </>
        ) : (
          <div className="modal__body">
            {isLoading && <div className="center-note">Loading templates…</div>}
            {!isLoading && list.length === 0 && (
              <div className="tpl-empty">
                <BoltIcon />
                <p>
                  No templates yet. Create one in <b>Settings › Templates</b>, or sync approved
                  templates from a connected WhatsApp number.
                </p>
              </div>
            )}
            <div className="tpl-list">
              {list.map((tpl) => {
                const selectable = tpl.approvalStatus === "approved";
                const inner = (
                  <>
                    <div className="tpl-row__top">
                      <span className="tpl-row__name">{tpl.name}</span>
                      <TemplateBadges tpl={tpl} />
                    </div>
                    <div className="tpl-row__body">{tpl.body}</div>
                  </>
                );
                return selectable ? (
                  <button
                    type="button"
                    key={tpl.id}
                    className="tpl-row"
                    onClick={() => pick(tpl)}
                  >
                    {inner}
                  </button>
                ) : (
                  <div
                    key={tpl.id}
                    className="tpl-row tpl-row--off"
                    title="Only approved templates can be sent"
                  >
                    {inner}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
