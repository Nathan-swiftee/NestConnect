import { useSession } from "./hooks";
import { Workspace } from "./components/Workspace";
import { LoginScreen } from "./components/LoginScreen";
import { SetPassword } from "./components/SetPassword";

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
  if (session.isError || !session.data?.user) {
    return <LoginScreen />;
  }
  return <Workspace />;
}
