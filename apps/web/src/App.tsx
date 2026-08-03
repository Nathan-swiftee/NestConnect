import { useSession } from "./hooks";
import { Workspace } from "./components/Workspace";
import { LoginScreen } from "./components/LoginScreen";

export function App() {
  const session = useSession();

  if (session.isLoading) {
    return <div className="center-note" style={{ height: "100dvh" }}>Loading…</div>;
  }
  if (session.isError || !session.data?.user) {
    return <LoginScreen />;
  }
  return <Workspace />;
}
