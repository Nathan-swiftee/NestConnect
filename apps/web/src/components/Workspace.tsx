import { useEffect, useMemo, useState } from "react";
import { IconRail } from "./IconRail";
import { Sidebar } from "./Sidebar";
import { ConversationList } from "./ConversationList";
import { Thread } from "./Thread";
import { ContextPanel } from "./ContextPanel";
import { CommandPalette } from "./CommandPalette";
import { CreateInboxModal } from "./CreateInboxModal";
import { CreateGroupModal } from "./CreateGroupModal";
import { useConversations, useMediaQuery, useRealtime, useViews } from "../hooks";
import { unlock } from "../lib/sound";

export function Workspace() {
  const isMobile = useMediaQuery("(max-width: 860px)");
  const isNarrow = useMediaQuery("(max-width: 1180px)");
  const [view, setView] = useState("inbound");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showPanel, setShowPanel] = useState(
    () => typeof window === "undefined" || !window.matchMedia("(max-width: 1180px)").matches,
  );
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [newInboxOpen, setNewInboxOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
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
      setSelectedId(convos.data[0].id);
    }
  }, [convos.data, selectedId, isMobile]);

  // Details panel: inline + open on desktop, closed (opens as an overlay) when narrow.
  useEffect(() => {
    setShowPanel(!isNarrow);
  }, [isNarrow]);

  // Leaving mobile tears down the drawer so it can't linger over the desktop layout.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

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
          <IconRail onToast={notify} />
          {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
          <Sidebar
            view={view}
            onSelectView={selectView}
            onNewInbox={() => { setNewInboxOpen(true); setDrawerOpen(false); }}
            onNewGroup={() => { setNewGroupOpen(true); setDrawerOpen(false); }}
            onClose={isMobile ? () => setDrawerOpen(false) : undefined}
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
              {isNarrow && <div className="panel-backdrop" onClick={() => setShowPanel(false)} />}
              <ContextPanel
                conversationId={selectedId}
                onToast={notify}
                onClose={isNarrow ? () => setShowPanel(false) : undefined}
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

      {newInboxOpen && (
        <CreateInboxModal onClose={() => setNewInboxOpen(false)} onToast={notify} onSelectView={setView} />
      )}

      {newGroupOpen && (
        <CreateGroupModal onClose={() => setNewGroupOpen(false)} onToast={notify} onSelectView={setView} />
      )}

      <div className={"toast" + (toast ? " show" : "")}>
        <span className="dot" />
        <span>{toast}</span>
      </div>
    </>
  );
}
