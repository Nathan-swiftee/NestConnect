import { useEffect, useState } from "react";
import { useLogout, useMe, useSound, useTheme, useUpdateMyPreferences } from "../hooks";
import { initials, avatarBg } from "../lib/format";
import { toggleTheme } from "../lib/theme";
import {
  Logo,
  InboxIcon,
  ContactsIcon,
  InsightsIcon,
  SettingsIcon,
  ThemeIcon,
  SunIcon,
  SoundOnIcon,
  SoundOffIcon,
} from "../lib/icons";

type Section = "inbox" | "customers" | "settings";

export function IconRail({
  section,
  onSection,
  onOpenPersonalSettings,
}: {
  section: Section;
  onSection: (s: Section) => void;
  onOpenPersonalSettings: () => void;
}) {
  const { data } = useMe();
  const me = data?.user;
  const logout = useLogout();
  const sound = useSound();
  const theme = useTheme();
  const prefs = useUpdateMyPreferences();
  const [menu, setMenu] = useState(false);
  // Availability, tracked locally for an instant toggle; synced from the server.
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    if (me) setAvailable(me.available);
  }, [me?.available]);
  const toggleAvailable = () => {
    const next = !available;
    setAvailable(next);
    prefs.mutate({ available: next }, { onError: () => setAvailable(!next) });
  };

  return (
    <nav className="rail" aria-label="Primary">
      <div className="brandmark" title="Nest Connect">
        <Logo />
      </div>
      <button
        className={"railbtn" + (section === "inbox" ? " active" : "")}
        title="Inbox"
        onClick={() => onSection("inbox")}
      >
        <InboxIcon />
      </button>
      <button
        className={"railbtn" + (section === "customers" ? " active" : "")}
        title="Customers"
        onClick={() => onSection("customers")}
      >
        <ContactsIcon />
      </button>
      <button className="railbtn" title="Insights">
        <InsightsIcon />
      </button>
      <button
        className={"railbtn" + (section === "settings" ? " active" : "")}
        title="Settings"
        onClick={() => onSection("settings")}
      >
        <SettingsIcon />
      </button>
      <div className="spacer" />
      <button
        className={"railbtn" + (sound.on ? " active" : "")}
        title={sound.on ? "Mute sounds" : "Unmute sounds"}
        onClick={sound.toggle}
      >
        {sound.on ? <SoundOnIcon /> : <SoundOffIcon />}
      </button>
      <button
        className="railbtn"
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        onClick={toggleTheme}
      >
        {theme === "dark" ? <SunIcon /> : <ThemeIcon />}
      </button>
      <div className="rail-avatar">
        <button
          className="avatar-me"
          title={me ? me.name : "You"}
          style={{ background: avatarBg(me?.name ?? "", me?.avatarColor) }}
          onClick={() => setMenu((v) => !v)}
        >
          {me?.avatarUrl ? <img className="av__photo" src={me.avatarUrl} alt="" /> : me ? initials(me.name) : "··"}
          <span className={"pres" + (available ? "" : " pres--away")} />
        </button>
        {menu && (
          <>
            <div className="rail-menu__backdrop" onClick={() => setMenu(false)} />
            <div className="rail-menu">
              <div className="rail-menu__id">
                <b>{me?.name}</b>
                <small>{me?.email}</small>
              </div>
              <button
                type="button"
                className="rail-menu__avail"
                role="switch"
                aria-checked={available}
                onClick={toggleAvailable}
              >
                <span className={"pres-dot" + (available ? " on" : " away")} />
                <span className="rail-menu__availlbl">{available ? "Available" : "Unavailable"}</span>
                <span className={"switch sm" + (available ? " on" : "")}>
                  <span className="switch__dot" />
                </span>
              </button>
              <button onClick={() => { setMenu(false); onOpenPersonalSettings(); }}>Personal settings</button>
              <button onClick={() => { setMenu(false); onSection("settings"); }}>Settings</button>
              <button className="danger" onClick={() => logout.mutate()}>
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
