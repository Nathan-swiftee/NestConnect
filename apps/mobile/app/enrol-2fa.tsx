import { useState } from "react";
import { Linking, ScrollView, Text, View, useWindowDimensions } from "react-native";
import Animated, { ReduceMotion, ZoomIn } from "react-native-reanimated";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, useLogout } from "@ding/client";
import type { TotpSetup } from "@ding/schemas";
import { Button } from "../src/components/Button";
import { Field } from "../src/components/Field";
import { BRAND } from "@ding/design/logo";
import { AuthGlow, NestMark } from "../src/components/NestMark";
import { rowIn } from "../src/motion";
import { useTheme } from "../src/theme";
import { useInsets } from "../src/insets";

/**
 * The mandatory two-factor gate, for the phone.
 *
 * The web has had one of these for a while; this app never did, and it did not
 * matter while the rule was only drawn by the client — an un-enrolled phone
 * simply carried on. Now that the server holds a session without a second
 * factor away from every route, a phone that lands here has nowhere else to go,
 * so this is the way through rather than a nicety.
 *
 * Both methods are offered, but not the way the web offers them. There is no QR
 * to scan: the phone showing the code and the phone scanning it are the same
 * phone. `otpauth://` handed to the OS opens the authenticator app and fills in
 * the account, which is the thing the QR existed to do — and the secret is left
 * on screen, selectable, for anyone whose app didn't open.
 */
export default function Enrol2fa() {
  const qc = useQueryClient();
  const logout = useLogout();
  const insets = useInsets();
  const win = useWindowDimensions();
  const { c } = useTheme();

  const [flow, setFlow] = useState<null | "totp" | "email">(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const startTotp = async () => {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.startTotp());
      setFlow("totp");
    } catch {
      setError("Couldn't start setup — try again.");
    } finally {
      setBusy(false);
    }
  };

  const startEmail = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.startEmail2fa();
      setFlow("email");
    } catch {
      setError("Couldn't send the code — try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res =
        flow === "totp" ? await api.enableTotp(code.trim()) : await api.enableEmail2fa(code.trim());
      // Nothing to store. The token in the Keychain was always a real session —
      // the guard was holding it because the account had no second factor, and
      // it now has one, so the next request goes through on the same token.
      setRecovery(res.recoveryCodes);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code isn't right — try again.");
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  /** Only once the codes have been acknowledged — see `done` below. */
  const done = () => {
    // Everything cached while the session was held is a 403, including the
    // session query this screen was routed on. Clearing rather than
    // invalidating means the inbox starts from nothing instead of flashing a
    // screen of error states it would then replace.
    qc.clear();
    router.replace("/(app)/(tabs)");
  };

  const resend = async () => {
    setResent(false);
    await api.startEmail2fa().catch(() => {});
    setResent(true);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <AuthGlow width={win.width} height={win.height * 0.62} brand={c.brand} warm={c.amber} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          flexGrow: 1,
          justifyContent: "center",
        }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        className="px-6"
      >
        <Animated.View
          entering={ZoomIn.springify().damping(16).stiffness(220).mass(0.8).reduceMotion(ReduceMotion.System)}
          style={{
            backgroundColor: BRAND.navy,
            shadowColor: BRAND.navy,
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
            {recovery ? "Save these codes" : "One more step"}
          </Text>
          <Text className="mt-2 text-lg leading-snug text-muted">
            {recovery
              ? "Each one works once. If you lose your phone, a code lets you back in — you won't see them again."
              : "Your team requires two-factor authentication. Add a second step to your sign-in to continue."}
          </Text>
        </Animated.View>

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
          {recovery ? (
            <>
              <View className="gap-1.5">
                {recovery.map((rc) => (
                  // Selectable rather than a copy button: there is no clipboard
                  // dependency in this app, and a code someone can press-and-hold
                  // into their password manager is the thing they'd do anyway.
                  <Text
                    key={rc}
                    selectable
                    style={{ backgroundColor: c.surface2, fontVariant: ["tabular-nums"] }}
                    className="rounded-8 px-3 py-2 text-center text-lg tracking-widest text-fg"
                  >
                    {rc}
                  </Text>
                ))}
              </View>
              <Button title="I've saved them" onPress={done} />
            </>
          ) : flow ? (
            <>
              {flow === "totp" && setup ? (
                <View className="gap-3">
                  <Text className="text-lg leading-snug text-muted">
                    Add Nest Connect to your authenticator app, then enter the code it shows.
                  </Text>
                  <Button
                    title="Open my authenticator app"
                    variant="quiet"
                    onPress={() => {
                      void Linking.openURL(setup.otpauthUrl).catch(() => {
                        setError("No authenticator app opened — enter the key below by hand.");
                      });
                    }}
                  />
                  <View className="gap-1.5">
                    <Text className="text-sm font-medium text-muted">Or enter this key by hand</Text>
                    <Text
                      selectable
                      style={{ backgroundColor: c.surface2 }}
                      className="rounded-8 px-3 py-2 text-center text-lg tracking-widest text-fg"
                    >
                      {setup.secret}
                    </Text>
                  </View>
                </View>
              ) : null}
              <Field
                label={flow === "email" ? "Code we emailed you" : "Code from your authenticator app"}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                autoFocus
                maxLength={32}
                returnKeyType="go"
                onSubmitEditing={confirm}
                error={error ?? undefined}
              />
              <Button title="Turn on" busy={busy} disabled={code.trim().length < 4} onPress={confirm} />
              {flow === "email" ? (
                <Button title={resent ? "Code sent" : "Send another code"} variant="quiet" onPress={resend} />
              ) : null}
              <Button
                title="Choose a different method"
                variant="quiet"
                onPress={() => {
                  setFlow(null);
                  setSetup(null);
                  setCode("");
                  setError(null);
                }}
              />
            </>
          ) : (
            <>
              <Button title="Use an authenticator app" busy={busy} onPress={startTotp} />
              <Button title="Email me a code instead" variant="quiet" disabled={busy} onPress={startEmail} />
              {error ? (
                <Text accessibilityLiveRegion="polite" className="text-sm text-danger">
                  {error}
                </Text>
              ) : null}
            </>
          )}
        </Animated.View>

        {recovery ? null : (
          <Button
            title="Sign out instead"
            variant="quiet"
            className="mt-4"
            onPress={() => logout.mutate()}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
