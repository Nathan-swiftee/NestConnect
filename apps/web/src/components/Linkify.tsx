import { Fragment } from "react";
import { linkParts } from "@ding/schemas";

/**
 * Text with the links in it clickable: web addresses (with or without
 * "https://"), and email addresses. See `linkParts` for what counts.
 *
 * A click opens the link and nothing else — the bubble it sits in has its own
 * click behaviour (selecting, the message menu), which a link shouldn't set off.
 */
export function Linkify({ text, className = "msglink" }: { text: string; className?: string }) {
  const parts = linkParts(text);
  if (parts.length === 1 && !parts[0]!.href) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.href ? (
          <a
            key={i}
            className={className}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
