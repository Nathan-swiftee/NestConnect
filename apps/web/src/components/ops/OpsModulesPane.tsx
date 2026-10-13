import type { ReactNode } from "react";
import { api } from "../../lib/api";
import { useChatMutation, useChatStatus, useMe, useOpsMutation, useOpsStatus } from "../../hooks";
import { OpsIcon, TeamChatIcon } from "../../lib/icons";

/**
 * Settings › Organisation › Modules: parts of NestConnect a workspace can do
 * without. Switching one off hides it for everyone and keeps everything in it,
 * ready for switching back on. Admins switch; everyone else can see what's on.
 */
export function OpsModulesPane({ onToast }: { onToast: (m: string) => void }) {
  const me = useMe();
  const isAdmin = me.data?.user.role === "admin";
  const ops = useOpsStatus();
  const opsToggle = useOpsMutation((enabled: boolean) => api.setOpsModule(enabled));
  const chat = useChatStatus();
  const chatToggle = useChatMutation((enabled: boolean) => api.setChatModule(enabled));

  return (
    <div className="setpane">
      <div className="setpane__head">
        <div>
          <h2>Modules</h2>
          <p>Extra parts of NestConnect your workspace can switch on. Switching one off hides it for everyone — nothing in it is deleted.</p>
        </div>
      </div>

      <ModuleCard
        name="Team Chat"
        icon={<TeamChatIcon />}
        on={!!chat.data?.enabled}
        busy={chat.isLoading || chatToggle.isPending}
        isAdmin={isAdmin}
        onToggle={(next) =>
          chatToggle.mutate(next, {
            onSuccess: (s) => onToast(s.enabled ? "Team Chat is on" : "Team Chat is off — nothing was deleted"),
            onError: (e) => onToast((e as Error).message || "Couldn't change that"),
          })
        }
        description="Your team talking to itself, in NestConnect instead of WhatsApp groups. Direct messages, groups, and a chat for every team that keeps itself up to date."
        points={[
          "Direct messages with anyone, and a chat for each team",
          "Replies, reactions, @mentions, read ticks and “typing…”",
          "Admins and managers make groups; admins can read every chat",
        ]}
      />

      <ModuleCard
        name="Business Ops"
        icon={<OpsIcon />}
        on={!!ops.data?.enabled}
        busy={ops.isLoading || opsToggle.isPending}
        isAdmin={isAdmin}
        onToggle={(next) =>
          opsToggle.mutate(next, {
            onSuccess: (s) => onToast(s.enabled ? "Business Ops is on" : "Business Ops is off — nothing was deleted"),
            onError: (e) => onToast((e as Error).message || "Couldn't change that"),
          })
        }
        description="Your own standard operating procedures, in one library. Give each SOP to the teams that follow it; they read it, tick through it as a checklist and confirm the must-reads. Admins and managers write them."
        points={[
          "Step-by-step SOPs with warnings, pictures, links and files",
          "Versions kept on every publish, and who's read the latest",
          "Review dates, so procedures don't quietly go out of date",
        ]}
      />
      {!isAdmin && <p className="ops-module__note">Only an admin can switch modules on or off.</p>}
    </div>
  );
}

function ModuleCard({
  name,
  icon,
  on,
  busy,
  isAdmin,
  onToggle,
  description,
  points,
}: {
  name: string;
  icon: ReactNode;
  on: boolean;
  busy: boolean;
  isAdmin: boolean;
  onToggle: (next: boolean) => void;
  description: string;
  points: string[];
}) {
  return (
    <div className={"ops-module" + (on ? " on" : "")}>
      <span className="ops-module__ic" aria-hidden="true">
        {icon}
      </span>
      <div className="ops-module__body">
        <h3>
          {name} <span className={"ops-module__state" + (on ? " on" : "")}>{on ? "On" : "Off"}</span>
        </h3>
        <p>{description}</p>
        <ul className="ops-module__points">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={name}
        className="ops-module__switch"
        disabled={!isAdmin || busy}
        title={isAdmin ? undefined : "Only an admin can switch modules on or off"}
        onClick={() => onToggle(!on)}
      >
        <span className={"switch" + (on ? " on" : "")}>
          <span className="switch__dot" />
        </span>
      </button>
    </div>
  );
}
