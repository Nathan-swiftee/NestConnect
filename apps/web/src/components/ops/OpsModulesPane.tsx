import { api } from "../../lib/api";
import { useMe, useOpsMutation, useOpsStatus } from "../../hooks";
import { OpsIcon } from "../../lib/icons";

/**
 * Settings › Organisation › Modules: parts of NestConnect a workspace can do
 * without. Switching one off hides it for everyone and keeps everything in it,
 * ready for switching back on. Admins switch; everyone else can see what's on.
 */
export function OpsModulesPane({ onToast }: { onToast: (m: string) => void }) {
  const me = useMe();
  const isAdmin = me.data?.user.role === "admin";
  const status = useOpsStatus();
  const on = !!status.data?.enabled;
  const toggle = useOpsMutation((enabled: boolean) => api.setOpsModule(enabled));

  return (
    <div className="setpane">
      <div className="setpane__head">
        <div>
          <h2>Modules</h2>
          <p>Extra parts of NestConnect your workspace can switch on. Switching one off hides it for everyone — nothing in it is deleted.</p>
        </div>
      </div>

      <div className={"ops-module" + (on ? " on" : "")}>
        <span className="ops-module__ic" aria-hidden="true"><OpsIcon /></span>
        <div className="ops-module__body">
          <h3>Business Ops <span className={"ops-module__state" + (on ? " on" : "")}>{on ? "On" : "Off"}</span></h3>
          <p>
            Your own standard operating procedures, in one library. Give each SOP to the teams that follow it; they read it,
            tick through it as a checklist and confirm the must-reads. Admins and managers write them.
          </p>
          <ul className="ops-module__points">
            <li>Step-by-step SOPs with warnings, pictures, links and files</li>
            <li>Versions kept on every publish, and who's read the latest</li>
            <li>Review dates, so procedures don't quietly go out of date</li>
          </ul>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Business Ops"
          className="ops-module__switch"
          disabled={!isAdmin || status.isLoading || toggle.isPending}
          title={isAdmin ? undefined : "Only an admin can switch modules on or off"}
          onClick={() =>
            toggle.mutate(!on, {
              onSuccess: (s) => onToast(s.enabled ? "Business Ops is on" : "Business Ops is off — nothing was deleted"),
              onError: (e) => onToast((e as Error).message || "Couldn't change that"),
            })
          }
        >
          <span className={"switch" + (on ? " on" : "")}><span className="switch__dot" /></span>
        </button>
      </div>
      {!isAdmin && <p className="ops-module__note">Only an admin can switch modules on or off.</p>}
    </div>
  );
}
