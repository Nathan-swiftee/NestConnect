import { useState, type FormEvent } from "react";
import type { TwoFactorChallenge } from "@ding/schemas";
import { api } from "../lib/api";
import { Logo } from "../lib/icons";

/** Public page reached from an emailed link — an invite (`/?invite=<token>`) or a
 *  password reset (`/?reset=<token>`): choose a password, which signs you in and
 *  drops you into the app. Both use the same single-use token + set-password API.
 *
 *  An account that already has two-factor gets asked for it here, exactly as it
 *  would signing in — otherwise a reset link would be a way past it, and the
 *  mailbox would quietly become the only credential that mattered. */
export function SetPassword({ token, reset = false }: { token: string; reset?: boolean }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [code, setCode] = useState("");
  const [expired, setExpired] = useState(false);

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
      const result = await api.setPassword(token, password);
      if ("twoFactorRequired" in result) {
        // The password is already changed at this point — only the way in is
        // still pending. Saying so matters: somebody who gives up here must not
        // go back and try the old password.
        setChallenge(result);
        setBusy(false);
        return;
      }
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

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.loginTwoFactor(code.trim());
      window.location.replace("/");
    } catch (err) {
      setBusy(false);
      setCode("");
      // The server's own words, because two quite different things land here.
      // A wrong code is worth retrying; a verification that has sat for more
      // than five minutes is not — the link was single-use and is spent, and
      // the only way on is the sign-in page. Showing "that code isn't right"
      // for the second one leaves somebody retyping a code that can never work.
      setError(err instanceof Error && err.message ? err.message : "That code isn't right — try again.");
      setExpired(err instanceof Error && /expired/i.test(err.message));
    }
  };

  return (
    <div className="login login--single">
      <form className="login__card" onSubmit={challenge ? submitCode : submit}>
        <div className="login__brand">
          <div className="brandmark">
            <Logo />
          </div>
          <span className="wordmark">
            Nest <span className="dot">Connect</span>
          </span>
        </div>

        {challenge ? (
          <>
            <h1>Two-step verification</h1>
            <p className="login__sub">
              {challenge.method === "email"
                ? "Your password is saved. Enter the 6-digit code we just emailed you to finish signing in."
                : "Your password is saved. Enter the 6-digit code from your authenticator app to finish signing in."}
            </p>

            <label className="field">
              <span>Verification code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                required
              />
            </label>

            {error && <div className="login__err">{error}</div>}

            {/* Once the verification has lapsed there is no code that will work,
                so the button stops offering. */}
            <button className="login__btn" type="submit" disabled={busy || expired || !code.trim()}>
              {busy ? "Verifying…" : "Verify & sign in"}
            </button>

            {challenge.method === "email" && !expired && (
              <button
                type="button"
                className="self-center mt-0.5 bg-transparent border-0 p-1 text-xs font-semibold text-brand cursor-pointer [transition:color_.15s] hover:text-brand-strong hover:underline"
                onClick={() => api.resendLoginCode().catch(() => {})}
              >
                Resend code
              </button>
            )}
            {expired && (
              // Not a dead end, and it needs saying: the password they just
              // chose is already live, so the front page will let them in. The
              // reset link itself is spent and asking for another one would be
              // the wrong advice.
              <button
                type="button"
                className="self-center mt-0.5 bg-transparent border-0 p-1 text-xs font-semibold text-brand cursor-pointer [transition:color_.15s] hover:text-brand-strong hover:underline"
                onClick={() => window.location.replace("/")}
              >
                Sign in with your new password →
              </button>
            )}
            {/* The one thing that stops this being a lockout. Somebody who has
                lost their password and their phone at once has nothing else
                left, and the codes were handed to them for exactly this. */}
            <div className="mt-0.5 text-center text-xs text-faint">
              Lost your device? Enter a <b className="text-muted">recovery code</b> above.
            </div>
          </>
        ) : (
          <>
            <h1>{reset ? "Reset your password" : "Set your password"}</h1>
            <p className="login__sub">
              {reset
                ? "Choose a new password for your account"
                : "Choose a password to finish setting up your account"}
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
          </>
        )}
      </form>
    </div>
  );
}
