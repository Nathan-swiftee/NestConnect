import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { avatarBg, initials } from "../lib/format";
import { useGravatar } from "../lib/gravatar";

/**
 * An avatar that shows the contact's real Gravatar photo when they have one and
 * otherwise falls back to coloured initials (never a blank circle). `children`
 * render on top — used for the channel badge (`.ch`). Keep the same class names
 * the call sites used so all the existing sizing/positioning CSS still applies.
 */
export function Avatar({
  name,
  email,
  color,
  src,
  size,
  fontSize,
  className = "av",
  children,
}: {
  name: string;
  email?: string | null;
  color?: string | null;
  /** An explicit photo URL (e.g. an uploaded profile photo) — wins over Gravatar. */
  src?: string | null;
  size?: number;
  fontSize?: number;
  className?: string;
  children?: ReactNode;
}) {
  const gravatar = useGravatar(email);
  const url = src || gravatar;
  const [loaded, setLoaded] = useState(false);
  // A new url (thread/contact switch) starts unloaded again.
  useEffect(() => setLoaded(false), [url]);

  const style: CSSProperties = { background: avatarBg(name, color) };
  if (size != null) {
    style.width = size;
    style.height = size;
  }
  if (fontSize != null) style.fontSize = fontSize;

  return (
    <span className={className} style={style}>
      {initials(name)}
      {url && (
        <img
          className="av__photo"
          src={url}
          alt=""
          loading="lazy"
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
        />
      )}
      {children}
    </span>
  );
}
