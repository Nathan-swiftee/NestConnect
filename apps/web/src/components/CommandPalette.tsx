import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useAssign, useMe } from "../hooks";
import { CmdIcon, ProfileIcon, RouteIcon, SnoozeIcon, PlusIcon } from "../lib/icons";

interface Props {
  conversationId: string | null;
  onClose: () => void;
  onSelectConversation: (id: string) => void;
  onToast: (msg: string) => void;
}

interface Cmd {
  group: string;
  label: string;
  sub?: string;
  icon: JSX.Element;
  run: () => void;
}

export function CommandPalette({ conversationId, onClose, onSelectConversation, onToast }: Props) {
  const assign = useAssign();
  const { data: me } = useMe();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commands = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [];
    if (conversationId) {
      list.push(
        {
          group: "Route & assign",
          label: "Assign to me",
          sub: "Take this conversation",
          icon: <ProfileIcon />,
          run: () => {
            assign.mutate({ id: conversationId, input: { assigneeUserId: me?.user.id ?? null } });
            onToast("Assigned to you");
          },
        },
        {
          group: "Route & assign",
          label: "Route to Sales team",
          sub: "Hand off to another team",
          icon: <RouteIcon />,
          run: () => {
            assign.mutate({ id: conversationId, input: { assigneeUserId: null, assignedTeamId: "team_sales" } });
            onToast("Routed to Sales team");
          },
        },
        {
          group: "Route & assign",
          label: "Snooze until tomorrow",
          sub: "Hide until 9:00",
          icon: <SnoozeIcon />,
          run: () => onToast("Snoozed until tomorrow 9:00"),
        },
      );
    }
    list.push(
      {
        group: "Jump to",
        label: "The Ivy House",
        sub: "WhatsApp group",
        icon: <CmdIcon />,
        run: () => onSelectConversation("conv_ivy"),
      },
      {
        group: "Jump to",
        label: "Tide & Co.",
        sub: "Email · onboarding",
        icon: <CmdIcon />,
        run: () => onSelectConversation("conv_tide"),
      },
      {
        group: "Create",
        label: "New inbox & route",
        sub: "Connect WhatsApp, group or email",
        icon: <PlusIcon />,
        run: () => onToast("New inbox flow"),
      },
    );
    return list;
  }, [conversationId, me, assign, onSelectConversation, onToast]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => (c.label + " " + (c.sub ?? "")).toLowerCase().includes(q));
  }, [commands, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Cmd[]>();
    for (const c of matches) {
      const arr = map.get(c.group) ?? [];
      arr.push(c);
      map.set(c.group, arr);
    }
    return [...map.entries()];
  }, [matches]);

  const runFirst = () => {
    const first = matches[0];
    if (first) {
      first.run();
      onClose();
    }
  };

  return (
    <div className="cmdk" onClick={onClose}>
      <div className="cmdk__box" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk__in">
          <CmdIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runFirst();
              if (e.key === "Escape") onClose();
            }}
            placeholder="Route, assign, snooze, jump to a conversation…"
          />
        </div>
        <div className="cmdk__list">
          {groups.map(([group, items]) => (
            <div key={group}>
              <div className="cmdk__grp">{group}</div>
              {items.map((c, i) => (
                <button
                  key={c.label}
                  className={"cmditem" + (matches[0] === c && i === 0 ? " sel" : "")}
                  onClick={() => {
                    c.run();
                    onClose();
                  }}
                >
                  <span className="ic">{c.icon}</span>
                  <span className="lbl">
                    {c.label}
                    {c.sub && <small>{c.sub}</small>}
                  </span>
                </button>
              ))}
            </div>
          ))}
          {matches.length === 0 && <div className="empty">No matches</div>}
        </div>
      </div>
    </div>
  );
}
