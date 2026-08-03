import { useMe } from "../hooks";
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

export function IconRail() {
  const { data } = useMe();
  const me = data?.user;
  return (
    <nav className="rail" aria-label="Primary">
      <div className="brandmark" title="ding">
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
      <div className="avatar-me" title={me ? `${me.name} · online` : "You"} style={{ background: me?.avatarColor }}>
        {me ? initials(me.name) : "··"}
        <span className="pres" />
      </div>
    </nav>
  );
}
