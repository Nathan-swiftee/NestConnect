import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TotpSetup } from "@ding/schemas";
import { useTwoFactorStatus } from "../hooks";
import { api } from "../lib/api";

/** Box shown once after enabling / regenerating — the codes are never shown again. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const copy = () => navigator.clipboard.writeText(codes.join("\n")).catch(() => {});
  return (
    <div className="tfa-recovery">
      <div className="tfa-recovery__hd">Save your recovery codes</div>
      <p className="pers-field__hint">
        Each works once. Keep them somewhere safe — if you lose your device, a code lets you back in.
        You won&apos;t see them again.
      </p>
      <div className="tfa-recovery__grid">
        {codes.map((c) => (
          <code key={c}>{c}</code>
        ))}
      </div>
      <div className="tfa-actions">
        <button type="button" className="btn-ghost" onClick={copy}>
          Copy codes
        </button>
        <button type="button" className="btn-primary" onClick={onDone}>
          I&apos;ve saved them
        </button>
      </div>
    </div>
  );
}

/**
 * Two-factor auth for personal settings: shows status, walks through
 * authenticator (QR) or email-code setup with recovery codes, and lets an
 * enabled user regenerate codes or turn it off. `onChange` fires when the
 * enabled state flips (so a mandatory-2FA gate can react).
 */
export function TwoFactorSettings({ onToast, onChange }: { onToast: (m: string) => void; onChange?: () => void }) {
  const statusQ = useTwoFactorStatus();
  const st = statusQ.data;
  const qc = useQueryClient();

  const [flow, setFlow] = useState<null | "totp" | "email">(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string[] | null>(null);

  const refreshStatus = () => qc.invalidateQueries({ queryKey: ["2fa-status"] });
  // Refreshing the session flips the mandatory-2FA gate to the app — deferred
  // until AFTER the recovery codes are acknowledged, so the gate can't vanish
  // out from under the codes the moment 2FA turns on.
  const commitSession = () => {
    qc.invalidateQueries({ queryKey: ["session"] });
    qc.invalidateQueries({ queryKey: ["me"] });
    onChange?.();
  };
  const cancel = () => {
    setFlow(null);
    setSetup(null);
    setCode("");
  };

  const startTotp = async () => {
    setBusy(true);
    try {
      setSetup(await api.startTotp());
      setFlow("totp");
      setCode("");
    } catch {
      onToast("Couldn't start setup — try again.");
    } finally {
      setBusy(false);
    }
  };
  const startEmail = async () => {
    setBusy(true);
    try {
      await api.startEmail2fa();
      setFlow("email");
      setCode("");
      onToast("We emailed you a code.");
    } catch {
      onToast("Couldn't send the code.");
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const res = flow === "totp" ? await api.enableTotp(code.trim()) : await api.enableEmail2fa(code.trim());
      setRecovery(res.recoveryCodes);
      cancel();
      refreshStatus(); // session refresh happens on "I've saved them" (see RecoveryCodes)
      onToast("Two-factor is on.");
    } catch {
      onToast("That code isn't right — try again.");
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    setBusy(true);
    try {
      await api.disable2fa();
      setRecovery(null);
      refreshStatus();
      commitSession();
      onToast("Two-factor turned off.");
    } catch {
      onToast("Couldn't turn it off.");
    } finally {
      setBusy(false);
    }
  };
  const regenerate = async () => {
    setBusy(true);
    try {
      setRecovery((await api.regenerateRecovery()).recoveryCodes);
      refreshStatus();
    } catch {
      onToast("Couldn't regenerate codes.");
    } finally {
      setBusy(false);
    }
  };

  // 1) Just enabled / regenerated → show the codes to save. Acknowledging them
  //    commits the session refresh (which, under the mandatory gate, reveals the app).
  if (recovery)
    return (
      <RecoveryCodes
        codes={recovery}
        onDone={() => {
          setRecovery(null);
          commitSession();
        }}
      />
    );

  // 2) Mid-setup: confirm a code (authenticator QR, or emailed code).
  if (flow) {
    return (
      <div className="tfa-setup">
        {flow === "totp" && setup && (
          <>
            <p className="pers-field__hint">
              Scan this with Google Authenticator, 1Password, Authy, or any authenticator app — then enter the
              6-digit code it shows.
            </p>
            <div className="tfa-qr">
              <img src={setup.qrDataUrl} alt="Authenticator QR code" width={180} height={180} />
              <div className="tfa-qr__manual">
                <span className="pers-field__hint">Can&apos;t scan? Enter this key:</span>
                <code>{setup.secret}</code>
              </div>
            </div>
          </>
        )}
        {flow === "email" && (
          <p className="pers-field__hint">Enter the 6-digit code we just emailed you (it expires in 10 minutes).</p>
        )}
        <label className="field tfa-codefield">
          <span>Verification code</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
          />
        </label>
        <div className="tfa-actions">
          <button type="button" className="btn-ghost" onClick={cancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={confirm} disabled={busy || !code.trim()}>
            {busy ? "Verifying…" : "Turn on"}
          </button>
        </div>
      </div>
    );
  }

  // 3) Status view.
  if (st?.enabled) {
    return (
      <div className="tfa-status">
        <div className="tfa-status__row">
          <span className="tfa-status__on">
            On · {st.method === "email" ? "Email codes" : "Authenticator app"}
          </span>
          <span className="pers-field__hint">{st.recoveryCodesRemaining} recovery codes left</span>
        </div>
        <div className="tfa-actions">
          <button type="button" className="btn-ghost" onClick={regenerate} disabled={busy}>
            Regenerate recovery codes
          </button>
          <button type="button" className="btn-ghost tfa-danger" onClick={disable} disabled={busy}>
            Turn off
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tfa-status">
      <p className="pers-field__hint" style={{ marginLeft: 0 }}>
        Add a second step at sign-in so a password alone isn&apos;t enough.
      </p>
      <div className="tfa-actions">
        <button type="button" className="btn-primary" onClick={startTotp} disabled={busy}>
          Set up authenticator app
        </button>
        <button type="button" className="btn-ghost" onClick={startEmail} disabled={busy}>
          Use email codes
        </button>
      </div>
    </div>
  );
}
