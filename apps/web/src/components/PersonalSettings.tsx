import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { useMe, useUpdateMyPreferences } from "../hooks";
import { useScrollLock } from "../lib/useScrollLock";
import { XIcon } from "../lib/icons";

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

/**
 * A team member's own personal settings, opened from the avatar menu:
 *  - Availability (accepting round-robin auto-assignments or not).
 *  - A rich email signature (formatting + inline images) appended to outbound
 *    email they send. It rides the wire only — never shown on the thread bubble.
 */
export function PersonalSettings({ onClose, onToast }: { onClose: () => void; onToast: (msg: string) => void }) {
  const { data } = useMe();
  const me = data?.user;
  const update = useUpdateMyPreferences();
  const boxRef = useRef<HTMLDivElement>(null);
  useScrollLock(boxRef);
  const fileRef = useRef<HTMLInputElement>(null);
  const [available, setAvailable] = useState(true);
  const [seeded, setSeeded] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      }),
      Image.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder: "Your signature — name, role, phone, a logo…" }),
    ],
    editorProps: { attributes: { class: "richedit sig-edit", "aria-label": "Email signature" } },
  });

  // Seed availability + signature once `me` (and the editor) are ready.
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

  const pickImage = (file: File | undefined) => {
    if (!file || !editor) return;
    if (!file.type.startsWith("image/")) {
      onToast("That file isn't an image.");
      return;
    }
    if (file.size > 1_000_000) {
      onToast("Image is a bit large for a signature — keep it under 1 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => editor.chain().focus().setImage({ src: String(reader.result) }).run();
    reader.readAsDataURL(file);
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

  const save = () => {
    const html = editor?.getHTML() ?? "";
    const empty = !editor || (editor.getText().trim() === "" && !html.includes("<img"));
    update.mutate(
      { available, emailSignature: empty ? "" : html },
      {
        onSuccess: () => {
          onToast("Personal settings saved");
          onClose();
        },
        onError: () => onToast("Couldn’t save — please try again."),
      },
    );
  };

  const Btn = ({ mark, title, children, onClick }: { mark?: string; title: string; children: ReactNode; onClick: () => void }) => (
    <button
      type="button"
      className={"richbar__b" + (mark && editor?.isActive(mark) ? " on" : "")}
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );

  return createPortal(
    <div className="modal" onClick={onClose}>
      <div className="modal__box perssettings" ref={boxRef} role="dialog" aria-modal="true" aria-label="Personal settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Personal settings</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close"><XIcon /></button>
        </div>

        <div className="modal__body">
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
                <Btn mark="bulletList" title="Bulleted list" onClick={() => editor?.chain().focus().toggleBulletList().run()}>•&nbsp;—</Btn>
                <Btn mark="link" title="Insert link" onClick={toggleLink}>🔗</Btn>
                <Btn title="Insert image" onClick={() => fileRef.current?.click()}><ImageGlyph /></Btn>
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
        </div>

        <div className="modal__foot">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
