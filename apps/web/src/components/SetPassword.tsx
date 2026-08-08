import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { Logo } from "../lib/icons";

/** Public page reached from an emailed invite link (`/?invite=<token>`): the new
 *  teammate chooses a password, which signs them in and drops them into the app. */
export function SetPassword({ token }: { token: string }) {
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
      // Signed in — drop the invite token from the URL and enter the app.
      window.location.replace("/");
    } catch {
      setBusy(false);
      setError("This invite link is invalid or has expired — ask an admin to re-invite you.");
    }
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <div className="login__brand">
          <div className="brandmark">
            <Logo />
          </div>
          <span className="wordmark">
            Nest <span className="dot">Connect</span>
          </span>
        </div>
        <h1>Set your password</h1>
        <p className="login__sub">Choose a password to finish setting up your account</p>

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
          {busy ? "Setting up…" : "Set password & sign in"}
        </button>
      </form>
    </div>
  );
}
