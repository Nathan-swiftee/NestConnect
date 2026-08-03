import { useEffect, useState } from "react";
import type { ChannelType } from "@ding/schemas";
import { useConversation } from "../hooks";
import { slaCountdown } from "../lib/format";
import { channelMeta, PhoneIcon, MailIcon, ProfileIcon } from "../lib/icons";

const TEAM_NAME: Record<string, string> = {
  team_support: "Support team",
  team_sales: "Sales team",
};

interface Props {
  conversationId: string | null;
}

export function ContextPanel({ conversationId }: Props) {
  const { data: conv } = useConversation(conversationId);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!conv?.slaDueAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [conv?.slaDueAt]);

  if (!conv) return <aside className="panel" aria-label="Details" />;

  const others = (["whatsapp", "email", "whatsapp_group"] as ChannelType[]).filter(
    (t) => t !== conv.channel,
  );
  const highPriority = conv.priority === "high" || conv.priority === "urgent";

  return (
    <aside className="panel" aria-label="Details">
      <div className="panel__scroll">
        <div className="cust">
          <div className="big" style={{ background: conv.contact.avatarColor }}>
            {conv.contact.displayName.slice(0, 2).toUpperCase()}
          </div>
          <h3>{conv.contact.displayName}</h3>
          <div className="co">{conv.contact.company}</div>
          <div className="quick">
            <button title="Call">
              <PhoneIcon />
            </button>
            <button title="Email">
              <MailIcon />
            </button>
            <button title="Profile">
              <ProfileIcon />
            </button>
          </div>
        </div>

        <div className="block">
          <div className="t">Assignment</div>
          <div className="kv">
            <span className="k">Assignee</span>
            <span className="v">{conv.assigneeUserId ? "You" : "Unassigned"}</span>
          </div>
          <div className="kv">
            <span className="k">Team</span>
            <span className="v">
              {(conv.assignedTeamId && TEAM_NAME[conv.assignedTeamId]) || "—"}
              {!conv.assigneeUserId ? " · up for grabs" : ""}
            </span>
          </div>
          <div className="kv">
            <span className="k">Priority</span>
            <span className="v">
              <span
                className="prio"
                style={
                  highPriority
                    ? undefined
                    : { background: "var(--surface-2)", color: "var(--text-muted)" }
                }
              >
                {conv.priority}
              </span>
            </span>
          </div>
        </div>

        {conv.slaDueAt && (
          <div className="block">
            <div className="t">SLA</div>
            <div className="slabox">
              <div className="txt">
                <small>First response due in</small>
                <span className="cd">{slaCountdown(conv.slaDueAt, now)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="block">
          <div className="t">Labels</div>
          <div className="lbls">
            {conv.labels.length === 0 && (
              <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>No labels</span>
            )}
            {conv.labels.map((l) => (
              <span key={l.id} className="lbl-chip">
                <span className="d" style={{ background: l.color }} />
                {l.name}
              </span>
            ))}
          </div>
        </div>

        <div className="block">
          <div className="t">Contact</div>
          <div className="kv">
            <span className="k">Phone</span>
            <span className="v">{conv.contact.phone ?? "—"}</span>
          </div>
          <div className="kv">
            <span className="k">Email</span>
            <span className="v" style={{ fontWeight: 550, fontSize: 12.5 }}>
              {conv.contact.email ?? "—"}
            </span>
          </div>
        </div>

        <div className="block">
          <div className="t">Across channels</div>
          {others.map((t) => {
            const cm = channelMeta(t);
            const Glyph = cm.Glyph;
            return (
              <button key={t} className="xthread">
                <div className="ic" style={{ background: cm.color }}>
                  <Glyph />
                </div>
                <div className="m">
                  <b>{cm.label}</b>
                  <small>View history</small>
                </div>
                <span className="n">›</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
