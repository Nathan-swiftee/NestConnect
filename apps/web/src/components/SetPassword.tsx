import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { Logo } from "../lib/icons";

/** Public page reached from an emailed link — an invite (`/?invite=<token>`) or a
 *  password reset (`/?reset=<token>`): choose a password, which signs you in and
 *  drops you into the app. Both use the same single-use token + set-password API. */
export function SetPassword({ token, reset = false }: { token: string; reset?: boolean }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await api.setPassword(token, password);
      // Signed in — drop the token from the URL and enter the app.
      window.location.replace("/");
    } catch {
      setBusy(false);
      setError(
        reset
          ? "This reset link is invalid or has expired — request a new one from the sign-in page."
          : "This invite link is invalid or has expired — ask an admin to re-invite you.",
      );
    }
  };

  return (
    <div className="login login--single">
      <form className="login__card" onSubmit={submit}>
        <div className="login__brand">
          <div className="brandmark">
            <Logo />
          </div>
          <span className="wordmark">
            Nest <span className="dot">Connect</span>
          </span>
        </div>
        <h1>{reset ? "Reset your password" : "Set your password"}</h1>
        <p className="login__sub">
          {reset ? "Choose a new password for your account" : "Choose a password to finish setting up your account"}
        </p>

        <label className="field">
          <span>New password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            required
            autoFocus
          />
        </label>
        <label className="field">
          <span>Confirm password</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            placeholder="••••••••"
            required
          />
        </label>

        {error && <div className="login__err">{error}</div>}

        <button className="login__btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : reset ? "Reset password & sign in" : "Set password & sign in"}
        </button>
      </form>
    </div>
  );
}
