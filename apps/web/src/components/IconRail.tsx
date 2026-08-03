import { useState } from "react";
import { useLogout, useMe } from "../hooks";
import { initials } from "../lib/format";
import {
  Logo,
  InboxIcon,
  ContactsIcon,
  InsightsIcon,
  SettingsIcon,
  ThemeIcon,
} from "../lib/icons";

function toggleTheme() {
  const root = document.documentElement;
  let cur = root.getAttribute("data-theme");
  if (!cur) cur = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  root.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
}

export function IconRail({ onToast }: { onToast: (msg: string) => void }) {
  const { data } = useMe();
  const me = data?.user;
  const logout = useLogout();
  const [menu, setMenu] = useState(false);

  return (
    <nav className="rail" aria-label="Primary">
      <div className="brandmark" title="Relay">
        <Logo />
      </div>
      <button className="railbtn active" title="Inbox">
        <InboxIcon />
      </button>
      <button className="railbtn" title="Contacts">
        <ContactsIcon />
      </button>
      <button className="railbtn" title="Insights">
        <InsightsIcon />
      </button>
      <button className="railbtn" title="Settings">
        <SettingsIcon />
      </button>
      <div className="spacer" />
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
              <button onClick={() => { setMenu(false); onToast("Settings — coming soon"); }}>Settings</button>
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
