import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import type { UpdateMyProfileInput } from "@ding/schemas";
import {
  useMe,
  useUpdateMyPreferences,
  useUpdateMyProfile,
  useChangePassword,
  useSessions,
  useRevokeSession,
  useRevokeOtherSessions,
} from "../hooks";
import type { SessionInfo } from "@ding/schemas";
import { useScrollLock } from "../lib/useScrollLock";
import { api } from "../lib/api";
import { XIcon } from "../lib/icons";
import { Avatar } from "./Avatar";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      /** Set an inline font-size (e.g. "18px") on the current selection. */
      setFontSize: (size: string) => ReturnType;
      /** Clear any inline font-size. */
      unsetFontSize: () => ReturnType;
    };
  }
}

/**
 * TipTap v2 ships no official font-size extension, so this tiny mark hangs a
 * `fontSize` attribute off `textStyle` and (de)serialises it as inline
 * `style="font-size:…"` — exactly what Gmail emits, so pasted sizes survive.
 */
const FontSize = Extension.create<{ types: string[] }>({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontSize || null,
            renderHTML: (attributes: { fontSize?: string | null }) =>
              attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

/**
 * The stock Image node drops width/height on serialise, so a sized image
 * silently reverts. This keeps both attributes (from the tag or an inline
 * style) and renders them back out, so sizing survives `getHTML()`.
 */
const SizedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("width") || element.style.width || null,
        renderHTML: (attributes: { width?: string | number | null }) =>
          attributes.width ? { width: attributes.width } : {},
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("height") || element.style.height || null,
        renderHTML: (attributes: { height?: string | number | null }) =>
          attributes.height ? { height: attributes.height } : {},
      },
    };
  },
});

/** A picture-frame glyph for the "insert image" toolbar button. */
function ImageGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l4.5-4.5a2 2 0 0 1 2.8 0L17 18" />
    </svg>
  );
}

/** Text-alignment glyphs (the short lines shift to hint the alignment). */
function AlignGlyph({ dir }: { dir: "left" | "center" | "right" }) {
  const paths: Record<typeof dir, string> = {
    left: "M3 6h18M3 10h11M3 14h18M3 18h11",
    center: "M3 6h18M6 10h12M3 14h18M6 18h12",
    right: "M3 6h18M10 10h11M3 14h18M10 18h11",
  };
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d={paths[dir]} />
    </svg>
  );
}

/** "Chrome on macOS" from a parsed session, degrading gracefully. */
function deviceLabel(s: SessionInfo): string {
  const browser = s.browser ?? "Unknown browser";
  return s.os ? `${browser} on ${s.os}` : browser;
}

/** Compact "time ago" for a session's last-active stamp. */
function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

/**
 * A team member's own personal settings, opened from the avatar menu:
 *  - Profile: photo, display name, and login email.
 *  - Availability (accepting round-robin auto-assignments or not).
 *  - A rich email signature (formatting + inline images) appended to outbound
 *    email they send. It rides the wire only — never shown on the thread bubble.
 *  - Password: change it after re-entering the current one.
 */
