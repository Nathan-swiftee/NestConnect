import { Text, View } from "react-native";
import * as Updates from "expo-updates";
import Constants from "expo-constants";
import { useTheme } from "../theme";

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

  // Available in any build with expo-updates; in Expo Go and dev they're
  // undefined rather than throwing, hence the fallbacks.
  const channel = Updates.channel ?? "none";
  const runtime = Updates.runtimeVersion ?? "?";
  const version = Constants.expoConfig?.version ?? "?";
  const embedded = Updates.isEmbeddedLaunch;
  // Only the tail — the full id is a UUID and this is a diagnostic line, not a
  // field anyone types back in.
  const update = Updates.updateId ? Updates.updateId.slice(-8) : null;

  return (
    <View className="items-center gap-0.5 px-4 pb-2 pt-6">
      <Text style={{ color: c.textFaint }} className="text-2xs">
        Nest Connect {version} · {channel} · runtime {runtime}
      </Text>
      <Text style={{ color: c.textFaint }} className="text-2xs">
        {embedded || !update ? "Running the build installed on this phone" : `Update ${update}`}
      </Text>
    </View>
  );
}
