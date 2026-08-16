import { useState } from "react";
import { useLogout } from "../hooks";
import { TwoFactorSettings } from "./TwoFactorSettings";
import { Logo } from "../lib/icons";

/**
 * Mandatory-2FA gate: shown after login to anyone who hasn't enrolled yet. It
 * blocks the app until they set up 2FA (enrolling refreshes the session, which
 * flips this away to the app). A sign-out escape hatch avoids trapping anyone.
 */
export function TwoFactorGate() {
  const logout = useLogout();
  const [toast, setToast] = useState<string | null>(null);
  const onToast = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 3500);
  };

  return (
    <div className="tfa-gate">
      <div className="tfa-gate__card">
        <div className="flex items-center gap-2 mb-1">
          <div className="brandmark">
            <Logo />
          </div>
          <span className="wordmark">
            Nest <span className="dot">Connect</span>
          </span>
        </div>
        <h1>Set up two-factor authentication</h1>
        <p className="m-0 mb-1 text-muted text-sm">
          Your team requires two-factor authentication. Add a second step to your sign-in to continue.
        </p>
        <TwoFactorSettings onToast={onToast} />
        {toast && <div className="tfa-gate__toast">{toast}</div>}
        <button
          type="button"
          className="self-center mt-1 bg-transparent border-0 p-1 text-xs font-semibold text-muted cursor-pointer [transition:color_.15s] hover:text-fg hover:underline"
          onClick={() => logout.mutate()}
        >
          Sign out instead
        </button>
      </div>
    </div>
  );
}
