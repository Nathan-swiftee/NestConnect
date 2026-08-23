import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { api, type MeResponse } from "@ding/client";
import type { TwoFactorChallenge } from "@ding/schemas";
import { Button } from "../src/components/Button";
import { Field } from "../src/components/Field";
import { saveSession } from "../src/session";
import { useTheme } from "../src/theme";

/**
 * Sign-in, including the second factor.
 *
 * This deliberately doesn't use the shared `useLogin` hook: the web's version
 * treats a successful login as "the cookie is now set", whereas here the token
 * in the response has to reach the Keychain *before* the session query runs, or
 * the very next request goes out unauthenticated. So the two calls are made
 * directly and the session is seeded into the cache by hand.
 *
 * The 2FA leg carries its half-authenticated token in state — a browser gets
 * that as a short-lived cookie, and a phone has no cookie jar to put it in.
 */
export default function SignIn() {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const passwordRef = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  /** Store the token, seed the session, and go. Order matters — see above. */
  async function land(result: MeResponse & { token?: string }) {
    if (result.token) await saveSession(result.token);
    qc.setQueryData(["session"], result);
    await qc.invalidateQueries();
    router.replace("/(app)/(tabs)");
  }

  async function submitPassword() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(email.trim(), password);
      if ("twoFactorRequired" in result) {
        setChallenge(result);
        // Give the keyboard something to do rather than making them tap again.
        setTimeout(() => codeRef.current?.focus(), 250);
        return;
      }
      await land(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setBusy(true);
    setError(null);
    try {
      await land(await api.loginTwoFactor(code.trim(), challenge?.pendingToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code isn't right.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResent(false);
    await api.resendLoginCode(challenge?.pendingToken).catch(() => {});
    setResent(true);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ backgroundColor: c.bg }}
      className="flex-1"
    >
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: insets.bottom + 32 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        className="px-6"
      >
        <Text className="text-2xl font-semibold tracking-tight text-fg">Nest Connect</Text>
        <Text className="mt-2 text-lg text-muted">
          {challenge ? "Enter your second factor to finish signing in." : "Sign in to your team inbox."}
        </Text>

        <View className="mt-8 gap-5">
          {challenge ? (
            <>
              <Field
                ref={codeRef}
                label={challenge.method === "email" ? "Code we emailed you" : "Code from your authenticator app"}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                autoFocus
                maxLength={32}
                returnKeyType="go"
                onSubmitEditing={submitCode}
                error={error ?? undefined}
              />
              <Button title="Sign in" busy={busy} disabled={code.trim().length < 4} onPress={submitCode} />
              {challenge.method === "email" ? (
                <Button title={resent ? "Code sent" : "Send another code"} variant="quiet" onPress={resend} />
              ) : null}
              <Button
                title="Use a different account"
                variant="quiet"
                onPress={() => {
                  setChallenge(null);
                  setCode("");
                  setError(null);
                }}
              />
            </>
          ) : (
            <>
              <Field
                label="Work email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              <Field
                ref={passwordRef}
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={submitPassword}
                error={error ?? undefined}
              />
              <Button
                title="Sign in"
                busy={busy}
                disabled={!email.trim() || !password}
                onPress={submitPassword}
              />
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
