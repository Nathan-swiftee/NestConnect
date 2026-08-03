import { useState, type FormEvent } from "react";
import { useLogin } from "../hooks";
import { Logo } from "../lib/icons";

export function LoginScreen() {
  const login = useLogin();
  const [email, setEmail] = useState("nathan@swiftee.co.uk");
  const [password, setPassword] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <div className="login__brand">
          <div className="brandmark">
            <Logo />
          </div>
          <span className="wordmark">
            relay<span className="dot">·</span>
          </span>
        </div>
        <h1>Sign in to Relay</h1>
        <p className="login__sub">Your omnichannel team inbox</p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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

        {login.isError && <div className="login__err">Invalid email or password.</div>}

        <button className="login__btn" type="submit" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>

        <div className="login__hint">
          Demo login — <b>nathan@swiftee.co.uk</b> / <b>ding1234</b>
        </div>
      </form>
    </div>
  );
}
