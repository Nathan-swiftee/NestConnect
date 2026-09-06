import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { useSession } from "@ding/client";
import { useTheme } from "../src/theme";
import { sessionToken } from "../src/session";

/**
 * The gate. One question — is there a live session? — answered before anything
 * else renders, so the app never flashes the inbox at someone who is signed out
 * (or the sign-in screen at someone who isn't).
 *
 * A stored token is only a claim; `/auth/session` is what settles it, because a
 * token can have been revoked from another device since this app last ran.
 */
export default function Index() {
  const session = useSession();
  const { c } = useTheme();

  useEffect(() => {
    // No token at all: nothing to verify, and the query would 401 pointlessly.
    if (!sessionToken()) return;
  }, []);

  if (!sessionToken()) return <Redirect href="/sign-in" />;
  if (session.isLoading) {
    return (
      <View style={{ backgroundColor: c.bg }} className="flex-1 items-center justify-center">
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }
  const user = session.data?.user;
  if (!user) return <Redirect href="/sign-in" />;
  // Mandatory 2FA. The server holds a session that hasn't enrolled away from
  // everything but the enrolment routes, so this isn't a nicety — landing on
  // the inbox instead would be a screen of failed requests with no way out.
  // An absent flag is an API older than this build, and those always enforce.
  if (session.data?.twoFactorEnforced !== false && !user.twoFactorEnabled) {
    return <Redirect href="/enrol-2fa" />;
  }
  return <Redirect href="/(app)/(tabs)" />;
}
