import { useSession } from "./hooks";
import { Workspace } from "./components/Workspace";
import { LoginScreen } from "./components/LoginScreen";
import { SetPassword } from "./components/SetPassword";

export function App() {
  const inviteToken = new URLSearchParams(window.location.search).get("invite");
  const session = useSession();

  // An emailed invite link takes over before the normal auth gate.
  if (inviteToken) {
    return <SetPassword token={inviteToken} />;
  }
  if (session.isLoading) {
    return <div className="center-note" style={{ height: "100dvh" }}>Loading…</div>;
  }
  if (session.isError || !session.data?.user) {
    return <LoginScreen />;
  }
  return <Workspace />;
}
