import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import * as Updates from "expo-updates";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { lastTrail } from "../diagnostics";
import { INSET_SOURCES, useInsets } from "../insets";

/**
 * Which bundle is actually running, in small grey type at the bottom of Settings.
 *
 * This exists because of a specific, repeated failure: a fix ships, the phone
 * looks unchanged, and there is no way to tell whether the fix is wrong or the
 * fix never arrived. Those two need completely different responses and we spent
 * three rounds unable to distinguish them. One line of text ends that — read it
 * off the screen and you know which bundle the app is running before anyone
 * starts debugging the code.
 *
 * `isEmbeddedLaunch` is the load-bearing part. True means the app is running the
 * JavaScript baked into the installed APK — no update has ever been applied, so
 * anything published since the build is simply not on the device.
 *
 * Note that `expo-updates` reports the *running* bundle. An update downloaded a
 * moment ago but not yet applied doesn't show here until the next launch, which
 * is itself worth knowing: if this says "in the installed app" right after an
 * update, relaunch once more before concluding anything.
 */
export function BuildStamp() {
  const { c } = useTheme();
  // Both the raw provider value and what the app actually ends up using, so the
  // line shows whether the fallbacks are doing any work.
  const live = useSafeAreaInsets();
  const resolved = useInsets();

  // Available in any build with expo-updates; in Expo Go and dev they're
  // undefined rather than throwing, hence the fallbacks.
  const channel = Updates.channel ?? "none";
  const runtime = Updates.runtimeVersion ?? "?";
  const version = Constants.expoConfig?.version ?? "?";
  const embedded = Updates.isEmbeddedLaunch;
  // Only the tail — the full id is a UUID and this is a diagnostic line, not a
  // field anyone types back in.
  const update = Updates.updateId ? Updates.updateId.slice(-8) : null;

  // The interrupted sequence from before the app last went away, if there is
  // one. Read once, on mount: nothing writes a trail from this screen, so it
  // cannot go stale while it is being looked at.
  const [trail, setTrail] = useState<{ steps: string[]; at: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void lastTrail().then((t) => {
      if (alive) setTrail(t);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <View className="items-center gap-0.5 px-4 pb-2 pt-6">
      <Text style={{ color: c.textFaint }} className="text-2xs">
        Nest Connect {version} · {channel} · runtime {runtime}
      </Text>
      <Text style={{ color: c.textFaint }} className="text-2xs">
        {embedded || !update ? "Running the build installed on this phone" : `Update ${update}`}
      </Text>
      {/* Which source knows the safe-area insets, and which came back zero.
          The app takes the largest of these, so a row of zeroes on the left
          with a number on the right is working as intended — all zeroes is the
          failure, and it says so without anyone having to guess. */}
      <Text style={{ color: c.textFaint }} className="text-2xs">
        top {resolved.top} = live {live.top} / start {INSET_SOURCES.atStartup?.top ?? "–"} / bar{" "}
        {INSET_SOURCES.androidStatusBar}
      </Text>
      <Text style={{ color: c.textFaint }} className="text-2xs">
        bottom {resolved.bottom} = live {live.bottom} / start {INSET_SOURCES.atStartup?.bottom ?? "–"}
      </Text>
      {/* A sequence that started and never finished — right now only the
          microphone writes one. The last step named here is the one immediately
          before whatever ended the app, which is the single fact a native crash
          otherwise refuses to give up. Absent means the last attempt completed,
          so an empty space here is the good outcome. */}
      {trail ? (
        <Text
          style={{ color: c.danger }}
          className="px-2 pt-1 text-center text-2xs"
          selectable
        >
          stopped after: {trail.steps.join(" › ")} ·{" "}
          {new Date(trail.at).toLocaleTimeString()}
        </Text>
      ) : null}
    </View>
  );
}
