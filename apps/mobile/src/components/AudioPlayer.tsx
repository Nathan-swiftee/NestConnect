import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import type { Attachment } from "@ding/schemas";
import { formatDuration } from "@ding/client";
import { mediaSource } from "../api-config";
import { PauseIcon, PlayIcon } from "../icons";
import { useTheme } from "../theme";

const BARS = 34;

/**
 * A voice note or audio file, played where it sits.
 *
 * It used to be a row that opened the file in whatever app the phone hands
 * `audio/*` to — which meant leaving the conversation to hear four seconds of
 * "yeah that's fine", and which never worked anyway: the URL it handed over
 * points at an authenticated endpoint, and the browser it landed in had no
 * session. Both halves of that are fixed here. `mediaSource` carries the bearer
 * token as a header, which `expo-audio` accepts on a remote source, and the
 * audio plays in the bubble.
 *
 * The bar is the recorded waveform when the sender's client captured one, and a
 * plain progress track when it didn't — same as the web, so a voice note looks
 * like the same object in both places. Tapping anywhere on it seeks.
 */
export function AudioPlayer({ att, mine }: { att: Attachment; mine?: boolean }) {
  const { c } = useTheme();
  const player = useAudioPlayer(mediaSource(att.url));
  const status = useAudioPlayerStatus(player);
  const [width, setWidth] = useState(0);
  // Set once, the first time anything plays: the recorder leaves the session in
  // record mode, where playback on iOS comes out of the earpiece at a whisper.
  const modeSet = useRef(false);

  // Playing to the end leaves the player parked at the end, so the next tap
  // would do nothing. Rewind instead, which is what every player does.
  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [status.didJustFinish, player]);

  const fallback = (att.durationMs ?? 0) / 1000;
  const total = status.duration > 0 ? status.duration : fallback;
  const pct = total > 0 ? Math.min(1, status.currentTime / total) : 0;
  const wave = att.waveform?.length ? att.waveform : null;
  const tint = mine ? c.brandStrong : c.brand;

  async function toggle() {
    if (!modeSet.current) {
      modeSet.current = true;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    }
    if (status.playing) player.pause();
    else player.play();
  }

  /** Seek to wherever the bar was touched. */
  function scrub(x: number) {
    if (!width || total <= 0) return;
    void player.seekTo(Math.max(0, Math.min(total, (x / width) * total)));
  }

  // A fixed number of bars whatever the clip's length, so a 3-second note and a
  // 3-minute one are the same shape: the bar is a progress indicator that
  // happens to be made of the sound, not a chart of it.
  const peaks = wave
    ? Array.from({ length: BARS }, (_, i) => wave[Math.floor((i / BARS) * wave.length)] ?? 0)
    : null;

  return (
    <View className="flex-row items-center gap-2.5 pt-1" style={{ minWidth: 200 }}>
      <Pressable
        onPress={() => void toggle()}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? "Pause" : "Play voice message"}
        hitSlop={6}
        style={{ backgroundColor: tint }}
        className="h-9 w-9 items-center justify-center rounded-full active:opacity-80"
      >
        {status.playing ? (
          <PauseIcon size={16} color="#fff" />
        ) : (
          // Nudged right: a triangle's optical centre isn't its bounding box's.
          <View style={{ marginLeft: 2 }}>
            <PlayIcon size={15} color="#fff" />
          </View>
        )}
      </Pressable>

      <Pressable
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => scrub(e.nativeEvent.locationX)}
        accessibilityRole="adjustable"
        accessibilityLabel="Seek"
        hitSlop={{ top: 10, bottom: 10 }}
        className="h-6 flex-1 justify-center"
      >
        {peaks ? (
          <View className="h-6 flex-row items-center gap-[2px]">
            {peaks.map((p, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: Math.max(3, Math.min(1, p) * 22),
                  borderRadius: 2,
                  backgroundColor: i / BARS <= pct ? tint : c.borderStrong,
                }}
              />
            ))}
          </View>
        ) : (
          <View style={{ backgroundColor: c.borderStrong }} className="h-1 w-full rounded-full">
            <View
              style={{ backgroundColor: tint, width: `${pct * 100}%` }}
              className="h-1 rounded-full"
            />
          </View>
        )}
      </Pressable>

      <Text style={{ color: c.textMuted }} className="text-2xs font-medium tabular-nums">
        {formatDuration((status.playing || status.currentTime > 0 ? status.currentTime : total) * 1000)}
      </Text>
    </View>
  );
}
