import { useEffect, type ReactNode } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";

/**
 * The editor for customer knowledge — SOP instructions and notes.
 *
 * The same TipTap the reply box and signature use, cut down to structure:
 * headings, lists, emphasis, quotes and links. No colours or fonts — this is
 * reference material, and it should read the same whoever wrote it. The server
 * sanitises what's saved (accounts/knowledge-html.ts) to exactly these tags.
 */
export function KnowledgeEditor({
  value,
  onChange,
  placeholder,
  label,
  minHeight = 160,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  label: string;
  minHeight?: number;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value || "",
    editorProps: { attributes: { class: "richedit kedit", "aria-label": label, style: `min-height:${minHeight}px` } },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
  });

  // An outside reset (e.g. opening a different SOP in the same editor).
  useEffect(() => {
    if (!editor) return;
    if ((value || "") !== (editor.isEmpty ? "" : editor.getHTML())) editor.commands.setContent(value || "", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  const toggleLink = () => {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("Link address (https://…)");
    if (!url) return;
    const href = /^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  const Btn = ({ on, title, onClick, children }: { on?: boolean; title: string; onClick: () => void; children: ReactNode }) => (
    <button type="button" className={"richbar__b" + (on ? " on" : "")} title={title} aria-label={title} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );

  return (
    <div className="kedit-wrap">
      <div className="richbar" role="toolbar" aria-label={`${label} formatting`}>
        <Btn title="Heading" on={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H</Btn>
        <Btn title="Subheading" on={editor?.isActive("heading", { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}><small>H</small></Btn>
        <span className="richbar__sep" aria-hidden="true" />
        <Btn title="Bold" on={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></Btn>
        <Btn title="Italic" on={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></Btn>
        <Btn title="Underline" on={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></Btn>
        <span className="richbar__sep" aria-hidden="true" />
        <Btn title="Numbered list" on={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</Btn>
        <Btn title="Bulleted list" on={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</Btn>
        <Btn title="Quote / callout" on={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>❝</Btn>
        <Btn title={editor?.isActive("link") ? "Remove link" : "Insert link"} on={editor?.isActive("link")} onClick={toggleLink}>🔗</Btn>
      </div>
      <EditorContent editor={editor} className="kedit-host" />
    </div>
  );
}

/** Knowledge HTML as stored — already sanitised by the server. */
export function KnowledgeView({ html, empty }: { html: string; empty?: string }) {
  if (!html) return empty ? <p className="org-muted">{empty}</p> : null;
  return <div className="kview" dangerouslySetInnerHTML={{ __html: html }} />;
}
