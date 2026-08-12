import { useState, type FormEvent } from "react";
import { useLogin } from "../hooks";
import { api } from "../lib/api";
import { Logo, channelMeta, CheckDouble, SendIcon } from "../lib/icons";

const wa = channelMeta("whatsapp");
const email = channelMeta("email");

export function LoginScreen() {
  const login = useLogin();
  const [emailAddr, setEmailAddr] = useState("nathan@swiftee.co.uk");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [resetSent, setResetSent] = useState(false);
  const [sending, setSending] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email: emailAddr, password });
  };
  const submitForgot = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    // Always resolves the same way — we never reveal whether the email exists.
    try {
      await api.forgotPassword(emailAddr);
    } catch {
      /* ignore */
    }
    setSending(false);
    setResetSent(true);
  };

  return (
    <div className="login">
      {/* ── Left: brushed hero with an animated, living app mockup ── */}
      <section className="login__hero" aria-hidden="true">
        <div className="hero__glow" />
        <div className="hero__sheen" />

        <div className="hero__content">
          <div className="hero__brand">
            <div className="brandmark">
              <Logo />
            </div>
            <span className="wordmark">
              Nest <span className="dot">Connect</span>
            </span>
          </div>

          <h2 className="hero__title">
            Every conversation.
            <br />
            <span className="hero__accent">One inbox.</span>
          </h2>
          <p className="hero__lead">
            WhatsApp, email, and every channel in a single shared inbox. Assign, reply, and resolve
            as one team.
          </p>

          <div className="hero__mock">
            <div className="mock__win">
              <div className="mock__bar">
                <span className="mock__dot" />
                <span className="mock__dot" />
                <span className="mock__dot" />
                <span className="mock__title">Shared inbox</span>
                <span className="mock__badges">
                  <i className="mock__badge mock__badge--wa">
                    <wa.Glyph />
                  </i>
                  <i className="mock__badge mock__badge--mail">
                    <email.Glyph />
                  </i>
                </span>
              </div>

              <div className="mock__body">
                <div className="mock__row mock__row--in">
                  <span className="mock__av">A</span>
                  <div className="mock__bub">
                    Hey! Any update on my order? 😊
                    <span className="mock__time">9:41</span>
                  </div>
                </div>

                <div className="mock__row mock__row--out">
                  <div className="mock__bub mock__bub--out">
                    Just shipped — landing tomorrow 🚀
                    <span className="mock__ticks">
                      <CheckDouble />
                    </span>
                  </div>
                </div>

                <div className="mock__typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>

              <div className="mock__composer">
                <span className="mock__inputpill">Type a reply…</span>
                <span className="mock__send">
                  <SendIcon />
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Right: the sign-in form ── */}
      <section className="login__panel">
        <form className="login__card" onSubmit={mode === "signin" ? submit : submitForgot}>
          <div className="flex items-center gap-2 mb-1">
            <div className="brandmark">
              <Logo />
            </div>
            <span className="wordmark">
              Nest <span className="dot">Connect</span>
            </span>
          </div>
          {mode === "signin" ? (
            <>
              <h1>Welcome back</h1>
              <p className="m-0 mb-2 text-muted text-sm">Sign in to your team inbox</p>

              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={emailAddr}
                  onChange={(e) => setEmailAddr(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                />
              </label>

              {login.isError && <div className="text-danger text-xs font-semibold bg-danger-tint py-2 px-3 rounded-8">Invalid email or password.</div>}

              <button className="mt-1.5 p-3 rounded-12 font-bold text-md text-white bg-brand shadow-[0_6px_16px_-8px_var(--brand-ring)] [transition:filter_.15s,transform_.12s_var(--ease)] hover:brightness-[1.05] active:scale-[.98] disabled:opacity-60" type="submit" disabled={login.isPending}>
                {login.isPending ? "Signing in…" : "Sign in"}
              </button>

              <button type="button" className="self-center mt-0.5 bg-transparent border-0 p-1 text-xs font-semibold text-brand cursor-pointer [transition:color_.15s] hover:text-brand-strong hover:underline" onClick={() => { setResetSent(false); setMode("forgot"); }}>
                Forgot password?
              </button>

              <div className="mt-1 text-center text-xs text-faint [&_b]:text-muted">
                Demo login — <b>nathan@swiftee.co.uk</b> / <b>ding1234</b>
              </div>
            </>
          ) : (
            <>
              <h1>Reset your password</h1>
              <p className="m-0 mb-2 text-muted text-sm">We'll email you a link to set a new one.</p>

              {resetSent ? (
                <div className="bg-brand-tint text-fg text-sm leading-normal p-3 rounded-12">
                  If <b>{emailAddr}</b> has an account, a reset link is on its way — check your inbox.
                </div>
              ) : (
                <label className="field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={emailAddr}
                    onChange={(e) => setEmailAddr(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </label>
              )}

              {!resetSent && (
                <button className="mt-1.5 p-3 rounded-12 font-bold text-md text-white bg-brand shadow-[0_6px_16px_-8px_var(--brand-ring)] [transition:filter_.15s,transform_.12s_var(--ease)] hover:brightness-[1.05] active:scale-[.98] disabled:opacity-60" type="submit" disabled={sending}>
                  {sending ? "Sending…" : "Send reset link"}
                </button>
              )}

              <button type="button" className="self-center mt-0.5 bg-transparent border-0 p-1 text-xs font-semibold text-brand cursor-pointer [transition:color_.15s] hover:text-brand-strong hover:underline" onClick={() => { setResetSent(false); setMode("signin"); }}>
                ← Back to sign in
              </button>
            </>
          )}
        </form>
      </section>
    </div>
  );
}