export function PersonalSettings({ onClose, onToast }: { onClose: () => void; onToast: (msg: string) => void }) {
  const { data } = useMe();
  const me = data?.user;
  const update = useUpdateMyPreferences();
  const profile = useUpdateMyProfile();
  const changePw = useChangePassword();
  const sessionsQ = useSessions();
  const revokeSession = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const sessions = sessionsQ.data ?? [];
  const boxRef = useRef<HTMLDivElement>(null);
  useScrollLock(boxRef);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  // Profile
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sigUploading, setSigUploading] = useState(false);
  const [profSeeded, setProfSeeded] = useState(false);

  // Availability + signature
  const [available, setAvailable] = useState(true);
  const [seeded, setSeeded] = useState(false);

  // Password
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confPw, setConfPw] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      SizedImage.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder: "Your signature — name, role, phone, a logo…" }),
    ],
    editorProps: { attributes: { class: "richedit sig-edit", "aria-label": "Email signature" } },
  });

  // Seed the profile fields once `me` loads (independent of the editor).
  useEffect(() => {
    if (!me || profSeeded) return;
    setName(me.name);
    setEmail(me.email);
    setAvatarUrl(me.avatarUrl ?? null);
    setProfSeeded(true);
  }, [me, profSeeded]);

  // Seed availability + signature once `me` and the editor are ready.
  useEffect(() => {
    if (!me || !editor || seeded) return;
    setAvailable(me.available);
    if (me.emailSignature) editor.commands.setContent(me.emailSignature);
    setSeeded(true);
  }, [me, editor, seeded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickImage = async (file: File | undefined) => {
    if (!file || !editor) return;
    if (!file.type.startsWith("image/")) {
      onToast("That file isn't an image.");
      return;
    }
    if (file.size > 5_000_000) {
      onToast("Image is too large — keep it under 5 MB.");
      return;
    }
    // Host the image the same way the profile photo does, then reference it by
    // its hosted https URL. This keeps the stored signature HTML tiny (no base64
    // bloat that would blow the size cap) and makes the image loadable in email.
    setSigUploading(true);
    try {
      const att = await api.uploadMedia(file, { kind: "image", filename: file.name });
      const src = new URL(att.url, window.location.origin).href;
      editor.chain().focus().setImage({ src }).run();
    } catch {
      onToast("Couldn’t upload that image — please try again.");
    } finally {
      setSigUploading(false);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onToast("That file isn't an image.");
      return;
    }
    if (file.size > 5_000_000) {
      onToast("Photo is too large — keep it under 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const att = await api.uploadMedia(file, { kind: "image", filename: file.name });
      setAvatarUrl(att.url);
    } catch {
      onToast("Couldn’t upload that photo — please try again.");
    } finally {
      setUploading(false);
    }
  };

  const toggleLink = () => {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("Link URL (https://…)");
    if (url) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const save = async () => {
    const html = editor?.getHTML() ?? "";
    const empty = !editor || (editor.getText().trim() === "" && !html.includes("<img"));

    // Only send profile fields that actually changed.
    const prof: UpdateMyProfileInput = {};
    if (name.trim() && name.trim() !== me?.name) prof.name = name.trim();
    if (email.trim() && email.trim() !== me?.email) prof.email = email.trim();
    if ((avatarUrl ?? null) !== (me?.avatarUrl ?? null)) prof.avatarUrl = avatarUrl ?? "";

    try {
      if (Object.keys(prof).length) await profile.mutateAsync(prof);
      await update.mutateAsync({ available, emailSignature: empty ? "" : html });
      onToast("Personal settings saved");
      onClose();
    } catch (e) {
      const status = (e as { status?: number })?.status;
      onToast(status === 409 ? "That email address is already in use." : "Couldn’t save — please try again.");
    }
  };

  const pwValid = curPw.length > 0 && newPw.length >= 8 && newPw === confPw;
  const updatePassword = async () => {
    if (!pwValid) return;
    try {
      await changePw.mutateAsync({ currentPassword: curPw, newPassword: newPw });
      setCurPw("");
      setNewPw("");
      setConfPw("");
      onToast("Password updated");
    } catch (e) {
      const status = (e as { status?: number })?.status;
      onToast(status === 400 ? "Your current password is incorrect." : "Couldn’t update password.");
    }
  };

  const Btn = ({
    mark,
    active,
    disabled,
    title,
    children,
    onClick,
  }: {
    mark?: string;
    active?: boolean;
    disabled?: boolean;
    title: string;
    children: ReactNode;
    onClick: () => void;
  }) => (
    <button
      type="button"
      className={"richbar__b" + ((active ?? Boolean(mark && editor?.isActive(mark))) ? " on" : "")}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );

  const roleLabel = me ? me.role.charAt(0).toUpperCase() + me.role.slice(1) : "";

  return createPortal(
    <div className="modal" onClick={onClose}>
      <div className="modal__box perssettings" ref={boxRef} role="dialog" aria-modal="true" aria-label="Personal settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Personal settings</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close"><XIcon /></button>
        </div>

        <div className="modal__body">
          {/* Profile — photo, name, email */}
          <div className="pers-field">
            <div className="pers-field__hd">
              <span className="pers-field__lbl">Profile</span>
              {roleLabel && <span className="pers-role">{roleLabel}</span>}
            </div>
            <div className="pers-prof">
              <Avatar name={name || me?.name || ""} email={email} color={me?.avatarColor} src={avatarUrl} size={72} fontSize={26} className="av pers-prof__av" />
              <div className="pers-prof__actions">
                <div className="pers-prof__btns">
                  <button type="button" className="btn-ghost" onClick={() => photoRef.current?.click()} disabled={uploading}>
                    {uploading ? "Uploading…" : avatarUrl ? "Change photo" : "Upload photo"}
                  </button>
                  {avatarUrl && (
                    <button type="button" className="btn-ghost pers-prof__remove" onClick={() => setAvatarUrl(null)} disabled={uploading}>
                      Remove
                    </button>
                  )}
                </div>
                <small className="pers-field__hint">JPG, PNG or GIF, up to 5 MB.</small>
              </div>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  pickPhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="pers-grid">
              <label className="field">
                <span>Full name</span>
                <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </label>
              <label className="field">
                <span>Email address</span>
                <input type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              </label>
            </div>
            <small className="pers-field__hint">Your email is also your sign-in — changing it changes how you log in.</small>
          </div>

          {/* Availability */}
          <div className="pers-field">
            <div className="pers-field__hd">
              <span className="pers-field__lbl">Availability</span>
              <button
                type="button"
                role="switch"
                aria-checked={available}
                className={"switch" + (available ? " on" : "")}
                onClick={() => setAvailable((v) => !v)}
              >
                <span className="switch__dot" />
              </button>
            </div>
            <p className={"pers-avail " + (available ? "is-on" : "is-off")}>
              <span className="pers-avail__dot" />
              {available ? "Available — you’re in the round-robin for new chats." : "Unavailable — new chats skip you until you’re back."}
            </p>
          </div>

          {/* Email signature */}
          <div className="pers-field">
            <div className="pers-field__hd">
              <span className="pers-field__lbl">Email signature</span>
              <small className="pers-field__hint">Added to emails you send · not shown in the thread</small>
            </div>
            <div className="sig-editor">
              <div className="richbar" role="toolbar" aria-label="Signature formatting">
                <Btn mark="bold" title="Bold" onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></Btn>
                <Btn mark="italic" title="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></Btn>
                <Btn mark="underline" title="Underline" onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></Btn>
                <span className="richbar__sep" aria-hidden="true" />
                <select
                  className="richbar__sel"
                  title="Font size"
                  aria-label="Font size"
                  value={editor?.getAttributes("textStyle").fontSize ?? ""}
                  onChange={(e) => {
                    if (!editor) return;
                    const v = e.target.value;
                    if (v) editor.chain().focus().setFontSize(v).run();
                    else editor.chain().focus().unsetFontSize().run();
                  }}
                >
                  <option value="13px">Small</option>
                  <option value="">Normal</option>
                  <option value="18px">Large</option>
                  <option value="32px">Huge</option>
                </select>
                <input
                  type="color"
                  className="richbar__color"
                  title="Text colour"
                  aria-label="Text colour"
                  value={editor?.getAttributes("textStyle").color ?? "#111111"}
                  onChange={(e) => editor?.chain().focus().setColor(e.target.value).run()}
                />
                <span className="richbar__sep" aria-hidden="true" />
                <Btn title="Align left" active={editor?.isActive({ textAlign: "left" })} onClick={() => editor?.chain().focus().setTextAlign("left").run()}><AlignGlyph dir="left" /></Btn>
                <Btn title="Align centre" active={editor?.isActive({ textAlign: "center" })} onClick={() => editor?.chain().focus().setTextAlign("center").run()}><AlignGlyph dir="center" /></Btn>
                <Btn title="Align right" active={editor?.isActive({ textAlign: "right" })} onClick={() => editor?.chain().focus().setTextAlign("right").run()}><AlignGlyph dir="right" /></Btn>
                <span className="richbar__sep" aria-hidden="true" />
                <Btn mark="bulletList" title="Bulleted list" onClick={() => editor?.chain().focus().toggleBulletList().run()}>•&nbsp;—</Btn>
                <Btn mark="link" title="Insert link" onClick={toggleLink}>🔗</Btn>
                <Btn title={sigUploading ? "Uploading…" : "Insert image"} disabled={sigUploading} onClick={() => fileRef.current?.click()}><ImageGlyph /></Btn>
              </div>
              <EditorContent editor={editor} className="sig-host" />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  pickImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          {/* Password */}
          <div className="pers-field">
            <div className="pers-field__hd">
              <span className="pers-field__lbl">Password</span>
              <small className="pers-field__hint">At least 8 characters</small>
            </div>
            <div className="pers-grid">
              <label className="field pers-col-full">
                <span>Current password</span>
                <input type="password" value={curPw} autoComplete="current-password" onChange={(e) => setCurPw(e.target.value)} placeholder="••••••••" />
              </label>
              <label className="field">
                <span>New password</span>
                <input type="password" value={newPw} autoComplete="new-password" onChange={(e) => setNewPw(e.target.value)} placeholder="••••••••" />
              </label>
              <label className="field">
                <span>Confirm new password</span>
                <input type="password" value={confPw} autoComplete="new-password" onChange={(e) => setConfPw(e.target.value)} placeholder="••••••••" />
              </label>
            </div>
            <div className="pers-pw__foot">
              {confPw.length > 0 && newPw !== confPw ? (
                <small className="pers-pw__warn">The new passwords don’t match.</small>
              ) : (
                <span />
              )}
              <button type="button" className="btn-ghost" onClick={updatePassword} disabled={!pwValid || changePw.isPending}>
                {changePw.isPending ? "Updating…" : "Update password"}
              </button>
            </div>
          </div>

          {/* Where you're signed in */}
          <div className="pers-field">
            <div className="pers-field__hd">
              <span className="pers-field__lbl">Where you’re signed in</span>
              {sessions.length > 1 && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() =>
                    revokeOthers.mutate(undefined, {
                      onSuccess: (r) =>
                        onToast(
                          r.revoked
                            ? `Signed out ${r.revoked} other device${r.revoked === 1 ? "" : "s"}`
                            : "No other sessions to sign out",
                        ),
                      onError: () => onToast("Couldn’t sign out other sessions"),
                    })
                  }
                  disabled={revokeOthers.isPending}
                >
                  {revokeOthers.isPending ? "Signing out…" : "Sign out all others"}
                </button>
              )}
            </div>
            <div className="pers-sessions">
              {sessionsQ.isLoading ? (
                <small className="pers-field__hint">Loading…</small>
              ) : sessions.length === 0 ? (
                <small className="pers-field__hint">No active sessions.</small>
              ) : (
                sessions.map((s) => (
                  <div key={s.id} className="pers-session">
                    <div className="pers-session__info">
                      <span className="pers-session__dev">{deviceLabel(s)}</span>
                      <span className="pers-session__meta">
                        {s.ip ? `${s.ip} · ` : ""}
                        {s.current ? "Active now" : `Last active ${timeAgo(s.lastSeenAt)}`}
                      </span>
                    </div>
                    {s.current ? (
                      <span className="pers-session__badge">This device</span>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost pers-session__revoke"
                        onClick={() =>
                          revokeSession.mutate(s.id, {
                            onSuccess: () => onToast("Signed out that device"),
                            onError: () => onToast("Couldn’t sign out that device"),
                          })
                        }
                        disabled={revokeSession.isPending}
                      >
                        Sign out
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="modal__foot">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={save} disabled={update.isPending || profile.isPending || uploading || sigUploading}>
            {update.isPending || profile.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
