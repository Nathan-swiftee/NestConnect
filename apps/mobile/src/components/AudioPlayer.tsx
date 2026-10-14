import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import type { Attachment } from "@ding/schemas";
import { nextVoiceRate, voiceRateLabel } from "@ding/schemas";
import { formatDuration, useTranscript } from "@ding/client";
import { haptics } from "../haptics";
import { mediaSource } from "../api-config";
import { playableUrl } from "../audio-url";
import { AlertIcon, PauseIcon, PlayIcon } from "../icons";
import { useTheme } from "../theme";
import { Touchable } from "./Touchable";

const BARS = 34;

/** The speed last picked, for every voice note after it — as WhatsApp keeps it. */
let lastRate = 1;

/** How long a clip may take to load before it's called a failure, not slow. */
const LOAD_GIVE_UP_MS = 15_000;

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
  /**
   * Nothing is loaded until the first tap.
   *
   * `useAudioPlayer` isn't lazy — handing it a source creates a native player
   * and starts fetching the file. This component renders once per audio message,
   * so a thread with a dozen voice notes in it would open a dozen players and
   * pull down every clip before anyone asked to hear one. On a phone that's
   * somebody's data. A null source costs nothing; the tap arms it.
   */
  const [armed, setArmed] = useState(false);
  /** It never loaded: say so, rather than spinning for ever. A tap tries again. */
  const [failed, setFailed] = useState(false);
  const player = useAudioPlayer(armed ? mediaSource(playableUrl(att)) : null);
  const status = useAudioPlayerStatus(player);
  const [width, setWidth] = useState(0);
  // Set once, the first time anything plays: the recorder leaves the session in
  // record mode, where playback on iOS comes out of the earpiece at a whisper.
  const modeSet = useRef(false);
  /** The first tap arms the player; this starts it as soon as it has loaded. */
  const autoplay = useRef(false);
  const [rate, setRate] = useState(lastRate);
  const transcript = useTranscript(att.id, att.transcript);

  // The speed goes on once the clip has loaded (a player loading a new source
  // starts at 1×), and again on every press of the pill. Pitch-corrected, so
  // 2× is someone talking quickly rather than a chipmunk.
  useEffect(() => {
    if (!status.isLoaded) return;
    try {
      player.shouldCorrectPitch = true;
      player.setPlaybackRate(rate, "high");
    } catch {
      // A player that can't change speed still plays at 1×.
    }
  }, [status.isLoaded, rate, player]);

  useEffect(() => {
    if (autoplay.current && status.isLoaded) {
      autoplay.current = false;
      player.play();
    }
  }, [status.isLoaded, player]);

  // Playing to the end leaves the player parked at the end, so the next tap
  // would do nothing. Rewind instead, which is what every player does.
  //
  // Pause first, and that order is the whole fix: at `didJustFinish` the player
  // still considers itself playing, so seeking back to zero was read as "carry
  // on from here" and the clip started again — a voice note on a loop until you
  // tapped it. Stopping it before moving the playhead leaves it where a player
  // should be when it finishes: at the start, not running.
  useEffect(() => {
    if (!status.didJustFinish) return;
    player.pause();
    void player.seekTo(0);
  }, [status.didJustFinish, player]);

  const fallback = (att.durationMs ?? 0) / 1000;
  const total = status.duration > 0 ? status.duration : fallback;
  const pct = total > 0 ? Math.min(1, status.currentTime / total) : 0;
  const wave = att.waveform?.length ? att.waveform : null;
  const tint = mine ? c.brandStrong : c.brand;
  const loading = armed && !status.isLoaded;

  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      autoplay.current = false;
      setArmed(false);
      setFailed(true);
    }, LOAD_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [loading]);

  async function toggle() {
    if (!modeSet.current) {
      modeSet.current = true;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    }
    if (!armed) {
      autoplay.current = true;
      setFailed(false);
      setArmed(true);
      return;
    }
    if (status.playing) player.pause();
    else player.play();
  }

  /** Seek to wherever the bar was touched. */
  function scrub(x: number) {
    if (!armed || !width || total <= 0) return;
    void player.seekTo(Math.max(0, Math.min(total, (x / width) * total)));
  }

  // A fixed number of bars whatever the clip's length, so a 3-second note and a
  // 3-minute one are the same shape: the bar is a progress indicator that
  // happens to be made of the sound, not a chart of it.
  const peaks = wave
    ? Array.from({ length: BARS }, (_, i) => wave[Math.floor((i / BARS) * wave.length)] ?? 0)
    : null;

  // WhatsApp's pill: there once the note has started; each press steps
  // 1× → 1.25× → 1.5× → 2× → 1×.
  const engaged = armed && status.isLoaded && (status.playing || status.currentTime > 0);
  function stepRate() {
    haptics.select();
    const next = nextVoiceRate(rate);
    lastRate = next;
    setRate(next);
  }

  return (
    <View style={{ minWidth: 200 }}>
    <View className="flex-row items-center gap-2.5 pt-1">
      <Touchable feel="chip"
        onPress={() => void toggle()}
        accessibilityRole="button"
        accessibilityLabel={
          loading ? "Loading voice message" : failed ? "Couldn't play this voice message. Try again" : status.playing ? "Pause" : "Play voice message"
        }
        hitSlop={6}
        style={{ backgroundColor: tint }}
        className="h-9 w-9 items-center justify-center rounded-full"
      >
        {loading ? (
          // Between the tap and the first byte. Without it the button looks
          // pressed and dead for as long as the clip takes to reach the phone.
          <ActivityIndicator size="small" color="#fff" />
        ) : failed ? (
          <AlertIcon size={16} color="#fff" />
        ) : status.playing ? (
          <PauseIcon size={16} color="#fff" />
        ) : (
          // Nudged right: a triangle's optical centre isn't its bounding box's.
          <View style={{ marginLeft: 2 }}>
            <PlayIcon size={15} color="#fff" />
          </View>
        )}
      </Touchable>

      <Pressable
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => (failed ? void toggle() : scrub(e.nativeEvent.locationX))}
        accessibilityRole="adjustable"
        accessibilityLabel="Seek"
        hitSlop={{ top: 10, bottom: 10 }}
        className="h-6 flex-1 justify-center"
      >
        {failed ? (
          <Text style={{ color: c.danger }} className="text-xs font-medium">
            Couldn't play this — tap to try again
          </Text>
        ) : peaks ? (
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

      {engaged ? (
        <Touchable
          feel="chip"
          onPress={stepRate}
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${voiceRateLabel(rate)}`}
          hitSlop={8}
          style={{ backgroundColor: c.textMuted, minWidth: 38 }}
          className="h-6 items-center justify-center rounded-full px-2"
        >
          <Text className="text-xs font-bold tabular-nums text-white">{voiceRateLabel(rate)}</Text>
        </Touchable>
      ) : null}
    </View>
    <Transcript {...transcript} tint={tint} />
    </View>
  );
}

/**
 * Under a voice note: "Transcribe", then the words — as WhatsApp does it.
 * Once anyone has asked, the note carries them and they show for everyone.
 */
function Transcript({
  text,
  loading,
  error,
  run,
  tint,
}: {
  text: string | undefined;
  loading: boolean;
  error: string | null;
  run: () => void;
  tint: string;
}) {
  const { c } = useTheme();
  if (text !== undefined && !loading) {
    return (
      <View style={{ backgroundColor: c.surface2 }} className="mt-1.5 rounded-lg px-2.5 py-1.5">
        {text ? (
          <Text selectable style={{ color: c.text }} className="text-sm leading-5">
            {text}
          </Text>
        ) : (
          <Text style={{ color: c.textMuted }} className="text-sm italic">
            No speech heard in this one
          </Text>
        )}
      </View>
    );
  }
  if (loading) {
    return (
      <View className="mt-1 flex-row items-center gap-1.5 pl-[46px]">
        <ActivityIndicator size="small" color={c.textMuted} />
        <Text style={{ color: c.textMuted }} className="text-xs italic">
          Transcribing…
        </Text>
      </View>
    );
  }
  return (
    <View className="mt-0.5 flex-row flex-wrap items-center gap-x-2 pl-[46px]">
      {error ? (
        <Text style={{ color: c.danger }} className="text-xs">
          {error}
        </Text>
      ) : null}
      <Pressable
        onPress={() => {
          haptics.select();
          run();
        }}
        accessibilityRole="button"
        hitSlop={8}
      >
        <Text style={{ color: tint }} className="py-1 text-xs font-semibold">
          {error ? "Try again" : "Transcribe"}
        </Text>
      </Pressable>
    </View>
  );
}
