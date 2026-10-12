import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { ICON_STROKE } from "@ding/design/icons";
import { api } from "../lib/api";
import { ImageIcon } from "../lib/icons";

/**
 * The rich editor email signatures are written in: text, formatting, links and
 * pictures. It was the personal signature's editor; the channel signature (the
 * layout and the marketing section under it) uses the same one, so anyone who
 * wrote a signature before finds the same toolbar.
 *
 * Images are uploaded and referenced by their hosted https URL — tiny HTML, and
 * a picture that loads in the customer's mail client.
 */

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

/**
 * Text-alignment glyphs (the short lines shift to hint the alignment).
 *
 * The only glyphs drawn outside `@ding/design/icons`, because they're a set of
 * three that mean nothing apart and exist solely for this toolbar. They still
 * follow the system: same margins as `menu`, same stroke, round caps.
 */
function AlignGlyph({ dir }: { dir: "left" | "center" | "right" }) {
  const paths: Record<typeof dir, string> = {
    left: "M4 5.6h16M4 9.9h10.4M4 14.1h16M4 18.4h10.4",
    center: "M4 5.6h16M6.8 9.9h10.4M4 14.1h16M6.8 18.4h10.4",
    right: "M4 5.6h16M9.6 9.9h10.4M4 14.1h16M9.6 18.4h10.4",
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[dir]} stroke="currentColor" strokeWidth={ICON_STROKE} />
    </svg>
  );
}

/** Whether the editor's HTML holds anything worth keeping. */
export function richHtmlIsEmpty(html: string): boolean {
  return !html.replace(/<[^>]*>/g, "").trim() && !/<img\b/i.test(html);
}

export function RichSignatureEditor({
  initialHtml,
  onChange,
  placeholder,
  label,
  tokens,
  onToast,
}: {
  /** Read once, when the editor starts. Remount (change `key`) to load another. */
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder: string;
  label: string;
  /** Tags offered as chips under the toolbar, dropped in at the caret. */
  tokens?: ReadonlyArray<{ token: string; label: string }>;
  onToast: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

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
      Placeholder.configure({ placeholder }),
    ],
    content: initialHtml,
    editorProps: { attributes: { class: "richedit sig-edit", "aria-label": label } },
    onUpdate: ({ editor }) => changeRef.current(editor.getHTML()),
  });

  // Re-render the toolbar's on/off states as the selection moves.
  const [, bump] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const tick = () => bump((n) => n + 1);
    editor.on("selectionUpdate", tick);
    editor.on("transaction", tick);
    return () => {
      editor.off("selectionUpdate", tick);
      editor.off("transaction", tick);
    };
  }, [editor]);

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
    setUploading(true);
    try {
      const att = await api.uploadMedia(file, { kind: "image", filename: file.name });
      const src = new URL(att.url, window.location.origin).href;
      editor.chain().focus().setImage({ src }).run();
    } catch {
      onToast("Couldn’t upload that image — please try again.");
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

  return (
    <div className="sig-editor">
      <div className="richbar" role="toolbar" aria-label={`${label} formatting`}>
        <Btn mark="bold" title="Bold" onClick={() => editor?.chain().focus().toggleBold().run()}>
          <b>B</b>
        </Btn>
        <Btn mark="italic" title="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <i>I</i>
        </Btn>
        <Btn mark="underline" title="Underline" onClick={() => editor?.chain().focus().toggleUnderline().run()}>
          <u>U</u>
        </Btn>
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
        <Btn title="Align left" active={editor?.isActive({ textAlign: "left" })} onClick={() => editor?.chain().focus().setTextAlign("left").run()}>
          <AlignGlyph dir="left" />
        </Btn>
        <Btn title="Align centre" active={editor?.isActive({ textAlign: "center" })} onClick={() => editor?.chain().focus().setTextAlign("center").run()}>
          <AlignGlyph dir="center" />
        </Btn>
        <Btn title="Align right" active={editor?.isActive({ textAlign: "right" })} onClick={() => editor?.chain().focus().setTextAlign("right").run()}>
          <AlignGlyph dir="right" />
        </Btn>
        <span className="richbar__sep" aria-hidden="true" />
        <Btn mark="bulletList" title="Bulleted list" onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          •&nbsp;—
        </Btn>
        <Btn mark="link" title="Insert link" onClick={toggleLink}>
          🔗
        </Btn>
        <Btn title={uploading ? "Uploading…" : "Insert image"} disabled={uploading} onClick={() => fileRef.current?.click()}>
          <ImageIcon />
        </Btn>
      </div>
      {tokens?.length ? (
        <div className="sig-tokens" aria-label="Insert a detail">
          {tokens.map((t) => (
            <button
              key={t.token}
              type="button"
              className="setfilterchip"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor?.chain().focus().insertContent(`{{${t.token}}}`).run()}
            >
              + {t.label}
            </button>
          ))}
        </div>
      ) : null}
      <EditorContent editor={editor} className="sig-host" />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void pickImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
