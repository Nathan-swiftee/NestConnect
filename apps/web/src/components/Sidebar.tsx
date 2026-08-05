import { useLayoutEffect, useRef, useState } from "react";
import { useLogout, useMe, useSound, useTeams, useViews } from "../hooks";
import {
  ChevronRight,
  ContactsIcon,
  InboxIcon,
  TeamGlyph,
  ThemeIcon,
  SoundOnIcon,
  SoundOffIcon,
  SettingsIcon,
  XIcon,
  channelMeta,
} from "../lib/icons";
import { initials } from "../lib/format";
import { toggleTheme } from "../lib/theme";

interface Props {
  view: string;
  onSelectView: (key: string) => void;
  onSelectConversation?: (id: string) => void;
  onClose?: () => void;
  onOpenSettings?: () => void;
  onOpenCustomers?: () => void;
}

export function Sidebar({ view, onSelectView, onSelectConversation, onClose, onOpenSettings, onOpenCustomers }: Props) {
  const { data } = useViews();
  const { data: meData } = useMe();
  const { data: teamList } = useTeams();
  const logout = useLogout();
  const sound = useSound();
  const me = meData?.user;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const teamIconFor = (key: string) => teamList?.find((tm) => `team:${tm.id}` === key)?.icon ?? null;
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // Slide a single "capsule" highlight to the active view row (nav or sub),
  // so switching inboxes/channels animates instead of hard-jumping.
  const scrollRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const firstMove = useRef(true);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const thumb = thumbRef.current;
    if (!scroll || !thumb) return;
    const move = () => {
      const active = scroll.querySelector<HTMLElement>(".navrow.active, .subrow.active");
      if (!active) {
        thumb.style.opacity = "0";
        return;
      }
      const apply = () => {
        thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
        thumb.style.width = `${active.offsetWidth}px`;
        thumb.style.height = `${active.offsetHeight}px`;
        thumb.style.opacity = "1";
      };
      if (firstMove.current) {
        // Place it without animating on first paint (no slide-from-origin flash).
        thumb.style.transition = "none";
        apply();
        void thumb.offsetHeight; // force reflow so the next change transitions
        thumb.style.transition = "";
        firstMove.current = false;
      } else {
        apply();
      }
    };
    move();
    window.addEventListener("resize", move);
    return () => window.removeEventListener("resize", move);
  }, [view, data, collapsed, teamList]);

  if (!data) return <aside className="side" aria-label="Inboxes" />;

  const inbound = data.my.find((m) => m.key === "inbound");
  const subs = data.my.filter((m) => m.key !== "inbound");

  return (
    <aside className="side" aria-label="Inboxes">
      <div className="side__head">
        <span className="wordmark">
          Nest <span className="dot">Connect</span>
        </span>
        <span className="side__sub">Swiftee</span>
        {onClose && (
          <button className="side__close" onClick={onClose} aria-label="Close menu" title="Close">
            <XIcon />
          </button>
        )}
      </div>
      <div className="side__scroll" ref={scrollRef}>
        <span className="navthumb" ref={thumbRef} aria-hidden="true" />
        <div className="sect-label">
          My space <span className="line" />
        </div>
        {inbound && (
          <button
            className={"navrow" + (view === inbound.key ? " active" : "")}
            onClick={() => onSelectView(inbound.key)}
          >
            <span className="navicon">
              <InboxIcon />
            </span>
            <span className="lbl">{inbound.title}</span>
            <span className="badge on">{inbound.count}</span>
          </button>
        )}
        <div className="sub">
          {subs.map((s) => (
            <button
              key={s.key}
              className={"subrow" + (view === s.key ? " active" : "")}
              onClick={() => onSelectView(s.key)}
            >
              <span className="mk" />
              <span className="lbl">{s.title}</span>
              <span className="n">{s.count}</span>
            </button>
          ))}
        </div>

        <div className="sect-label">
          Team Inboxes <span className="line" />
        </div>
        {data.shared.teams.map((t) => (
          <button
            key={t.key}
            className={"navrow" + (view === t.key ? " active" : "")}
            onClick={() => onSelectView(t.key)}
          >
            <span className="navicon">
              <TeamGlyph icon={teamIconFor(t.key)} />
            </span>
            <span className="lbl">{t.title}</span>
            <span className="badge">{t.count}</span>
          </button>
        ))}

        <div className="sect-label">
          Channels <span className="line" />
        </div>
        {data.shared.inboxes.map((i) => {
          const cm = i.channel ? channelMeta(i.channel) : null;
          const Glyph = cm?.Glyph;
          const groups = i.groups ?? [];
          const open = groups.length > 0 && !collapsed[i.key];
          const gm = channelMeta("whatsapp_group");
          const GroupGlyph = gm.Glyph;
          return (
            <div key={i.key}>
              <button
                className={"navrow" + (view === i.key ? " active" : "")}
                onClick={() => onSelectView(i.key)}
              >
                <span className="navicon chan" style={{ color: cm ? cm.color : "var(--text-faint)" }}>
                  {Glyph ? <Glyph /> : <span className="cdot" style={{ background: "var(--text-faint)" }} />}
                </span>
                <span className="lbl">{i.title}</span>
                {groups.length > 0 && (
                  <span
                    className={"navchev" + (open ? " open" : "")}
                    role="button"
                    tabIndex={-1}
                    title={open ? "Collapse groups" : "Show groups"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(i.key);
                    }}
                  >
                    <ChevronRight />
                  </span>
                )}
                <span className={"badge" + (i.count > 0 ? " on" : "")}>{i.count}</span>
              </button>
              {open && (
                <div className="sub">
                  {groups.map((g) => (
                    <button key={g.id} className="subrow" onClick={() => onSelectConversation?.(g.id)}>
                      <span className="navicon" style={{ color: gm.color, width: 16, flex: "0 0 16px" }}>
                        <GroupGlyph />
                      </span>
                      <span className="lbl">{g.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

      </div>

      <div className="side__foot">
        <div className="side__me">
          <span className="av" style={{ background: me?.avatarColor, width: 34, height: 34, fontSize: 12 }}>
            {me ? initials(me.name) : "··"}
          </span>
          <div className="side__me-id">
            <b>{me?.name ?? "You"}</b>
            <small>{me?.email}</small>
          </div>
        </div>
        <div className="side__foot-actions">
          {onOpenCustomers && (
            <button className="iconbtn" title="Customers" onClick={onOpenCustomers}>
              <ContactsIcon />
            </button>
          )}
          {onOpenSettings && (
            <button className="iconbtn" title="Settings" onClick={onOpenSettings}>
              <SettingsIcon />
            </button>
          )}
          <button className="iconbtn" title="Toggle theme" onClick={toggleTheme}>
            <ThemeIcon />
          </button>
          <button
            className={"iconbtn" + (sound.on ? " on" : "")}
            title={sound.on ? "Mute sounds" : "Unmute sounds"}
            onClick={sound.toggle}
          >
            {sound.on ? <SoundOnIcon /> : <SoundOffIcon />}
          </button>
          <button className="side__signout" onClick={() => logout.mutate()}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
