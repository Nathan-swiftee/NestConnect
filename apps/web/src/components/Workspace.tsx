import { useEffect, useMemo, useState } from "react";
import { IconRail } from "./IconRail";
import { Sidebar } from "./Sidebar";
import { ConversationList } from "./ConversationList";
import { Thread } from "./Thread";
import { ContextPanel } from "./ContextPanel";
import { CommandPalette } from "./CommandPalette";
import { Compose } from "./Compose";
import { Settings } from "./Settings";
import { PersonalSettings } from "./PersonalSettings";
import { Customers } from "./Customers";
import { useConversations, useMediaQuery, useRealtime, useSnoozeSweep, useViews } from "../hooks";
import { unlock } from "../lib/sound";
import { readSidebarCollapsed, writeSidebarCollapsed } from "../lib/layout";

export function Workspace() {
  const isMobile = useMediaQuery("(max-width: 820px)");
  const isCompact = useMediaQuery("(max-width: 1023px)");
  const isPanelOverlay = useMediaQuery("(max-width: 1399px)");
  const [view, setView] = useState("inbound");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showPanel, setShowPanel] = useState(
    () => typeof window === "undefined" || !window.matchMedia("(max-width: 1399px)").matches,
  );
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [section, setSection] = useState<"inbox" | "customers" | "settings">("inbox");
  const [focusContact, setFocusContact] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [personalOpen, setPersonalOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);

  // The collapse only applies to the inline desktop sidebar; ≤1023 it's a drawer.
  const sidebarHidden = !isCompact && sidebarCollapsed;
  useEffect(() => writeSidebarCollapsed(sidebarCollapsed), [sidebarCollapsed]);

  useRealtime(selectedId);
  useSnoozeSweep();
  const views = useViews();
  const convos = useConversations(view);

  // Resume the audio context on the first user gesture (autoplay policy).
  useEffect(() => {
    const on = () => unlock();
    window.addEventListener("pointerdown", on, { once: true });
    window.addEventListener("keydown", on, { once: true });
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
  }, []);

  // Desktop auto-opens the first conversation; mobile stays on the list.
  useEffect(() => {
    if (!isMobile && !selectedId && convos.data && convos.data.length > 0) {
      const first = convos.data.find((c) => c.status !== "closed") ?? convos.data[0];
      setSelectedId(first.id);
    }
  }, [convos.data, selectedId, isMobile]);

  // Details panel: inline + open on wide screens, closed (opens as an overlay) below 1400.
  useEffect(() => {
    setShowPanel(!isPanelOverlay);
  }, [isPanelOverlay]);

  // Once the sidebar is inline again, tear down the drawer so it can't linger.
  useEffect(() => {
    if (!isCompact) setDrawerOpen(false);
  }, [isCompact]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const meta = useMemo(() => {
    const all = [
      ...(views.data?.my ?? []),
      ...(views.data?.shared.teams ?? []),
      ...(views.data?.shared.inboxes ?? []),
    ];
    const found = all.find((v) => v.key === view);
    return { title: found?.title ?? "Conversations", count: found?.count ?? 0 };
  }, [views.data, view]);

  const notify = (msg: string) => setToast(msg);

  const selectConversation = (id: string) => {
    setSelectedId(id);
    setMobilePane("thread");
  };
  const selectView = (key: string) => {
    setView(key);
    setDrawerOpen(false);
    setMobilePane("list");
  };
  // After closing / snoozing a conversation, jump straight to the next open one
  // in the list (wrapping to the top) so you can keep working the queue without
  // re-selecting. Falls back to the list when nothing's left.
  const goToNextAfterClosed = () => {
    const list = convos.data ?? [];
    const idx = list.findIndex((c) => c.id === selectedId);
    const ordered = idx >= 0 ? [...list.slice(idx + 1), ...list.slice(0, idx)] : list;
    const next = ordered.find((c) => c.id !== selectedId && c.status !== "closed");
    if (next) {
      setSelectedId(next.id);
      if (isMobile) setMobilePane("thread");
    } else {
      setSelectedId(null);
      if (isMobile) setMobilePane("list");
    }
  };

  const pane = isMobile ? mobilePane : "both";

  return (
    <>
      <div className="stage">
        <div className={"app" + (drawerOpen ? " drawer-open" : "")} data-pane={pane}>
          <IconRail
            section={section}
            onSection={(s) => { setSection(s); setFocusContact(null); }}
            onOpenPersonalSettings={() => setPersonalOpen(true)}
          />

          {section === "inbox" && (
            <>
              {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
              <Sidebar
                view={view}
                onSelectView={selectView}
                onSelectConversation={(id) => { selectConversation(id); setDrawerOpen(false); }}
                onClose={isCompact ? () => setDrawerOpen(false) : undefined}
                onOpenSettings={() => { setSection("settings"); setDrawerOpen(false); }}
                onOpenCustomers={() => { setSection("customers"); setDrawerOpen(false); }}
                onOpenPersonalSettings={() => { setPersonalOpen(true); setDrawerOpen(false); }}
                isCollapsed={sidebarHidden}
                onToggleCollapse={isCompact ? undefined : () => setSidebarCollapsed((v) => !v)}
              />
              <ConversationList
                view={view}
                title={meta.title}
                count={meta.count}
                selectedId={selectedId}
                onSelect={selectConversation}
                onOpenCmdk={() => setCmdkOpen(true)}
                onCompose={() => setComposeOpen(true)}
                onOpenDrawer={() => setDrawerOpen(true)}
                sidebarCollapsed={sidebarHidden}
                onExpandSidebar={() => setSidebarCollapsed(false)}
              />
              <Thread
                conversationId={selectedId}
                showPanel={showPanel}
                onTogglePanel={() => setShowPanel((v) => !v)}
                onToast={notify}
                onBack={isMobile ? () => setMobilePane("list") : undefined}
                onClosed={goToNextAfterClosed}
              />
              {showPanel && (
                <>
                  {isPanelOverlay && <div className="panel-backdrop" onClick={() => setShowPanel(false)} />}
                  <ContextPanel
                    conversationId={selectedId}
                    onToast={notify}
                    onClose={isPanelOverlay ? () => setShowPanel(false) : undefined}
                    onOpenConversation={selectConversation}
                    onOpenProfile={(cid) => { setFocusContact(cid); setSection("customers"); }}
                  />
                </>
              )}
            </>
          )}

          {section === "customers" && (
            <Customers
              onClose={() => { setSection("inbox"); setFocusContact(null); }}
              onToast={notify}
              onOpenConversation={(id) => { setSection("inbox"); setFocusContact(null); selectConversation(id); }}
              focusContactId={focusContact}
            />
          )}

          {section === "settings" && <Settings onClose={() => setSection("inbox")} onToast={notify} />}
        </div>
      </div>

      {personalOpen && <PersonalSettings onClose={() => setPersonalOpen(false)} onToast={notify} />}

      {cmdkOpen && (
        <CommandPalette
          conversationId={selectedId}
          onClose={() => setCmdkOpen(false)}
          onSelectConversation={(id) => {
            selectConversation(id);
            setCmdkOpen(false);
          }}
          onToast={notify}
        />
      )}

      {composeOpen && (
        <Compose
          onClose={() => setComposeOpen(false)}
          onOpen={(id) => {
            setSection("inbox");
            setFocusContact(null);
            selectConversation(id);
            setComposeOpen(false);
          }}
          onToast={notify}
        />
      )}

      <div className={"toast" + (toast ? " show" : "")}>
        <span className="dot" />
        <span>{toast}</span>
      </div>
    </>
  );
}
