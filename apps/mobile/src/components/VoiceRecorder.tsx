import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { formatDuration } from "@ding/client";
import { PauseIcon, SendIcon, TrashIcon } from "../icons";
import { useTheme } from "../theme";

/** What the recorder hands back once you send it. */
export interface RecordedVoice {
  uri: string;
  durationMs: number;
}

/**
 * A voice note, recorded in place of the composer.
 *
 * It replaces the input row rather than floating over it, because while you're
 * recording there is nothing else to do — the row's three states (delete, the
 * running clock, send) are the whole interaction. That's WhatsApp's arrangement
 * and it's the right one: the destructive action sits furthest from the send
 * button, so a thumb reaching for one can't hit the other.
 *
 * Pause exists because a voice note is often interrupted, and losing thirty
 * seconds of explanation to a passing lorry is worse than an extra control.
 */
export function VoiceRecorder({
  onSend,
  onCancel,
}: {
  onSend: (v: RecordedVoice) => void;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Ask, configure, and start — in that order, once. Recording without
  // `allowsRecording` set produces a silent file on iOS rather than an error,
  // which is the kind of bug you only find after shipping.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const perm = await requestRecordingPermissionsAsync();
      if (cancelled) return;
      if (!perm.granted) {
        Alert.alert("Microphone access needed", "Allow microphone access to record a voice note.");
        onCancel();
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (cancelled) return;
      try {
        await recorder.prepareToRecordAsync();
        recorder.record();
        setReady(true);
      } catch (err) {
        setFailed(err instanceof Error ? err.message : "Couldn't start recording");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only on purpose: re-running this would start a second recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seconds = state.durationMillis ? state.durationMillis / 1000 : (recorder.currentTime ?? 0);

  async function finish() {
    try {
      await recorder.stop();
      // Put the audio session back so playback isn't stuck in record mode.
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) {
        setFailed("The recording came back empty");
        return;
      }
      onSend({ uri, durationMs: Math.round(seconds * 1000) });
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Couldn't save the recording");
    }
  }

  async function discard() {
    try {
      if (state.isRecording) await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      /* Nothing useful to do — we're throwing the recording away anyway. */
    }
    onCancel();
  }

  if (failed) {
    return (
      <View className="flex-row items-center gap-3 px-1 py-2">
        <Text style={{ color: c.danger }} className="flex-1 text-sm">
          {failed}
        </Text>
        <Pressable onPress={onCancel} accessibilityRole="button" className="px-2 py-1 active:opacity-60">
          <Text style={{ color: c.brandStrong }} className="text-md font-semibold">
            Close
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={{ backgroundColor: c.surface2 }}
      className="flex-row items-center gap-3 rounded-24 px-2 py-1.5"
      accessibilityLabel="Recording a voice message"
    >
      <Pressable
        onPress={() => void discard()}
        accessibilityRole="button"
        accessibilityLabel="Delete recording"
        hitSlop={8}
        className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
      >
        <TrashIcon size={19} color={c.danger} />
      </Pressable>

      <View
        style={{ backgroundColor: state.isRecording ? c.danger : c.textFaint }}
        className="h-2 w-2 rounded-full"
      />
      <Text style={{ color: c.text }} className="text-lg font-semibold tabular-nums">
        {formatDuration(seconds * 1000)}
      </Text>
      <Text className="flex-1 text-sm text-muted">
        {!ready ? "Starting…" : state.isRecording ? "Recording…" : "Paused"}
      </Text>

      {ready ? (
        <Pressable
          onPress={() => (state.isRecording ? recorder.pause() : recorder.record())}
          accessibilityRole="button"
          accessibilityLabel={state.isRecording ? "Pause recording" : "Resume recording"}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
        >
          <PauseIcon size={17} color={state.isRecording ? c.textMuted : c.brandStrong} />
        </Pressable>
      ) : null}

      <Pressable
        onPress={() => void finish()}
        disabled={!ready || seconds < 0.5}
        accessibilityRole="button"
        accessibilityLabel="Send voice message"
        hitSlop={4}
        style={{ backgroundColor: c.brand, opacity: ready && seconds >= 0.5 ? 1 : 0.35 }}
        className="h-10 w-10 items-center justify-center rounded-full active:opacity-80"
      >
        <SendIcon size={19} color="#fff" />
      </Pressable>
    </View>
  );
}
