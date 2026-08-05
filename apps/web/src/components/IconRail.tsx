import { useState } from "react";
import { useLogout, useMe, useSound } from "../hooks";
import { initials } from "../lib/format";
import { toggleTheme } from "../lib/theme";
import {
  Logo,
  InboxIcon,
  ContactsIcon,
  InsightsIcon,
  SettingsIcon,
  ThemeIcon,
  SoundOnIcon,
  SoundOffIcon,
} from "../lib/icons";

export function IconRail({
  onOpenSettings,
  onOpenCustomers,
}: {
  onOpenSettings: () => void;
  onOpenCustomers: () => void;
}) {
  const { data } = useMe();
  const me = data?.user;
  const logout = useLogout();
  const sound = useSound();
  const [menu, setMenu] = useState(false);

  return (
    <nav className="rail" aria-label="Primary">
      <div className="brandmark" title="Nest Connect">
        <Logo />
      </div>
      <button className="railbtn active" title="Inbox">
        <InboxIcon />
      </button>
      <button className="railbtn" title="Customers" onClick={onOpenCustomers}>
        <ContactsIcon />
      </button>
      <button className="railbtn" title="Insights">
        <InsightsIcon />
      </button>
      <button className="railbtn" title="Settings" onClick={onOpenSettings}>
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
      <button className="railbtn" title="Toggle theme" onClick={toggleTheme}>
        <ThemeIcon />
      </button>
      <div className="rail-avatar">
        <button
          className="avatar-me"
          title={me ? me.name : "You"}
          style={{ background: me?.avatarColor }}
          onClick={() => setMenu((v) => !v)}
        >
          {me ? initials(me.name) : "··"}
          <span className="pres" />
        </button>
        {menu && (
          <>
            <div className="rail-menu__backdrop" onClick={() => setMenu(false)} />
            <div className="rail-menu">
              <div className="rail-menu__id">
                <b>{me?.name}</b>
                <small>{me?.email}</small>
              </div>
              <button onClick={() => { setMenu(false); onOpenSettings(); }}>Settings</button>
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
