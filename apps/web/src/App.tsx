import { useSession } from "./hooks";
import { Workspace } from "./components/Workspace";
import { LoginScreen } from "./components/LoginScreen";
import { SetPassword } from "./components/SetPassword";
import { TwoFactorGate } from "./components/TwoFactorGate";

export function App() {
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get("invite");
  const resetToken = params.get("reset");
  const session = useSession();

  // An emailed invite or password-reset link takes over before the auth gate.
  if (inviteToken || resetToken) {
    return <SetPassword token={(inviteToken ?? resetToken) as string} reset={!!resetToken} />;
  }
  if (session.isLoading) {
    return <div className="center-note" style={{ height: "100dvh" }}>Loading…</div>;
  }
  const user = session.data?.user;
  if (session.isError || !user) {
    return <LoginScreen />;
  }
  // Mandatory 2FA: an authenticated user who hasn't enrolled is held at the
  // enrolment gate until they set it up (or sign out). The server owns the rule
  // — it's always on in production, and only a dev API can answer `false` — so
  // an absent flag (an API older than this bundle) still gates.
  if (session.data?.twoFactorEnforced !== false && !user.twoFactorEnabled) {
    return <TwoFactorGate />;
  }
  return <Workspace />;
}
