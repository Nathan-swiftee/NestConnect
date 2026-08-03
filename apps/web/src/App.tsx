import { useEffect, useMemo, useState } from "react";
import { IconRail } from "./components/IconRail";
import { Sidebar } from "./components/Sidebar";
import { ConversationList } from "./components/ConversationList";
import { Thread } from "./components/Thread";
import { ContextPanel } from "./components/ContextPanel";
import { CommandPalette } from "./components/CommandPalette";
import { useConversations, useRealtime, useViews } from "./hooks";

export function App() {
  const [view, setView] = useState("inbound");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(true);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useRealtime(selectedId);
  const views = useViews();
  const convos = useConversations(view);

  // Pick the first conversation on first load so the thread isn't empty.
  useEffect(() => {
    if (!selectedId && convos.data && convos.data.length > 0) {
      setSelectedId(convos.data[0].id);
    }
  }, [convos.data, selectedId]);

  // ⌘K / Ctrl-K toggles the command palette.
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
    const t = window.setTimeout(() => setToast(null), 2000);
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

  return (
    <>
      <div className="stage">
        <div className="app">
          <IconRail />
          <Sidebar view={view} onSelectView={setView} onToast={notify} />
          <ConversationList
            view={view}
            title={meta.title}
            count={meta.count}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenCmdk={() => setCmdkOpen(true)}
          />
          <Thread
            conversationId={selectedId}
            showPanel={showPanel}
            onTogglePanel={() => setShowPanel((v) => !v)}
            onToast={notify}
          />
          {showPanel && <ContextPanel conversationId={selectedId} />}
        </div>
      </div>

      {cmdkOpen && (
        <CommandPalette
          conversationId={selectedId}
          onClose={() => setCmdkOpen(false)}
          onSelectConversation={(id) => {
            setSelectedId(id);
            setCmdkOpen(false);
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
