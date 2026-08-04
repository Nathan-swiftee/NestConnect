import { useEffect, useMemo, useState } from "react";
import { IconRail } from "./IconRail";
import { Sidebar } from "./Sidebar";
import { ConversationList } from "./ConversationList";
import { Thread } from "./Thread";
import { ContextPanel } from "./ContextPanel";
import { CommandPalette } from "./CommandPalette";
import { Settings } from "./Settings";
import { useConversations, useMediaQuery, useRealtime, useViews } from "../hooks";
import { unlock } from "../lib/sound";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useRealtime(selectedId);
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

  const pane = isMobile ? mobilePane : "both";

  return (
    <>
      <div className="stage">
        <div className={"app" + (drawerOpen ? " drawer-open" : "")} data-pane={pane}>
          <IconRail onOpenSettings={() => setSettingsOpen(true)} />
          {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
          <Sidebar
            view={view}
            onSelectView={selectView}
            onClose={isCompact ? () => setDrawerOpen(false) : undefined}
            onOpenSettings={() => { setSettingsOpen(true); setDrawerOpen(false); }}
          />
          <ConversationList
            view={view}
            title={meta.title}
            count={meta.count}
            selectedId={selectedId}
            onSelect={selectConversation}
            onOpenCmdk={() => setCmdkOpen(true)}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
          <Thread
            conversationId={selectedId}
            showPanel={showPanel}
            onTogglePanel={() => setShowPanel((v) => !v)}
            onToast={notify}
            onBack={isMobile ? () => setMobilePane("list") : undefined}
            onClosed={() => { if (isMobile) setMobilePane("list"); }}
          />
          {showPanel && (
            <>
              {isPanelOverlay && <div className="panel-backdrop" onClick={() => setShowPanel(false)} />}
              <ContextPanel
                conversationId={selectedId}
                onToast={notify}
                onClose={isPanelOverlay ? () => setShowPanel(false) : undefined}
              />
            </>
          )}
        </div>
      </div>

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

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} onToast={notify} />}

      <div className={"toast" + (toast ? " show" : "")}>
        <span className="dot" />
        <span>{toast}</span>
      </div>
    </>
  );
}
