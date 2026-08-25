import { useRef, useState } from "react";
import { ScrollView, Text, TextInput, useWindowDimensions } from "react-native";
import Animated, { FadeIn, ReduceMotion, ZoomIn } from "react-native-reanimated";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, type MeResponse } from "@ding/client";
import type { TwoFactorChallenge } from "@ding/schemas";
import { Button } from "../src/components/Button";
import { Field } from "../src/components/Field";
import { AuthGlow, NestMark } from "../src/components/NestMark";
import { rowIn } from "../src/motion";
import { saveSession } from "../src/session";
import { useTheme } from "../src/theme";
import { useInsets } from "../src/insets";

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
  const insets = useInsets();
  const win = useWindowDimensions();
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
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <AuthGlow width={win.width} height={win.height * 0.62} brand={c.brand} warm={c.amber} />

      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          // Centred in whatever space is left, and free to scroll when there
          // isn't enough — so it sits in the middle of a big phone rather than
          // stranded at the top with a screen of nothing under it, and still
          // reaches the password field on a small one with the keyboard up.
          flexGrow: 1,
          justifyContent: "center",
        }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        className="px-6"
      >
        {/* The mark lands first and the rest follows it up the screen. It's the
            one moment in the app with nothing else to look at, so it's worth
            the half-second — and it covers the gap while the stored session is
            being checked. */}
        <Animated.View
          entering={ZoomIn.springify().damping(16).stiffness(220).mass(0.8).reduceMotion(ReduceMotion.System)}
          style={{
            backgroundColor: c.brand,
            shadowColor: c.brand,
            shadowOpacity: 0.32,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
          }}
          className="h-16 w-16 items-center justify-center rounded-20"
        >
          <NestMark size={34} />
        </Animated.View>

        <Animated.View entering={rowIn(1)}>
          <Text
            accessibilityRole="header"
            style={{ fontSize: 34, lineHeight: 38, letterSpacing: -0.8 }}
            className="mt-5 font-semibold text-fg"
          >
            {challenge ? "Almost there" : "Nest Connect"}
          </Text>
          <Text className="mt-2 text-lg leading-snug text-muted">
            {challenge
              ? "Enter your second factor to finish signing in."
              : "Every conversation your team is having, in one place."}
          </Text>
        </Animated.View>

        {/* The form is a card rather than fields on the ground: it gives the
            inputs an edge to sit inside, which is what stops a stack of rounded
            grey boxes on a grey background from reading as a list of nothing. */}
        <Animated.View
          entering={rowIn(2)}
          style={{
            backgroundColor: c.elevated,
            borderColor: c.border,
            shadowColor: "#000",
            shadowOpacity: 0.06,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 8 },
            elevation: 3,
          }}
          className="mt-8 gap-5 rounded-24 border p-5"
        >
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
        </Animated.View>

        <Animated.View entering={FadeIn.delay(260).duration(320).reduceMotion(ReduceMotion.System)}>
          <Text className="mt-6 text-center text-2xs leading-snug text-faint">
            WhatsApp, email and group chats — answered from one inbox.
          </Text>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
