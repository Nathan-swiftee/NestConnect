import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { Contact } from "@ding/schemas";
import { isEmailAddress, parseAddressList, recipientSuggestions } from "@ding/schemas";
import { Avatar } from "./Avatar";
import { XIcon } from "../lib/icons";

/**
 * An email address field that knows the customers: type a name, company or
 * address and pick from the directory, or type any address and press Enter,
 * comma or space. Each recipient becomes a chip; Backspace on an empty field
 * takes the last one back. Used by Forward and by Cc/Bcc.
 */
export function RecipientField({
  value,
  onChange,
  contacts,
  placeholder,
  ariaLabel,
  autoFocus,
  compact,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  contacts: Contact[];
  placeholder?: string;
  ariaLabel: string;
  autoFocus?: boolean;
  /** The composer's one-line Cc/Bcc rows, rather than a form field. */
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [sel, setSel] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const byEmail = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) if (c.email) m.set(c.email.toLowerCase(), c);
    return m;
  }, [contacts]);
  const suggestions = focused ? recipientSuggestions(contacts, text, value) : [];

  const add = (addresses: string[]) => {
    const next = [...value];
    for (const a of addresses) if (a && !next.includes(a)) next.push(a);
    onChange(next);
    setText("");
    setSel(0);
  };
  /** Whatever is typed, as chips — on Enter, comma, space, Tab or leaving the field. */
  const commitTyped = () => {
    if (text.trim()) add(parseAddressList(text));
  };
  const remove = (a: string) => onChange(value.filter((x) => x !== a));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setSel((i) => (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
      return;
    }
    if (e.key === "Enter" || e.key === "Tab" || e.key === "," || e.key === ";" || (e.key === " " && text.includes("@"))) {
      // A highlighted suggestion wins over a half-typed name, unless what's
      // typed is already a whole address.
      const pick = suggestions[sel];
      if (pick?.email && !isEmailAddress(text)) {
        e.preventDefault();
        add([pick.email.toLowerCase()]);
        return;
      }
      if (text.trim()) {
        e.preventDefault();
        commitTyped();
        return;
      }
      // Nothing typed: Tab moves on, Enter submits the form as usual.
      return;
    }
    if (e.key === "Backspace" && !text && value.length) {
      e.preventDefault();
      onChange(value.slice(0, -1));
      return;
    }
    if (e.key === "Escape" && text) {
      e.stopPropagation();
      setText("");
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (/[,;\s]/.test(pasted.trim())) {
      e.preventDefault();
      add(parseAddressList(pasted));
    }
  };

  return (
    <div className={"rcptfield" + (compact ? " rcptfield--compact" : "")} onClick={() => inputRef.current?.focus()}>
      {value.map((a) => {
        const known = byEmail.get(a);
        const ok = isEmailAddress(a);
        return (
          <span key={a} className={"rcptchip" + (ok ? "" : " rcptchip--bad")} title={ok ? a : `“${a}” isn't a valid email address`}>
            {known ? known.displayName : a}
            <button
              type="button"
              className="rcptchip__x"
              aria-label={`Remove ${known?.displayName ?? a}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(a);
              }}
            >
              <XIcon />
            </button>
          </span>
        );
      })}
      <input
        ref={inputRef}
        value={text}
        aria-label={ariaLabel}
        placeholder={value.length ? "" : placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        inputMode="email"
        onChange={(e) => {
          setText(e.target.value);
          setSel(0);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          // Leaving the field keeps a finished address, not a half-typed name.
          if (text.includes("@")) commitTyped();
        }}
      />
      {suggestions.length > 0 && (
        <div className="rcptpop" role="listbox" aria-label="Matching customers">
          {suggestions.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === sel}
              className={"rcptpop__row" + (i === sel ? " sel" : "")}
              onMouseEnter={() => setSel(i)}
              // Before the input's blur, so the pick isn't lost to it.
              onMouseDown={(e) => {
                e.preventDefault();
                add([c.email!.toLowerCase()]);
              }}
            >
              <Avatar name={c.displayName} email={c.email} color={c.avatarColor} className="av rcptpop__av" />
              <span className="rcptpop__meta">
                <b>{c.displayName}</b>
                <small>
                  {c.email}
                  {c.company ? ` · ${c.company}` : ""}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Whether every recipient in the field is a usable address (and there's at least one). */
export function recipientsReady(list: string[]): boolean {
  return list.length > 0 && list.every(isEmailAddress);
}
