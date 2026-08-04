import { useLogout, useMe, useSound, useViews } from "../hooks";
import { InboxIcon, TeamIcon, ThemeIcon, SoundOnIcon, SoundOffIcon, XIcon, channelMeta } from "../lib/icons";
import { initials } from "../lib/format";
import { toggleTheme } from "../lib/theme";

interface Props {
  view: string;
  onSelectView: (key: string) => void;
  onClose?: () => void;
}

export function Sidebar({ view, onSelectView, onClose }: Props) {
  const { data } = useViews();
  const { data: meData } = useMe();
  const logout = useLogout();
  const sound = useSound();
  const me = meData?.user;
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
      <div className="side__scroll">
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
              <TeamIcon />
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
          return (
            <button
              key={i.key}
              className={"navrow" + (view === i.key ? " active" : "")}
              onClick={() => onSelectView(i.key)}
            >
              <span className="navicon chan" style={{ color: cm ? cm.color : "var(--text-faint)" }}>
                {Glyph ? <Glyph /> : <span className="cdot" style={{ background: "var(--text-faint)" }} />}
              </span>
              <span className="lbl">{i.title}</span>
              <span className={"badge" + (i.count > 0 ? " on" : "")}>{i.count}</span>
            </button>
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
