import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { useAssign, useConversations, useMe, useSnooze, useTeams } from "../hooks";
import { channelMeta, BackIcon, ProfileIcon, RouteIcon, SnoozeIcon, SearchIcon } from "../lib/icons";
import { useScrollLock } from "../lib/useScrollLock";
import { useHoverGlide } from "../lib/useHoverGlide";

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
  /** Keep the palette open after running (e.g. drilling into a sub-list). */
  keepOpen?: boolean;
}

export function CommandPalette({ conversationId, onClose, onSelectConversation, onToast }: Props) {
  const assign = useAssign();
  const snooze = useSnooze();
  const { data: me } = useMe();
  const { data: teams } = useTeams();
  const { data: convs } = useConversations("inbound");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"root" | "route">("root");
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useScrollLock(boxRef);
  const { containerRef: listRef, thumbRef: glideRef, hoverProps: listHover } = useHoverGlide<HTMLDivElement>(".cmditem", "xy");

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const routeTo = (teamId: string, name: string) => {
    if (!conversationId) return;
    assign.mutate({ id: conversationId, input: { assigneeUserId: null, assignedTeamId: teamId } });
    onToast(`Routed to ${name}`);
  };

  const commands = useMemo<Cmd[]>(() => {
    // Second step of "Route to…" — every team is a target.
    if (mode === "route") {
      return (teams ?? []).map((t) => ({
        group: "Route to team",
        label: t.name,
        icon: <RouteIcon />,
        run: () => routeTo(t.id, t.name),
      }));
    }

    const list: Cmd[] = [];
    if (conversationId) {
      list.push(
        {
          group: "This conversation",
          label: "Assign to me",
          sub: "Take this conversation",
          icon: <ProfileIcon />,
          run: () => {
            assign.mutate({ id: conversationId, input: { assigneeUserId: me?.user.id ?? null } });
            onToast("Assigned to you");
          },
        },
        {
          group: "This conversation",
          label: "Route to…",
          sub: "Hand off to a team",
          icon: <RouteIcon />,
          keepOpen: true,
          run: () => {
            setQuery("");
            setMode("route");
          },
        },
        {
          group: "This conversation",
          label: "Snooze until tomorrow",
          sub: "Wakes at 9:00 AM",
          icon: <SnoozeIcon />,
          run: () => {
            if (!conversationId) return;
            const d = new Date();
            d.setDate(d.getDate() + 1);
            d.setHours(9, 0, 0, 0);
            snooze.mutate({ id: conversationId, until: d.toISOString() });
            onToast("Snoozed · tomorrow 9 AM");
          },
        },
      );
    }

    // Jump straight to any of your open conversations.
    for (const c of convs ?? []) {
      const cm = channelMeta(c.channel);
      const Glyph = cm.Glyph;
      list.push({
        group: "Go to conversation",
        label: c.contact.displayName,
        sub: c.preview ? `${cm.label} · ${c.preview}` : cm.label,
        icon: (
          <span className="cmditem__ch" style={{ color: cm.color }}>
            <Glyph />
          </span>
        ),
        run: () => onSelectConversation(c.id),
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, conversationId, me, teams, convs]);

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
      if (!first.keepOpen) onClose();
    }
  };

  const goBack = () => {
    setMode("root");
    setQuery("");
  };

  return createPortal(
    <div className="cmdk" onClick={onClose}>
      <div className="cmdk__box" ref={boxRef} onClick={(e) => e.stopPropagation()}>
        <div className="cmdk__in">
          {mode === "route" ? (
            <button className="cmdk__back" onClick={goBack} title="Back" aria-label="Back">
              <BackIcon />
            </button>
          ) : (
            <SearchIcon />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runFirst();
              if (e.key === "Escape") {
                if (mode === "route") goBack();
                else onClose();
              }
            }}
            placeholder={mode === "route" ? "Route to which team?" : "Search conversations, route, assign, snooze…"}
          />
        </div>
        <div className="cmdk__list" ref={listRef} {...listHover}>
          <span className="glide" ref={glideRef} aria-hidden="true" />
          {groups.map(([group, items]) => (
            <div key={group}>
              <div className="cmdk__grp">{group}</div>
              {items.map((c) => (
                <button
                  key={group + c.label}
                  className={"cmditem" + (matches[0] === c ? " sel" : "")}
                  onClick={() => {
                    c.run();
                    if (!c.keepOpen) onClose();
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
    </div>,
    document.body,
  );
}
