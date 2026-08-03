import { useEffect, useMemo, useState } from "react";
import { IconRail } from "./IconRail";
import { Sidebar } from "./Sidebar";
import { ConversationList } from "./ConversationList";
import { Thread } from "./Thread";
import { ContextPanel } from "./ContextPanel";
import { CommandPalette } from "./CommandPalette";
import { CreateInboxModal } from "./CreateInboxModal";
import { CreateGroupModal } from "./CreateGroupModal";
import { useConversations, useRealtime, useViews } from "../hooks";

export function Workspace() {
  const [view, setView] = useState("inbound");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(true);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [newInboxOpen, setNewInboxOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useRealtime(selectedId);
  const views = useViews();
  const convos = useConversations(view);

  useEffect(() => {
    if (!selectedId && convos.data && convos.data.length > 0) {
      setSelectedId(convos.data[0].id);
    }
  }, [convos.data, selectedId]);

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

  return (
    <>
      <div className="stage">
        <div className="app">
          <IconRail onToast={notify} />
          <Sidebar
            view={view}
            onSelectView={setView}
            onNewInbox={() => setNewInboxOpen(true)}
            onNewGroup={() => setNewGroupOpen(true)}
          />
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
          {showPanel && <ContextPanel conversationId={selectedId} onToast={notify} />}
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
