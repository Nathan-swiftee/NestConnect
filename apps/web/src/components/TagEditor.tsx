import { useState, type KeyboardEvent } from "react";
import { PlusIcon, XIcon } from "../lib/icons";

/** Free-form tag editor: removable pills, an add-input, and quick suggestions
 *  drawn from tags already in use elsewhere. Shared by the Customers page and
 *  the conversation details panel. */
export function TagEditor({
  tags,
  suggestions,
  onChange,
  label = "Tags",
}: {
  tags: string[];
  suggestions: string[];
  onChange: (next: string[]) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    onChange([...tags, t]);
    setDraft("");
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t));
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      remove(tags[tags.length - 1]);
    }
  };
  const open = suggestions.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()));
  return (
    <div className="field">
      {label && <span>{label}</span>}
      <div className="tagedit">
        {tags.map((t) => (
          <span className="tagpill" key={t}>
            {t}
            <button type="button" onClick={() => remove(t)} aria-label={`Remove ${t}`}>
              <XIcon />
            </button>
          </span>
        ))}
        <input
          className="tagedit__in"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={tags.length ? "Add another…" : "Add a tag…"}
        />
      </div>
      {open.length > 0 && (
        <div className="tagsug">
          {open.slice(0, 8).map((s) => (
            <button type="button" className="tagsug__b" key={s} onClick={() => add(s)}>
              <PlusIcon /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
